import type { Db } from '../db';
import type { MirrorRunRow } from '../types';
import { define, getRowById, insertRow } from './shared';

export const MIRROR_RUNS = define<MirrorRunRow>('mirror_runs', {
  id: true,
  kind: true,
  status: true,
  started_at: true,
  finished_at: true,
  files_written: true,
  error: true,
});

export function insertMirrorRun(db: Db, row: MirrorRunRow): Promise<unknown> {
  return insertRow(db, MIRROR_RUNS, row);
}

export function getMirrorRunById(db: Db, id: string): Promise<MirrorRunRow | null> {
  return getRowById(db, MIRROR_RUNS, id);
}

/** Newest first. */
export async function listRecentMirrorRuns(db: Db, limit: number): Promise<MirrorRunRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM mirror_runs ORDER BY started_at DESC, id DESC LIMIT ?')
    .bind(limit)
    .all<MirrorRunRow>();
  return results;
}
