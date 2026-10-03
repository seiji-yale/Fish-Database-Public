/**
 * Attachments (T-016, FR-REF-01/02, docs/03-data-model.md 2.10). Files go to R2 under
 * `lines/<line_id>/<attachment_id>-<safe_name>` (thumbnails `…-thumb.jpg`); the row points at them.
 *
 * Two ways a file arrives:
 * - straight onto an ID protocol (a protocol image): one line version, "Uploaded gel image for PCR."
 * - *staged* on the line (`owner_type = 'line'`) and linked in the same write that creates what it
 *   belongs to — a genotyping record (gel image) or a reference (file). A staged upload that is never
 *   linked is simply kept (nothing is ever deleted) and never shown.
 *
 * "Latest image" (`is_latest`): per ID protocol, the images shown on its card are its own images plus
 * the gel images of the genotyping records done with it; the newest one is the latest.
 */
import {
  attachmentKey,
  checkUpload,
  contentMatchesType,
  MAX_THUMB_BYTES,
  thumbnailKey,
  uploadMessages,
} from '../../domain/attachments';
import type { Db, DbStatement } from '../db/db';
import { newId } from '../db/ids';
import { getAttachmentById } from '../db/queries/attachments';
import type { AttachmentKind, AttachmentRow } from '../db/types';
import { ApiError } from './errors';
import type { LineDocument } from './lineWrite';
import { messages } from './messages';

export const ATTACHMENT_KINDS: readonly AttachmentKind[] = [
  'gel_image',
  'fluorescence_image',
  'sequence_result',
  'reference_file',
  'other',
];

/** What the person reads in History: "gel image", "fluorescence image", ... */
export const KIND_WORDS: Record<AttachmentKind, string> = {
  gel_image: 'gel image',
  fluorescence_image: 'fluorescence image',
  sequence_result: 'sequence result',
  reference_file: 'file',
  other: 'image',
};

function uploadError(message: string, field = 'file'): ApiError {
  return new ApiError(400, 'INVALID_INPUT', message, undefined, { fields: { [field]: message } });
}

export interface StoredFile {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  key: string;
  thumbKey: string | null;
}

/**
 * Checks the file (size, type, first bytes) and the optional thumbnail, then puts both in R2.
 * The row is written afterwards by the caller; if that write fails the objects stay unreferenced,
 * which costs a few bytes and loses nothing.
 */
export async function storeUpload(
  bucket: R2Bucket | undefined,
  lineId: string,
  file: File,
  thumb: File | null,
  imagesOnly: boolean,
): Promise<StoredFile> {
  if (bucket === undefined)
    throw new ApiError(503, 'STORAGE_UNAVAILABLE', messages.storageUnavailable);
  const check = checkUpload({ name: file.name, type: file.type, size: file.size }, imagesOnly);
  if (!check.ok) throw uploadError(check.message);
  // Only the first bytes are read here; the file itself goes to R2 as it is (no extra copy: the free
  // plan allows very little CPU time per request).
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!contentMatchesType(head, check.mimeType)) throw uploadError(uploadMessages.contentMismatch);

  let thumbBytes: Uint8Array | null = null;
  if (thumb !== null && thumb.size > 0) {
    thumbBytes = new Uint8Array(await thumb.arrayBuffer());
    // A thumbnail that is not a small JPEG is ignored rather than refused: the original still works.
    if (
      thumb.size > MAX_THUMB_BYTES ||
      !contentMatchesType(thumbBytes.subarray(0, 16), 'image/jpeg')
    )
      thumbBytes = null;
  }

  const attachmentId = newId();
  const key = attachmentKey(lineId, attachmentId, file.name);
  await bucket.put(key, file, { httpMetadata: { contentType: check.mimeType } });
  let thumbKey: string | null = null;
  if (thumbBytes !== null) {
    thumbKey = thumbnailKey(lineId, attachmentId);
    await bucket.put(thumbKey, thumbBytes, { httpMetadata: { contentType: 'image/jpeg' } });
  }
  return {
    attachmentId,
    fileName: file.name,
    mimeType: check.mimeType,
    size: file.size,
    key,
    thumbKey,
  };
}

