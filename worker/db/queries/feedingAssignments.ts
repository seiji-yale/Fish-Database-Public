import type { Db } from '../db';
import type { FeedingAssignmentRow } from '../types';
import { define, insertStatement } from './shared';

export const FEEDING_ASSIGNMENTS = define<FeedingAssignmentRow>('feeding_assignments', {
  id: true,
  date: true,
  user_id: true,
  note: true,
  imported_from: true,
  created_at: true,
  created_by: true,
  replaced_at: true,
  replaced_by: true,
});

// The table is append-only (BR-13, BR-7): there is no update or delete helper. A day changes by closing
// its current row (`closeAssignmentStatement` only ever sets `replaced_at/replaced_by`) and inserting a new one.

/** For `db.batch([...])`: close the previous row first, then insert the new one (one transaction). */
export function insertAssignmentStatement(db: Db, row: FeedingAssignmentRow) {
  return insertStatement(db, FEEDING_ASSIGNMENTS, row);
}

/** Closes a current row (no effect if it is already closed). */
export function closeAssignmentStatement(db: Db, id: string, now: string, by: string) {
  return db
    .prepare(
      'UPDATE feeding_assignments SET replaced_at = ?, replaced_by = ? WHERE id = ? AND replaced_at IS NULL',
    )
    .bind(now, by, id);
}

/** The current value of one day, or null when nobody is assigned. */
export function getCurrentAssignment(db: Db, date: string): Promise<FeedingAssignmentRow | null> {
  return db
    .prepare('SELECT * FROM feeding_assignments WHERE date = ? AND replaced_at IS NULL')
    .bind(date)
    .first<FeedingAssignmentRow>();
}

/** The current values of the days from `from` to `to` inclusive, in date order. */
export async function listCurrentAssignments(
  db: Db,
  from: string,
  to: string,
): Promise<FeedingAssignmentRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM feeding_assignments WHERE date BETWEEN ? AND ? AND replaced_at IS NULL ORDER BY date',
    )
    .bind(from, to)
    .all<FeedingAssignmentRow>();
  return results;
}

/** Every value a day has had, oldest first (the current one last). */
export async function listAssignmentHistory(db: Db, date: string): Promise<FeedingAssignmentRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM feeding_assignments WHERE date = ? ORDER BY created_at, id')
    .bind(date)
    .all<FeedingAssignmentRow>();
  return results;
}

/** All rows, for the export (current and replaced). */
export async function listAllAssignments(db: Db): Promise<FeedingAssignmentRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM feeding_assignments ORDER BY date, created_at, id')
    .all<FeedingAssignmentRow>();
  return results;
}
