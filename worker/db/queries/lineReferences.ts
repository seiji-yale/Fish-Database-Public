import type { Db } from '../db';
import type { LineReferenceRow } from '../types';
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

export const LINE_REFERENCES = define<LineReferenceRow>(
  'line_references',
  {
    id: true,
    line_id: true,
    title: true,
    url: true,
    attachment_id: true,
    note: true,
    sort_order: true,
    deleted_at: true,
    created_at: true,
    created_by: true,
  },
  true,
);

export function insertLineReference(db: Db, row: LineReferenceRow): Promise<unknown> {
  return insertRow(db, LINE_REFERENCES, row);
}

/** For `db.batch([...])` (one transaction with the rows that belong together). */
export function insertLineReferenceStatement(db: Db, row: LineReferenceRow) {
  return insertStatement(db, LINE_REFERENCES, row);
}

export function getLineReferenceById(db: Db, id: string): Promise<LineReferenceRow | null> {
  return getRowById(db, LINE_REFERENCES, id);
}

export function listLineReferencesByLine(
  db: Db,
  lineId: string,
  options?: ListOptions,
): Promise<LineReferenceRow[]> {
  return listRowsBy(db, LINE_REFERENCES, 'line_id', lineId, 'sort_order, id', options);
}

/** Batch load for list views: one query for every line on the page, grouped by caller. */
export function listLineReferencesByLines(
  db: Db,
  lineIds: readonly string[],
): Promise<LineReferenceRow[]> {
  return listRowsByIn(db, LINE_REFERENCES, 'line_id', lineIds, 'line_id, sort_order, id');
}

/** Hides the row (BR-7). Returns false when the id is unknown or already hidden. */
export function softDeleteLineReference(db: Db, id: string, now: string): Promise<boolean> {
  return softDeleteRow(db, LINE_REFERENCES, id, now);
}
