import type { Db } from '../db';
import type { LineRow, LineStatus } from '../types';
import { define, getRowById, insertRow, insertStatement } from './shared';

export const LINES = define<LineRow>('lines', {
  id: true,
  name: true,
  gene: true,
  status: true,
  dob: true,
  generation_no: true,
  ided_number: true,
  last_id_date: true,
  breeding_started_at: true,
  closed_at: true,
  closed_reason: true,
  notes: true,
  current_protocol_id: true,
  legacy_no: true,
  legacy_check: true,
  version: true,
  created_at: true,
  created_by: true,
  updated_at: true,
  updated_by: true,
});

export function insertLine(db: Db, row: LineRow): Promise<unknown> {
  return insertRow(db, LINES, row);
}

/** For `db.batch([...])`: a line and its first protocol are inserted in one transaction. */
export function insertLineStatement(db: Db, row: LineRow) {
  return insertStatement(db, LINES, row);
}

export function getLineById(db: Db, id: string): Promise<LineRow | null> {
  return getRowById(db, LINES, id);
}

/** Case-insensitive, whitespace-trimmed lookup: the same rule as the unique index (BR-8). */
export function getLineByName(db: Db, name: string): Promise<LineRow | null> {
  return db
    .prepare('SELECT * FROM lines WHERE lower(trim(name)) = lower(trim(?))')
    .bind(name)
    .first<LineRow>();
}

/** Lines are never deleted (they are Closed), so every status is listed unless filtered. */
export async function listLines(db: Db, options: { status?: LineStatus } = {}): Promise<LineRow[]> {
  const { results } =
    options.status === undefined
      ? await db.prepare('SELECT * FROM lines ORDER BY lower(name), id').all<LineRow>()
      : await db
          .prepare('SELECT * FROM lines WHERE status = ? ORDER BY lower(name), id')
          .bind(options.status)
          .all<LineRow>();
  return results;
}

export type LineListView = 'active' | 'all' | 'closed';

/** FR-LIST-02: Active = Current or Breeding; All adds Closed; Closed is Closed only. */
export async function listLinesForView(db: Db, view: LineListView): Promise<LineRow[]> {
  if (view === 'all') return listLines(db);
  if (view === 'closed') return listLines(db, { status: 'Closed' });
  const { results } = await db
    .prepare("SELECT * FROM lines WHERE status IN ('Current', 'Breeding') ORDER BY lower(name), id")
    .all<LineRow>();
  return results;
}
