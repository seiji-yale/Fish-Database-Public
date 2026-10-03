import type { Db } from '../db';
import type { ImportRunRow } from '../types';
import { define, getRowById, insertRow } from './shared';

export const IMPORT_RUNS = define<ImportRunRow>('import_runs', {
  id: true,
  source_file: true,
  source_sheet: true,
  mode: true,
  started_at: true,
  finished_at: true,
  report_md: true,
  row_count: true,
});

export function insertImportRun(db: Db, row: ImportRunRow): Promise<unknown> {
  return insertRow(db, IMPORT_RUNS, row);
}

export function getImportRunById(db: Db, id: string): Promise<ImportRunRow | null> {
  return getRowById(db, IMPORT_RUNS, id);
}

/** Newest first. */
export async function listRecentImportRuns(db: Db, limit: number): Promise<ImportRunRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM import_runs ORDER BY started_at DESC, id DESC LIMIT ?')
    .bind(limit)
    .all<ImportRunRow>();
  return results;
}
