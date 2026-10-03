import type { Db } from '../db';
import type { CryoRecordRow } from '../types';
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

export const CRYO_RECORDS = define<CryoRecordRow>(
  'cryo_records',
  {
    id: true,
    line_id: true,
    cryo_date: true,
    place: true,
    box_name: true,
    cryo_id_start: true,
    cryo_id_end: true,
    count: true,
    details_unknown: true,
    notes: true,
    deleted_at: true,
    created_at: true,
    created_by: true,
  },
  true,
);

export function insertCryoRecord(db: Db, row: CryoRecordRow): Promise<unknown> {
  return insertRow(db, CRYO_RECORDS, row);
}

/** For `db.batch([...])` (one transaction with the rows that belong together). */
export function insertCryoRecordStatement(db: Db, row: CryoRecordRow) {
  return insertStatement(db, CRYO_RECORDS, row);
}

export function getCryoRecordById(db: Db, id: string): Promise<CryoRecordRow | null> {
  return getRowById(db, CRYO_RECORDS, id);
}

export function listCryoRecordsByLine(
  db: Db,
  lineId: string,
  options?: ListOptions,
): Promise<CryoRecordRow[]> {
  return listRowsBy(db, CRYO_RECORDS, 'line_id', lineId, 'created_at, id', options);
}

/** Batch load for list views: one query for every line on the page, grouped by caller. */
export function listCryoRecordsByLines(
  db: Db,
  lineIds: readonly string[],
): Promise<CryoRecordRow[]> {
  return listRowsByIn(db, CRYO_RECORDS, 'line_id', lineIds, 'line_id, created_at, id');
}

/** Hides the row (BR-7). Returns false when the id is unknown or already hidden. */
export function softDeleteCryoRecord(db: Db, id: string, now: string): Promise<boolean> {
  return softDeleteRow(db, CRYO_RECORDS, id, now);
}
