/**
 * Deleted items (T-018, FR-ADM-04, BR-7): everything the app hides instead of deleting, listed for the
 * Admin with a Restore button. Protocols, cryo records, references and attachments are restored through
 * `withLineWrite` (a line version, "Restored …"); a chat message just comes back. Some items cannot
 * return (a cryo record whose last vial was used, a replaced reference file): they are listed with the
 * reason instead of a button.
 */
import { cryoLabelOf } from '../../domain/cryoEdit';
import type { ResolvedAuthor } from '../../domain/types';
import type { Db } from '../db/db';
import { newId, nowIso } from '../db/ids';
import { insertActivityStatement } from '../db/queries/activities';
import type { CryoRecordRow, IdProtocolRow, LineReferenceRow } from '../db/types';
import { ApiError } from './errors';
import { restoreCryoChange } from './cryoWrite';
import { loadLineDocument, withLineWrite } from './lineWrite';
import { messages } from './messages';
import { restoreProtocolChange } from './protocolWrite';

export const DELETED_TYPES = ['protocol', 'cryo', 'reference', 'attachment', 'message'] as const;
export type DeletedType = (typeof DELETED_TYPES)[number];

export interface DeletedItem {
  type: DeletedType;
  id: string;
  lineId: string | null;
  lineName: string | null;
  /** What it was, e.g. `PCR – wt allele`, `C0637–C0644 (8)`, `Zebrafish handbook`. */
  label: string;
  deletedAt: string;
  /** Null when it can be restored; otherwise why not. */
  notRestorable: string | null;
}

const LIMIT = 200;

export async function deletedItems(db: Db): Promise<DeletedItem[]> {
  const all = async <T>(sql: string) => (await db.prepare(sql).all<T>()).results;
  const [protocols, cryo, references, attachments, chat] = await Promise.all([
    all<{ id: string; line_id: string; line_name: string; label: string; deleted_at: string }>(
      `SELECT p.id, p.line_id, l.name AS line_name, p.label, p.deleted_at FROM id_protocols p
         JOIN lines l ON l.id = p.line_id WHERE p.deleted_at IS NOT NULL
         ORDER BY p.deleted_at DESC LIMIT ${String(LIMIT)}`,
    ),
    all<CryoRecordRow & { line_name: string }>(
      `SELECT c.*, l.name AS line_name FROM cryo_records c JOIN lines l ON l.id = c.line_id
         WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC LIMIT ${String(LIMIT)}`,
    ),
    all<LineReferenceRow & { line_name: string }>(
      `SELECT r.*, l.name AS line_name FROM line_references r JOIN lines l ON l.id = r.line_id
         WHERE r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC LIMIT ${String(LIMIT)}`,
    ),
    all<{
      id: string;
      owner_type: string;
      file_name: string | null;
      caption: string | null;
      kind: string;
      deleted_at: string;
      line_id: string | null;
      line_name: string | null;
    }>(
      `SELECT a.id, a.owner_type, a.file_name, a.caption, a.kind, a.deleted_at,
              COALESCE(p.line_id, g.line_id, r.line_id, CASE WHEN a.owner_type = 'line' THEN a.owner_id END) AS line_id,
              l.name AS line_name
         FROM attachments a
         LEFT JOIN id_protocols p ON a.owner_type = 'id_protocol' AND p.id = a.owner_id
         LEFT JOIN genotyping_records g ON a.owner_type = 'genotyping_record' AND g.id = a.owner_id
         LEFT JOIN line_references r ON a.owner_type = 'line_reference' AND r.id = a.owner_id
         LEFT JOIN lines l ON l.id = COALESCE(p.line_id, g.line_id, r.line_id, CASE WHEN a.owner_type = 'line' THEN a.owner_id END)
        WHERE a.deleted_at IS NOT NULL AND a.owner_type <> 'chat_message'
        ORDER BY a.deleted_at DESC LIMIT ${String(LIMIT)}`,
    ),
    all<{
      id: string;
      line_id: string | null;
      line_name: string | null;
      body: string;
      deleted_at: string;
    }>(
      `SELECT m.id, m.line_id, l.name AS line_name, m.body, m.deleted_at FROM chat_messages m
         LEFT JOIN lines l ON l.id = m.line_id WHERE m.deleted_at IS NOT NULL
         ORDER BY m.deleted_at DESC LIMIT ${String(LIMIT)}`,
    ),
  ]);
  const items: DeletedItem[] = [
    ...protocols.map((row): DeletedItem => ({
      type: 'protocol',
      id: row.id,
      lineId: row.line_id,
      lineName: row.line_name,
      label: row.label,
      deletedAt: row.deleted_at,
      notRestorable: null,
    })),
    ...cryo.map((row): DeletedItem => ({
      type: 'cryo',
      id: row.id,
      lineId: row.line_id,
      lineName: row.line_name,
      label: cryoLabelOf({
        cryoIdStart: row.cryo_id_start,
        cryoIdEnd: row.cryo_id_end,
        count: row.count,
        place: row.place,
        cryoDate: row.cryo_date,
        detailsUnknown: row.details_unknown === 1,
      }),
      deletedAt: row.deleted_at as string,
      notRestorable: row.count !== null && row.count < 1 ? 'every vial of it was used.' : null,
    })),
    ...references.map((row): DeletedItem => ({
      type: 'reference',
      id: row.id,
      lineId: row.line_id,
      lineName: row.line_name,
      label: row.title,
      deletedAt: row.deleted_at as string,
      notRestorable: null,
    })),
    ...attachments.map((row): DeletedItem => ({
      type: 'attachment',
      id: row.id,
      lineId: row.line_id,
      lineName: row.line_name,
      label: row.caption ?? row.file_name ?? row.kind,
      deletedAt: row.deleted_at,
      notRestorable:
        row.owner_type === 'id_protocol' || row.owner_type === 'genotyping_record'
          ? null
          : 'only images of ID methods and genotyping records can be restored.',
    })),
    ...chat.map((row): DeletedItem => ({
      type: 'message',
      id: row.id,
      lineId: row.line_id,
      lineName: row.line_name,
      label: row.body.length > 80 ? `${row.body.slice(0, 77)}…` : row.body,
      deletedAt: row.deleted_at,
      notRestorable: null,
    })),
  ];
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)).slice(0, LIMIT);
}

