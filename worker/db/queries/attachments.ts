import type { Db } from '../db';
import type { AttachmentOwnerType, AttachmentRow } from '../types';
import {
  define,
  getRowById,
  insertRow,
  insertStatement,
  listRowsByIn,
  softDeleteRow,
  type ListOptions,
} from './shared';

export const ATTACHMENTS = define<AttachmentRow>(
  'attachments',
  {
    id: true,
    owner_type: true,
    owner_id: true,
    kind: true,
    file_name: true,
    mime_type: true,
    size_bytes: true,
    r2_key: true,
    thumb_r2_key: true,
    caption: true,
    is_latest: true,
    deleted_at: true,
    created_at: true,
    created_by: true,
  },
  true,
);

export function insertAttachment(db: Db, row: AttachmentRow): Promise<unknown> {
  return insertRow(db, ATTACHMENTS, row);
}

/** For `db.batch([...])`, e.g. together with the statement that clears the previous `is_latest`. */
export function insertAttachmentStatement(db: Db, row: AttachmentRow) {
  return insertStatement(db, ATTACHMENTS, row);
}

export function getAttachmentById(db: Db, id: string): Promise<AttachmentRow | null> {
  return getRowById(db, ATTACHMENTS, id);
}

/** Attachments of one owner (a protocol, a genotyping record, a reference, a message, a line). */
export async function listAttachmentsByOwner(
  db: Db,
  ownerType: AttachmentOwnerType,
  ownerId: string,
  options?: ListOptions,
): Promise<AttachmentRow[]> {
  const filter = options?.includeDeleted === true ? '1 = 1' : 'deleted_at IS NULL';
  const { results } = await db
    .prepare(
      `SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? AND ${filter} ORDER BY created_at, id`,
    )
    .bind(ownerType, ownerId)
    .all<AttachmentRow>();
  return results;
}

/**
 * Attachments for several owners at once, regardless of owner type (a protocol, a genotyping
 * record, a reference, ...) — owner ids are unique per table (ULIDs), so one `owner_id IN (...)`
 * query is enough; the caller groups the results by `owner_id`. Used by the Line Detail page so it
 * does not fetch attachments once per protocol/record/reference.
 */
export function listAttachmentsByOwners(
  db: Db,
  ownerIds: readonly string[],
): Promise<AttachmentRow[]> {
  return listRowsByIn(db, ATTACHMENTS, 'owner_id', ownerIds, 'owner_id, created_at, id');
}

/** Several attachments by their own id: `line_references.attachment_id` points directly at one
 * attachment (unlike `id_protocols`/`genotyping_records`, where attachments point back via
 * `owner_id`), so a reference's file is looked up this way instead. */
export function listAttachmentsByIds(db: Db, ids: readonly string[]): Promise<AttachmentRow[]> {
  return listRowsByIn(db, ATTACHMENTS, 'id', ids, 'id');
}

/** Hides the row (BR-7); the R2 object is kept. Returns false when unknown or already hidden. */
export function softDeleteAttachment(db: Db, id: string, now: string): Promise<boolean> {
  return softDeleteRow(db, ATTACHMENTS, id, now);
}
