import type { Db } from '../db';
import type { EnumerationKind, EnumerationRow } from '../types';
import { define, getRowById, insertRow } from './shared';

export const ENUMERATIONS = define<EnumerationRow>('enumerations', {
  id: true,
  kind: true,
  value: true,
  sort_order: true,
  is_active: true,
});

export function insertEnumeration(db: Db, row: EnumerationRow): Promise<unknown> {
  return insertRow(db, ENUMERATIONS, row);
}

export function getEnumerationById(db: Db, id: string): Promise<EnumerationRow | null> {
  return getRowById(db, ENUMERATIONS, id);
}

/** Disabled values are hidden from pickers; `includeInactive` is for the Admin editor. */
export async function listEnumerations(
  db: Db,
  kind: EnumerationKind,
  options: { includeInactive?: boolean } = {},
): Promise<EnumerationRow[]> {
  const filter = options.includeInactive === true ? '1 = 1' : 'is_active = 1';
  const { results } = await db
    .prepare(`SELECT * FROM enumerations WHERE kind = ? AND ${filter} ORDER BY sort_order, value`)
    .bind(kind)
    .all<EnumerationRow>();
  return results;
}
