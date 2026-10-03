import type { Db } from '../db';
import type { LinePhenotypeRow } from '../types';
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

export const LINE_PHENOTYPES = define<LinePhenotypeRow>(
  'line_phenotypes',
  {
    id: true,
    line_id: true,
    description: true,
    sort_order: true,
    deleted_at: true,
  },
  true,
);

export function insertLinePhenotype(db: Db, row: LinePhenotypeRow): Promise<unknown> {
  return insertRow(db, LINE_PHENOTYPES, row);
}

/** For `db.batch([...])` (one transaction with the rows that belong together). */
export function insertLinePhenotypeStatement(db: Db, row: LinePhenotypeRow) {
  return insertStatement(db, LINE_PHENOTYPES, row);
}

export function getLinePhenotypeById(db: Db, id: string): Promise<LinePhenotypeRow | null> {
  return getRowById(db, LINE_PHENOTYPES, id);
}

export function listLinePhenotypesByLine(
  db: Db,
  lineId: string,
  options?: ListOptions,
): Promise<LinePhenotypeRow[]> {
  return listRowsBy(db, LINE_PHENOTYPES, 'line_id', lineId, 'sort_order, id', options);
}

/** Batch load for list views: one query for every line on the page, grouped by caller. */
export function listLinePhenotypesByLines(
  db: Db,
  lineIds: readonly string[],
): Promise<LinePhenotypeRow[]> {
  return listRowsByIn(db, LINE_PHENOTYPES, 'line_id', lineIds, 'line_id, sort_order, id');
}

/** Hides the row (BR-7). Returns false when the id is unknown or already hidden. */
export function softDeleteLinePhenotype(db: Db, id: string, now: string): Promise<boolean> {
  return softDeleteRow(db, LINE_PHENOTYPES, id, now);
}
