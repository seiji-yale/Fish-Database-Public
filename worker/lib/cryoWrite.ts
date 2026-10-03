/**
 * Cryopreservation record mutations (T-015, FR-CRYO-01/03, BR-6, BR-7): each returns a
 * `LineWriteChange` for `withLineWrite`, which owns the version, the diff and the activity. A
 * removed record gets `deleted_at`; the line is Cryopreserved while any live record remains.
 */
import { cryoRangeCount } from '../../domain/cryo';
import {
  compressCryoIds,
  cryoEditMessages,
  cryoLabelOf,
  cryoUseMessages,
  rangeContains,
  type CryoRecordInput,
  type CryoUseInput,
} from '../../domain/cryoEdit';
import type { ResolvedAuthor } from '../../domain/types';
import type { Db, DbStatement } from '../db/db';
import { newId } from '../db/ids';
import { insertCryoRecordStatement } from '../db/queries/cryoRecords';
import { insertCryoVialUseStatement, listUsedCryoIds } from '../db/queries/cryoVialUses';
import type { CryoRecordRow, CryoVialUseRow } from '../db/types';
import { ApiError } from './errors';
import type { LineDocument, LineWriteChange } from './lineWrite';
import { messages } from './messages';

export function findLiveCryoRecord(before: LineDocument, recordId: string): CryoRecordRow {
  const found = before.cryoRecords.find((record) => record.id === recordId);
  if (found === undefined) throw new ApiError(404, 'CRYO_NOT_FOUND', messages.cryoNotFound);
  return found;
}

function label(row: CryoRecordRow): string {
  return cryoLabelOf({
    cryoIdStart: row.cryo_id_start,
    cryoIdEnd: row.cryo_id_end,
    count: row.count,
    place: row.place,
    cryoDate: row.cryo_date,
    detailsUnknown: row.details_unknown === 1,
  });
}

function invalid(fields: Record<string, string>): ApiError {
  return new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, { fields });
}

/**
 * A place typed under "Other…" joins the `cryo_place` list so it can be picked next time. Existing
 * values (any case) are left alone; `INSERT OR IGNORE` keeps two people saving the same new place
 * at once from failing the batch.
 */
export async function savePlaceStatements(db: Db, place: string | null): Promise<DbStatement[]> {
  if (place === null) return [];
  const existing = await db
    .prepare(
      "SELECT 1 AS found FROM enumerations WHERE kind = 'cryo_place' AND lower(value) = lower(?)",
    )
    .bind(place)
    .first<{ found: number }>();
  if (existing !== null) return [];
  const last = await db
    .prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS last FROM enumerations WHERE kind = 'cryo_place'",
    )
    .first<{ last: number }>();
  return [
    db
      .prepare(
        "INSERT OR IGNORE INTO enumerations (id, kind, value, sort_order, is_active) VALUES (?, 'cryo_place', ?, ?, 1)",
      )
      .bind(newId(), place, (last?.last ?? 0) + 1),
  ];
}

/** Registered IDs that were used before can never be registered again (owner rule 2026-09-30). */
export function assertNoUsedIds(
  start: string | null,
  end: string | null,
  usedIds: readonly string[],
  allowed: ReadonlySet<string> = new Set(),
  field = 'cryoIdStart',
): void {
  const clash = usedIds.find((id) => !allowed.has(id) && rangeContains(start, end, id));
  if (clash !== undefined) throw invalid({ [field]: cryoUseMessages.reusedId(clash) });
}