export function attachmentRow(
  stored: StoredFile,
  owner: Pick<AttachmentRow, 'owner_type' | 'owner_id' | 'kind' | 'is_latest'>,
  caption: string | null,
  authorId: string,
  now: string,
): AttachmentRow {
  return {
    id: stored.attachmentId,
    ...owner,
    file_name: stored.fileName,
    mime_type: stored.mimeType,
    size_bytes: stored.size,
    r2_key: stored.key,
    thumb_r2_key: stored.thumbKey,
    caption,
    deleted_at: null,
    created_at: now,
    created_by: authorId,
  };
}

/** Statements that take the "latest" mark off every image shown on this protocol's card. */
export function clearLatestStatements(db: Db, protocolId: string): DbStatement[] {
  return [
    db
      .prepare(
        `UPDATE attachments SET is_latest = 0
          WHERE is_latest = 1 AND deleted_at IS NULL AND (
            (owner_type = 'id_protocol' AND owner_id = ?)
            OR (owner_type = 'genotyping_record' AND owner_id IN
                 (SELECT id FROM genotyping_records WHERE protocol_id = ?)))`,
      )
      .bind(protocolId, protocolId),
  ];
}

/**
 * After an image is hidden, the newest remaining image of the protocol becomes the latest again.
 * The one statement picks it inside the batch, so it sees the hide that runs just before it.
 */
export function promoteNewestStatement(db: Db, protocolId: string): DbStatement {
  return db
    .prepare(
      `UPDATE attachments SET is_latest = 1 WHERE id = (
         SELECT id FROM attachments
          WHERE deleted_at IS NULL AND mime_type LIKE 'image/%' AND (
            (owner_type = 'id_protocol' AND owner_id = ?)
            OR (owner_type = 'genotyping_record' AND owner_id IN
                 (SELECT id FROM genotyping_records WHERE protocol_id = ?)))
          ORDER BY created_at DESC, id DESC LIMIT 1)`,
    )
    .bind(protocolId, protocolId);
}

/** A staged upload of this line that is not linked yet: the only thing a form may link. */
export async function findStaged(
  db: Db,
  lineId: string,
  attachmentId: string,
  field: string,
): Promise<AttachmentRow> {
  const row = await getAttachmentById(db, attachmentId);
  if (
    row === null ||
    row.deleted_at !== null ||
    row.owner_type !== 'line' ||
    row.owner_id !== lineId
  )
    throw new ApiError(400, 'INVALID_INPUT', messages.attachmentNotStaged, undefined, {
      fields: { [field]: messages.attachmentNotStaged },
    });
  return row;
}

/** Re-points a staged upload at its owner (a genotyping record, a reference). */
export function linkStatement(
  db: Db,
  attachmentId: string,
  ownerType: AttachmentRow['owner_type'],
  ownerId: string,
  kind: AttachmentKind,
  isLatest: boolean,
): DbStatement {
  return db
    .prepare(
      'UPDATE attachments SET owner_type = ?, owner_id = ?, kind = ?, is_latest = ? WHERE id = ?',
    )
    .bind(ownerType, ownerId, kind, isLatest ? 1 : 0, attachmentId);
}

/**
 * The attachment when it belongs to this line (its own staged file, one of its protocols, genotyping
 * records or references), with the protocol whose card shows it (if any).
 */
export async function findLineAttachment(
  db: Db,
  document: LineDocument,
  attachmentId: string,
): Promise<{ row: AttachmentRow; protocolId: string | null }> {
  const row = await getAttachmentById(db, attachmentId);
  const notFound = new ApiError(404, 'ATTACHMENT_NOT_FOUND', messages.attachmentNotFound);
  if (row === null || row.deleted_at !== null) throw notFound;
  const lineId = document.line.id;
  if (row.owner_type === 'id_protocol') {
    if (!document.protocols.some((protocol) => protocol.id === row.owner_id)) throw notFound;
    return { row, protocolId: row.owner_id };
  }
  if (row.owner_type === 'genotyping_record') {
    const record = await db
      .prepare('SELECT protocol_id FROM genotyping_records WHERE id = ? AND line_id = ?')
      .bind(row.owner_id, lineId)
      .first<{ protocol_id: string | null }>();
    if (record === null) throw notFound;
    return { row, protocolId: record.protocol_id };
  }
  if (row.owner_type === 'line_reference') {
    if (!document.references.some((reference) => reference.id === row.owner_id)) throw notFound;
    return { row, protocolId: null };
  }
  if (row.owner_type === 'line' && row.owner_id === lineId) return { row, protocolId: null };
  throw notFound;
}
