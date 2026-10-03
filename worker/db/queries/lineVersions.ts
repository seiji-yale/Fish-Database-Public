import type { Db } from '../db';
import type { LineVersionRow } from '../types';
import { define, getRowById, insertRow, insertStatement } from './shared';

export const LINE_VERSIONS = define<LineVersionRow>('line_versions', {
  id: true,
  line_id: true,
  version_no: true,
  snapshot: true,
  diff: true,
  change_type: true,
  summary: true,
  note: true,
  created_at: true,
  created_by: true,
  via_admin: true,
});

/** History is append-only: there is no update or delete helper. */
export function insertLineVersion(db: Db, row: LineVersionRow): Promise<unknown> {
  return insertRow(db, LINE_VERSIONS, row);
}

/** For `db.batch([...])` together with the line change it records. */
export function insertLineVersionStatement(db: Db, row: LineVersionRow) {
  return insertStatement(db, LINE_VERSIONS, row);
}

export function getLineVersionById(db: Db, id: string): Promise<LineVersionRow | null> {
  return getRowById(db, LINE_VERSIONS, id);
}

export function getLineVersion(
  db: Db,
  lineId: string,
  versionNo: number,
): Promise<LineVersionRow | null> {
  return db
    .prepare('SELECT * FROM line_versions WHERE line_id = ? AND version_no = ?')
    .bind(lineId, versionNo)
    .first<LineVersionRow>();
}

/** Newest first (the History section). */
export async function listLineVersionsByLine(db: Db, lineId: string): Promise<LineVersionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM line_versions WHERE line_id = ? ORDER BY version_no DESC')
    .bind(lineId)
    .all<LineVersionRow>();
  return results;
}