export async function addCryoChange(
  db: Db,
  before: LineDocument,
  input: CryoRecordInput,
  author: ResolvedAuthor,
  now: string,
): Promise<LineWriteChange> {
  assertNoUsedIds(input.cryoIdStart, input.cryoIdEnd, await listUsedCryoIds(db));
  const row: CryoRecordRow = {
    id: newId(),
    line_id: before.line.id,
    cryo_date: input.cryoDate,
    place: input.place,
    box_name: input.boxName,
    cryo_id_start: input.cryoIdStart,
    cryo_id_end: input.cryoIdEnd,
    count: input.count,
    details_unknown: input.detailsUnknown ? 1 : 0,
    notes: input.notes,
    deleted_at: null,
    created_at: now,
    created_by: author.authorId,
  };
  return {
    line: {},
    statements: [
      ...(await savePlaceStatements(db, input.place)),
      insertCryoRecordStatement(db, row),
    ],
    children: { cryoRecords: [...before.cryoRecords, row] },
    summaryContext: { cryoAction: 'added', cryoLabel: label(row) },
  };
}

export async function editCryoChange(
  db: Db,
  before: LineDocument,
  recordId: string,
  input: CryoRecordInput,
): Promise<LineWriteChange> {
  const current = findLiveCryoRecord(before, recordId);
  // Vials already taken out of this record: its range must keep them, and the count is what is left.
  const { results } = await db
    .prepare(
      'SELECT cryo_id, quantity FROM cryo_vial_uses WHERE cryo_record_id = ? AND undone_at IS NULL',
    )
    .bind(recordId)
    .all<{ cryo_id: string | null; quantity: number }>();
  const ownUsedIds = results.flatMap((row) => (row.cryo_id === null ? [] : [row.cryo_id]));
  const usedQuantity = results.reduce((sum, row) => sum + row.quantity, 0);
  const { cryoIdStart: start, cryoIdEnd: end } = input;
  const outside = ownUsedIds.filter((id) => !rangeContains(start, end, id));
  if (outside.length > 0)
    throw invalid({ cryoIdStart: cryoUseMessages.usedIdOutside(compressCryoIds(outside)) });
  assertNoUsedIds(start, end, await listUsedCryoIds(db), new Set(ownUsedIds));
  const total = cryoRangeCount(start, end);
  const remaining = total === null ? input.count : total - usedQuantity;
  if (total !== null && (remaining ?? 0) < 1)
    throw invalid({ cryoIdEnd: cryoEditMessages.nothingLeft });
  const next: CryoRecordRow = {
    ...current,
    cryo_date: input.cryoDate,
    place: input.place,
    box_name: input.boxName,
    cryo_id_start: input.cryoIdStart,
    cryo_id_end: input.cryoIdEnd,
    count: remaining,
    details_unknown: input.detailsUnknown ? 1 : 0,
    notes: input.notes,
  };
  return {
    line: {},
    statements: [
      ...(await savePlaceStatements(db, input.place)),
      db
        .prepare(
          `UPDATE cryo_records SET cryo_date = ?, place = ?, box_name = ?, cryo_id_start = ?,
             cryo_id_end = ?, count = ?, details_unknown = ?, notes = ? WHERE id = ?`,
        )
        .bind(
          next.cryo_date,
          next.place,
          next.box_name,
          next.cryo_id_start,
          next.cryo_id_end,
          next.count,
          next.details_unknown,
          next.notes,
          recordId,
        ),
    ],
    children: {
      cryoRecords: before.cryoRecords.map((record) => (record.id === recordId ? next : record)),
    },
    summaryContext: { cryoAction: 'updated', cryoLabel: label(next) },
  };
}

export function removeCryoChange(
  db: Db,
  before: LineDocument,
  recordId: string,
  now: string,
): LineWriteChange {
  const removed = findLiveCryoRecord(before, recordId);
  return {
    line: {},
    statements: [
      db.prepare('UPDATE cryo_records SET deleted_at = ? WHERE id = ?').bind(now, recordId),
    ],
    children: { cryoRecords: before.cryoRecords.filter((record) => record.id !== recordId) },
    summaryContext: { cryoAction: 'removed', cryoLabel: label(removed) },
  };
}

/**
 * Takes vials out of the line's records and writes them down as used (one row per Cryo ID, or one
 * row with a quantity for a record without IDs). The record's count goes down; a record with no
 * vial left is soft-deleted, so the line stops being Cryopreserved when its last vial is used (BR-6).
 */
