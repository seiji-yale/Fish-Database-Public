import type { Db } from '../db';
import type { ScheduleEventRow } from '../types';
import { define, insertStatement } from './shared';

export const SCHEDULE_EVENTS = define<ScheduleEventRow>(
  'schedule_events',
  {
    id: true,
    date: true,
    series_id: true,
    title: true,
    note: true,
    created_at: true,
    created_by: true,
    updated_at: true,
    updated_by: true,
    deleted_at: true,
    deleted_by: true,
  },
  true,
);

export function insertEventStatement(db: Db, row: ScheduleEventRow) {
  return insertStatement(db, SCHEDULE_EVENTS, row);
}

/** Edits title and note in place (OQ-43: no before/after history); a deleted row is not touched. */
export function updateEventStatement(
  db: Db,
  id: string,
  change: { title: string; note: string | null; updatedAt: string; updatedBy: string },
) {
  return db
    .prepare(
      'UPDATE schedule_events SET title = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL',
    )
    .bind(change.title, change.note, change.updatedAt, change.updatedBy, id);
}

/** Soft delete (BR-7); a row that is already deleted keeps its first deletion. */
export function softDeleteEventStatement(db: Db, id: string, now: string, by: string) {
  return db
    .prepare(
      'UPDATE schedule_events SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL',
    )
    .bind(now, by, id);
}

/** The live events of the days from `from` to `to` inclusive, in date order. */
export async function listEventsInRange(
  db: Db,
  from: string,
  to: string,
): Promise<ScheduleEventRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM schedule_events WHERE date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date, created_at, id',
    )
    .bind(from, to)
    .all<ScheduleEventRow>();
  return results;
}

/** A live event by id (null when unknown or deleted). */
export function getLiveEvent(db: Db, id: string): Promise<ScheduleEventRow | null> {
  return db
    .prepare('SELECT * FROM schedule_events WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<ScheduleEventRow>();
}

/** The live rows of one series on or after `fromDate`, in date order (BR-19 `scope=following`). */
export async function listSeriesFrom(
  db: Db,
  seriesId: string,
  fromDate: string,
): Promise<ScheduleEventRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM schedule_events WHERE series_id = ? AND date >= ? AND deleted_at IS NULL ORDER BY date, id',
    )
    .bind(seriesId, fromDate)
    .all<ScheduleEventRow>();
  return results;
}

/** Every event including deleted ones, for the export. */
export async function listAllEvents(db: Db): Promise<ScheduleEventRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM schedule_events ORDER BY date, created_at, id')
    .all<ScheduleEventRow>();
  return results;
}

/**
 * The live rows (series id and date) of every series that has an event in `from … to`, from `from` on:
 * enough to count, for each event of that period, how many occurrences follow it (`followingCount`).
 */
export async function listSeriesDatesFrom(
  db: Db,
  from: string,
  to: string,
): Promise<{ series_id: string; date: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT series_id, date FROM schedule_events
        WHERE deleted_at IS NULL AND date >= ?
          AND series_id IN (
            SELECT series_id FROM schedule_events
             WHERE series_id IS NOT NULL AND deleted_at IS NULL AND date BETWEEN ? AND ?)`,
    )
    .bind(from, from, to)
    .all<{ series_id: string; date: string }>();
  return results;
}
