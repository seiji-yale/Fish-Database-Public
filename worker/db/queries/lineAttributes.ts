import type { Db } from '../db';
import type { LineAttributeRow } from '../types';
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

export const LINE_ATTRIBUTES = define<LineAttributeRow>(
  'line_attributes',
  {
    id: true,
    line_id: true,
    key: true,
    value: true,
    sort_order: true,
    deleted_at: true,
  },
  true,
);

export function insertLineAttribute(db: Db, row: LineAttributeRow): Promise<unknown> {
  return insertRow(db, LINE_ATTRIBUTES, row);
}

/** For `db.batch([...])` (one transaction with the rows that belong together). */
export function insertLineAttributeStatement(db: Db, row: LineAttributeRow) {
  return insertStatement(db, LINE_ATTRIBUTES, row);
}

export function getLineAttributeById(db: Db, id: string): Promise<LineAttributeRow | null> {
  return getRowById(db, LINE_ATTRIBUTES, id);
}

export function listLineAttributesByLine(
  db: Db,
  lineId: string,
  options?: ListOptions,
): Promise<LineAttributeRow[]> {
  return listRowsBy(db, LINE_ATTRIBUTES, 'line_id', lineId, 'sort_order, id', options);
}

/** Batch load for list views: one query for every line on the page, grouped by caller. */
export function listLineAttributesByLines(
  db: Db,
  lineIds: readonly string[],
): Promise<LineAttributeRow[]> {
  return listRowsByIn(db, LINE_ATTRIBUTES, 'line_id', lineIds, 'line_id, sort_order, id');
}

/** Hides the row (BR-7). Returns false when the id is unknown or already hidden. */
export function softDeleteLineAttribute(db: Db, id: string, now: string): Promise<boolean> {
  return softDeleteRow(db, LINE_ATTRIBUTES, id, now);
}