export async function useVialsChange(
  db: Db,
  before: LineDocument,
  input: CryoUseInput,
  author: ResolvedAuthor,
  now: string,
): Promise<LineWriteChange> {
  const taken = new Map<string, number>();
  const uses: CryoVialUseRow[] = [];
  const addUse = (record: CryoRecordRow, cryoId: string | null, quantity: number) => {
    taken.set(record.id, (taken.get(record.id) ?? 0) + quantity);
    uses.push({
      id: newId(),
      line_id: before.line.id,
      cryo_record_id: record.id,
      cryo_id: cryoId,
      quantity,
      used_at: input.usedAt,
      note: input.note,
      created_at: now,
      created_by: author.authorId,
      undone_at: null,
      undone_by: null,
    });
  };

  if (input.ids.length > 0) {
    const usedIds = new Set(await listUsedCryoIds(db));
    for (const id of input.ids) {
      if (usedIds.has(id)) throw invalid({ vialIds: cryoUseMessages.idAlreadyUsed(id) });
      const record = before.cryoRecords.find((entry) =>
        rangeContains(entry.cryo_id_start, entry.cryo_id_end, id),
      );
      if (record === undefined) throw invalid({ vialIds: cryoUseMessages.idNotOnLine(id) });
      addUse(record, id, 1);
    }
  } else {
    const record = before.cryoRecords.find((entry) => entry.id === input.recordId);
    if (record === undefined) throw invalid({ vialIds: cryoUseMessages.recordRequired });
    if (record.cryo_id_start !== null) throw invalid({ vialIds: cryoUseMessages.recordHasIds });
    const quantity = input.quantity ?? 0;
    if (quantity > (record.count ?? 0))
      throw invalid({ quantity: cryoUseMessages.quantityTooMany(record.count ?? 0) });
    addUse(record, null, quantity);
  }

  const statements: DbStatement[] = uses.map((use) => insertCryoVialUseStatement(db, use));
  const emptied: string[] = [];
  const after: CryoRecordRow[] = [];
  for (const record of before.cryoRecords) {
    const n = taken.get(record.id);
    if (n === undefined) {
      after.push(record);
      continue;
    }
    const total = record.count ?? cryoRangeCount(record.cryo_id_start, record.cryo_id_end) ?? n;
    const left = Math.max(0, total - n);
    if (left === 0) {
      emptied.push(record.id);
      statements.push(
        db
          .prepare('UPDATE cryo_records SET count = 0, deleted_at = ? WHERE id = ?')
          .bind(now, record.id),
      );
    } else {
      statements.push(
        db.prepare('UPDATE cryo_records SET count = ? WHERE id = ?').bind(left, record.id),
      );
      after.push({ ...record, count: left });
    }
  }
  const usedLabel =
    input.ids.length > 0
      ? `${compressCryoIds(input.ids)} (${String(input.ids.length)})`
      : `${String(input.quantity ?? 0)} from ${label(before.cryoRecords.find((r) => r.id === input.recordId) as CryoRecordRow)}`;
  return {
    line: {},
    statements,
    children: { cryoRecords: after },
    summaryContext: {
      cryoAction: 'used',
      cryoLabel: emptied.length > 0 ? `${usedLabel}; no vial left in the record` : usedLabel,
    },
  };
}

/**
 * Undoes one recorded vial use (T-028, OQ-38): the use is marked undone (the row stays, BR-7), the
 * vial(s) go back into the record they came from and the record's count goes up. A record that was
 * emptied by this use comes back with it; one that a person removed on purpose does not (it must be
 * restored first), and a record whose IDs now belong to another live record cannot take them back.
 */
