import type { Db } from '../db';
import type { ActivityRow } from '../types';
import { assertNotAdminAuthor, define, getRowById, insertRow, insertStatement } from './shared';

export const ACTIVITIES = define<ActivityRow>('activities', {
  id: true,
  line_id: true,
  user_id: true,
  via_admin: true,
  type: true,
  summary: true,
  ref_type: true,
  ref_id: true,
  created_at: true,
});

/** Throws `AdminAuthorError` when `user_id` is the Admin user (BR-5). Append-only. */
export async function insertActivity(db: Db, row: ActivityRow): Promise<void> {
  await assertNotAdminAuthor(db, row.user_id, 'An activity');
  await insertRow(db, ACTIVITIES, row);
}

/**
 * For `db.batch([...])`. A batch cannot run the Admin check, so callers must resolve the author
 * with `domain/attribution.ts` first; this throws only if an Admin id slips through as `user_id`.
 */
export async function insertActivityStatement(db: Db, row: ActivityRow) {
  await assertNotAdminAuthor(db, row.user_id, 'An activity');
  return insertStatement(db, ACTIVITIES, row);
}

export function getActivityById(db: Db, id: string): Promise<ActivityRow | null> {
  return getRowById(db, ACTIVITIES, id);
}

/** Newest first (Recent Activity). */
export async function listRecentActivities(db: Db, limit: number): Promise<ActivityRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM activities ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(limit)
    .all<ActivityRow>();
  return results;
}

export async function listActivitiesByLine(
  db: Db,
  lineId: string,
  limit: number,
): Promise<ActivityRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM activities WHERE line_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(lineId, limit)
    .all<ActivityRow>();
  return results;
}
