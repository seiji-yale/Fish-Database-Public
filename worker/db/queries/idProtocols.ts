import type { Db } from '../db';
import type { IdProtocolRow } from '../types';
import {
  type ListOptions,
  define,
  getRowById,
  insertRow,
  insertStatement,
  listRowsBy,
  listRowsByIn,
  softDeleteRow,
} from './shared';

export const ID_PROTOCOLS = define<IdProtocolRow>(
  'id_protocols',
  {
    id: true,
    line_id: true,
    protocol_type: true,
    label: true,
    fields: true,
    notes: true,
    sort_order: true,
    deleted_at: true,
    created_at: true,
    updated_at: true,
    is_current: true,
  },
  true,
);

export function insertIdProtocol(db: Db, row: IdProtocolRow): Promise<unknown> {
  return insertRow(db, ID_PROTOCOLS, row);
}

/** For `db.batch([...])` (one transaction with the rows that belong together). */
export function insertIdProtocolStatement(db: Db, row: IdProtocolRow) {
  return insertStatement(db, ID_PROTOCOLS, row);
}

export function getIdProtocolById(db: Db, id: string): Promise<IdProtocolRow | null> {
  return getRowById(db, ID_PROTOCOLS, id);
}

export function listIdProtocolsByLine(
  db: Db,
  lineId: string,
  options?: ListOptions,
): Promise<IdProtocolRow[]> {
  return listRowsBy(db, ID_PROTOCOLS, 'line_id', lineId, 'sort_order, created_at, id', options);
}

/** The list view's "ID Method" column: every line's `current_protocol_id`, fetched in one query. */
export function listIdProtocolsByIds(db: Db, ids: readonly string[]): Promise<IdProtocolRow[]> {
  return listRowsByIn(db, ID_PROTOCOLS, 'id', ids, 'id');
}

/**
 * The protocols that are current for some line (flagged `is_current`, or pointed to by a line's
 * `current_protocol_id`), live ones only: the list view's "ID Method" column and the Dashboard.
 */
export async function listCurrentIdProtocols(
  db: Db,
  primaryIds: readonly string[],
): Promise<IdProtocolRow[]> {
  const { results: flagged } = await db
    .prepare(
      'SELECT * FROM id_protocols WHERE deleted_at IS NULL AND is_current = 1 ORDER BY sort_order, created_at, id',
    )
    .all<IdProtocolRow>();
  // Older lines have only the pointer (no flag yet): fetch those by id, in chunks.
  const known = new Set(flagged.map((row) => row.id));
  const pointers = await listRowsByIn(
    db,
    ID_PROTOCOLS,
    'id',
    primaryIds.filter((id) => !known.has(id)),
    'sort_order, created_at, id',
  );
  return [...flagged, ...pointers];
}

/** Hides the row (BR-7). Returns false when the id is unknown or already hidden. */
export function softDeleteIdProtocol(db: Db, id: string, now: string): Promise<boolean> {
  return softDeleteRow(db, ID_PROTOCOLS, id, now);
}