export async function undoVialUseChange(
  db: Db,
  before: LineDocument,
  useId: string,
  author: ResolvedAuthor,
  now: string,
): Promise<LineWriteChange> {
  const use = await db
    .prepare('SELECT * FROM cryo_vial_uses WHERE id = ? AND line_id = ?')
    .bind(useId, before.line.id)
    .first<CryoVialUseRow>();
  if (use === null) throw new ApiError(404, 'USE_NOT_FOUND', cryoUseMessages.useNotFound);
  if (use.undone_at !== null)
    throw new ApiError(409, 'ALREADY_UNDONE', cryoUseMessages.alreadyUndone);
  const record = await db
    .prepare('SELECT * FROM cryo_records WHERE id = ?')
    .bind(use.cryo_record_id)
    .first<CryoRecordRow>();
  if (record === null) throw new ApiError(404, 'USE_NOT_FOUND', cryoUseMessages.useNotFound);

  const statements: DbStatement[] = [
    db
      .prepare(
        'UPDATE cryo_vial_uses SET undone_at = ?, undone_by = ? WHERE id = ? AND undone_at IS NULL',
      )
      .bind(now, author.authorId, use.id),
  ];
  let after: CryoRecordRow[];
  if (record.deleted_at === null) {
    const count = (record.count ?? 0) + use.quantity;
    statements.push(
      db.prepare('UPDATE cryo_records SET count = ? WHERE id = ?').bind(count, record.id),
    );
    after = before.cryoRecords.map((row) => (row.id === record.id ? { ...row, count } : row));
  } else if ((record.count ?? 0) === 0) {
    // Emptied by using its last vials: the record comes back holding the vials that return.
    const clash = before.cryoRecords.some(
      (other) =>
        record.cryo_id_start !== null &&
        other.cryo_id_start !== null &&
        (rangeContains(record.cryo_id_start, record.cryo_id_end, other.cryo_id_start) ||
          rangeContains(other.cryo_id_start, other.cryo_id_end, record.cryo_id_start)),
    );
    if (clash) throw new ApiError(409, 'NOT_RESTORABLE', cryoUseMessages.idsInUse);
    statements.push(
      db
        .prepare('UPDATE cryo_records SET count = ?, deleted_at = NULL WHERE id = ?')
        .bind(use.quantity, record.id),
    );
    after = [...before.cryoRecords, { ...record, count: use.quantity, deleted_at: null }];
  } else {
    throw new ApiError(409, 'RECORD_REMOVED', cryoUseMessages.recordRemoved);
  }
  const what = use.cryo_id ?? `${String(use.quantity)} vial(s)`;
  return {
    line: {},
    statements,
    children: { cryoRecords: after },
    summaryContext: { cryoAction: 'use_undone', cryoLabel: `${what} (${label(record)})` },
  };
}

/**
 * Admin: brings a removed cryo record back. A record emptied by using its last vials cannot come
 * back (it has none left), and neither can one whose IDs now belong to a live record.
 */
export function restoreCryoChange(
  db: Db,
  before: LineDocument,
  deleted: CryoRecordRow,
  otherLiveRecords: readonly CryoRecordRow[],
): LineWriteChange {
  if (deleted.count !== null && deleted.count < 1)
    throw new ApiError(
      409,
      'NOT_RESTORABLE',
      messages.deletedNotRestorable('every vial of it was used.'),
    );
  const { cryo_id_start: start, cryo_id_end: end } = deleted;
  const clash = otherLiveRecords.find(
    (record) =>
      start !== null &&
      end !== null &&
      record.cryo_id_start !== null &&
      record.cryo_id_end !== null &&
      (rangeContains(start, end, record.cryo_id_start) ||
        rangeContains(record.cryo_id_start, record.cryo_id_end, start)),
  );
  if (clash !== undefined)
    throw new ApiError(
      409,
      'NOT_RESTORABLE',
      messages.deletedNotRestorable('its Cryo IDs are in use by another record of a line.'),
    );
  const restored: CryoRecordRow = { ...deleted, deleted_at: null };
  return {
    line: {},
    statements: [
      db.prepare('UPDATE cryo_records SET deleted_at = NULL WHERE id = ?').bind(deleted.id),
    ],
    children: { cryoRecords: [...before.cryoRecords, restored] },
    summaryContext: { text: `Restored cryo record ${label(restored)}.` },
  };
}
