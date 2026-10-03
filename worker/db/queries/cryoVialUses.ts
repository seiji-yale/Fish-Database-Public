import type { Db } from '../db';
import type { CryoVialUseRow } from '../types';
import { define, insertStatement, listRowsBy } from './shared';

export const CRYO_VIAL_USES = define<CryoVialUseRow>('cryo_vial_uses', {
  id: true,
  line_id: true,
  cryo_record_id: true,
  cryo_id: true,
  quantity: true,
  used_at: true,
  note: true,
  created_at: true,
  created_by: true,
  undone_at: true,
  undone_by: true,
});

/** For `db.batch([...])` (one transaction with the record change it belongs to). */
export function insertCryoVialUseStatement(db: Db, row: CryoVialUseRow) {
  return insertStatement(db, CRYO_VIAL_USES, row);
}

/** The uses that stand: an undone use is history, not a used vial. */
export async function listCryoVialUsesByLine(db: Db, lineId: string): Promise<CryoVialUseRow[]> {
  return (
    await listRowsBy(db, CRYO_VIAL_USES, 'line_id', lineId, 'used_at DESC, created_at DESC, id')
  ).filter((use) => use.undone_at === null);
}

/** Every Cryo ID that is used up, across all lines: these IDs are not handed out again (an undone use frees its ID). */
export async function listUsedCryoIds(db: Db): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT cryo_id FROM cryo_vial_uses WHERE cryo_id IS NOT NULL AND undone_at IS NULL')
    .all<{ cryo_id: string }>();
  return results.map((row) => row.cryo_id);
}