const notFound = () => new ApiError(404, 'DELETED_NOT_FOUND', messages.deletedNotFound);

async function lineIdOf(db: Db, sql: string, id: string): Promise<string | null> {
  const row = await db.prepare(sql).bind(id).first<{ line_id: string | null }>();
  return row?.line_id ?? null;
}

/** Puts one deleted item back. The Admin restores without a version check: they act on what is listed now. */
export async function restoreDeleted(
  db: Db,
  type: DeletedType,
  id: string,
  author: ResolvedAuthor,
): Promise<{ id: string; summary: string }> {
  const now = nowIso();
  const restoreInLine = async (
    lineId: string,
    changeType: 'protocol_changed' | 'cryo_changed' | 'reference_changed',
    mutate: Parameters<typeof withLineWrite>[1]['mutate'],
  ) => {
    const document = await loadLineDocument(db, lineId);
    if (document === null) throw notFound();
    const result = await withLineWrite(db, {
      lineId,
      expectedVersion: document.line.version,
      author,
      changeType,
      now,
      mutate,
    });
    return { id, summary: result.summary };
  };

  if (type === 'protocol') {
    const row = await db
      .prepare('SELECT * FROM id_protocols WHERE id = ? AND deleted_at IS NOT NULL')
      .bind(id)
      .first<IdProtocolRow>();
    if (row === null) throw notFound();
    return restoreInLine(row.line_id, 'protocol_changed', (before) =>
      restoreProtocolChange(db, before, row, now),
    );
  }
  if (type === 'cryo') {
    const row = await db
      .prepare('SELECT * FROM cryo_records WHERE id = ? AND deleted_at IS NOT NULL')
      .bind(id)
      .first<CryoRecordRow>();
    if (row === null) throw notFound();
    const others = (
      await db
        .prepare(
          'SELECT * FROM cryo_records WHERE deleted_at IS NULL AND cryo_id_start IS NOT NULL',
        )
        .all<CryoRecordRow>()
    ).results;
    return restoreInLine(row.line_id, 'cryo_changed', (before) =>
      restoreCryoChange(db, before, row, others),
    );
  }
  if (type === 'reference') {
    const row = await db
      .prepare('SELECT * FROM line_references WHERE id = ? AND deleted_at IS NOT NULL')
      .bind(id)
      .first<LineReferenceRow>();
    if (row === null) throw notFound();
    return restoreInLine(row.line_id, 'reference_changed', (before) => ({
      line: {},
      statements: [
        db.prepare('UPDATE line_references SET deleted_at = NULL WHERE id = ?').bind(row.id),
      ],
      children: { references: [...before.references, { ...row, deleted_at: null }] },
      summaryContext: { text: `Restored reference: ${row.title}.` },
    }));
  }
  if (type === 'attachment') {
    const row = await db
      .prepare('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NOT NULL')
      .bind(id)
      .first<{
        id: string;
        owner_type: string;
        owner_id: string;
        kind: string;
        caption: string | null;
        file_name: string | null;
      }>();
    if (row === null) throw notFound();
    const lineId =
      row.owner_type === 'id_protocol'
        ? await lineIdOf(db, 'SELECT line_id FROM id_protocols WHERE id = ?', row.owner_id)
        : row.owner_type === 'genotyping_record'
          ? await lineIdOf(db, 'SELECT line_id FROM genotyping_records WHERE id = ?', row.owner_id)
          : null;
    if (lineId === null)
      throw new ApiError(
        409,
        'NOT_RESTORABLE',
        messages.deletedNotRestorable(
          'only images of ID methods and genotyping records can be restored.',
        ),
      );
    const name = row.caption ?? row.file_name ?? row.kind;
    // It returns as an older image: the card orders by date, so the newest stays the latest.
    return restoreInLine(lineId, 'protocol_changed', () => ({
      line: {},
      statements: [
        db
          .prepare('UPDATE attachments SET deleted_at = NULL, is_latest = 0 WHERE id = ?')
          .bind(row.id),
      ],
      summaryContext: { text: `Restored image ${name}.` },
    }));
  }
  // message
  const message = await db
    .prepare('SELECT id, line_id FROM chat_messages WHERE id = ? AND deleted_at IS NOT NULL')
    .bind(id)
    .first<{ id: string; line_id: string | null }>();
  if (message === null) throw notFound();
  await db.batch([
    db.prepare('UPDATE chat_messages SET deleted_at = NULL WHERE id = ?').bind(id),
    await insertActivityStatement(db, {
      id: newId(),
      line_id: message.line_id,
      user_id: author.authorId,
      via_admin: author.viaAdmin ? 1 : 0,
      type: 'settings_changed',
      summary: 'A deleted chat message was restored.',
      ref_type: 'chat_message',
      ref_id: id,
      created_at: now,
    }),
  ]);
  return { id, summary: 'A deleted chat message was restored.' };
}
