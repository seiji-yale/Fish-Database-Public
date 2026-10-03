import type { Db } from '../db';
import type { GenotypingRecordRow } from '../types';
import {
  type ListOptions,
  define,
  getRowById,
  insertRow,
  insertStatement,
  listRowsBy,
} from './shared';

export const GENOTYPING_RECORDS = define<GenotypingRecordRow>(
  'genotyping_records',
  {
    id: true,
    line_id: true,
    generation_no: true,
    record_date: true,
    protocol_id: true,
    positive_count: true,
    screened_count: true,
    is_new_generation: true,
    new_dob: true,
    notes: true,
    created_at: true,
    created_by: true,
  },
  false,
);

export function insertGenotypingRecord(db: Db, row: GenotypingRecordRow): Promise<unknown> {
  return insertRow(db, GENOTYPING_RECORDS, row);
}

/** For `db.batch([...])` (one transaction with the rows that belong together). */
export function insertGenotypingRecordStatement(db: Db, row: GenotypingRecordRow) {
  return insertStatement(db, GENOTYPING_RECORDS, row);
}

export function getGenotypingRecordById(db: Db, id: string): Promise<GenotypingRecordRow | null> {
  return getRowById(db, GENOTYPING_RECORDS, id);
}

export function listGenotypingRecordsByLine(
  db: Db,
  lineId: string,
  options?: ListOptions,
): Promise<GenotypingRecordRow[]> {
  return listRowsBy(
    db,
    GENOTYPING_RECORDS,
    'line_id',
    lineId,
    'generation_no, record_date, created_at, id',
    options,
  );
}
