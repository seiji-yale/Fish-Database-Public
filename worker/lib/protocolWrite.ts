/**
 * ID protocol mutations (T-014, FR-ID-01…09): each returns a `LineWriteChange` for `withLineWrite`,
 * which owns the version, the diff and the activity. Nothing is deleted: a removed protocol gets
 * `deleted_at` (BR-7) and an Admin can bring it back.
 *
 * A line can have several current methods (`is_current` per protocol); `lines.current_protocol_id`
 * stays the primary one and is recomputed here after every change (`domain/currentProtocols.ts`).
 * Every write also repairs the flag of older rows that had only the pointer.
 *
 * Write order (docs/03-data-model.md section 7): a new protocol is inserted before the `UPDATE lines`
 * that points `current_protocol_id` at it — `withLineWrite` puts the handler's statements before
 * that update — because hosted D1 ignores the deferred foreign key.
 */
import { currentProtocols, primaryAfter } from '../../domain/currentProtocols';
import type { ProtocolDefaults } from '../../domain/protocolTemplates';
import { getSetting } from '../db/queries/settings';
import type { NewLineProtocol } from '../../domain/newLine';
import type { Db, DbStatement } from '../db/db';
import { newId } from '../db/ids';
import { insertIdProtocolStatement } from '../db/queries/idProtocols';
import type { IdProtocolRow } from '../db/types';
import { ApiError } from './errors';
import type { LineDocument, LineWriteChange } from './lineWrite';
import { messages } from './messages';

export function findLiveProtocol(before: LineDocument, protocolId: string): IdProtocolRow {
  const found = before.protocols.find((protocol) => protocol.id === protocolId);
  if (found === undefined) throw new ApiError(404, 'PROTOCOL_NOT_FOUND', messages.protocolNotFound);
  return found;
}

export function otherLabels(before: LineDocument, exceptId?: string): string[] {
  return before.protocols.filter((protocol) => protocol.id !== exceptId).map((row) => row.label);
}

/** The line's protocols with `is_current` made to match the current set (pointer included). */
function normalized(before: LineDocument): IdProtocolRow[] {
  const current = new Set(
    currentProtocols(before.line.current_protocol_id, before.protocols).map((row) => row.id),
  );
  return before.protocols.map((row) => ({ ...row, is_current: current.has(row.id) ? 1 : 0 }));
}

/**
 * The change for the protocols `after` (flags already as wanted): the flag updates of rows that
 * exist already, the recomputed primary pointer, and the extra statements of the mutation.
 */
function finalize(
  db: Db,
  before: LineDocument,
  after: readonly IdProtocolRow[],
  statements: DbStatement[],
  summaryContext: NonNullable<LineWriteChange['summaryContext']>,
): LineWriteChange {
  const stored = new Map(before.protocols.map((row) => [row.id, row.is_current]));
  const flagUpdates = after
    .filter((row) => stored.has(row.id) && stored.get(row.id) !== row.is_current)
    .map((row) =>
      db
        .prepare('UPDATE id_protocols SET is_current = ? WHERE id = ?')
        .bind(row.is_current, row.id),
    );
  const primary = primaryAfter(
    before.line.current_protocol_id,
    currentProtocols(null, after).filter((row) => row.is_current === 1),
  );
  return {
    line: primary === before.line.current_protocol_id ? {} : { current_protocol_id: primary },
    statements: [...statements, ...flagUpdates],
    children: { protocols: [...after] },
    summaryContext,
  };
}

export function addProtocolChange(
  db: Db,
  before: LineDocument,
  protocol: NewLineProtocol,
  setCurrent: boolean,
  now: string,
): LineWriteChange {
  const base = normalized(before);
  const sortOrder = base.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
  const row: IdProtocolRow = {
    id: newId(),
    line_id: before.line.id,
    protocol_type: protocol.type,
    label: protocol.label,
    fields: JSON.stringify(protocol.fields),
    notes: protocol.notes,
    sort_order: sortOrder,
    // The first protocol of a line becomes current (FR-ID-01); later ones only on request.
    is_current: setCurrent || !base.some((entry) => entry.is_current === 1) ? 1 : 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  return finalize(db, before, [...base, row], [insertIdProtocolStatement(db, row)], {
    protocolAction: 'added',
    protocolLabel: row.label,
  });
}

export function editProtocolChange(
  db: Db,
  before: LineDocument,
  protocolId: string,
  protocol: NewLineProtocol,
  now: string,
): LineWriteChange {
  findLiveProtocol(before, protocolId);
  const after = normalized(before).map((row) =>
    row.id === protocolId
      ? {
          ...row,
          label: protocol.label,
          fields: JSON.stringify(protocol.fields),
          notes: protocol.notes,
          updated_at: now,
        }
      : row,
  );
  const edited = after.find((row) => row.id === protocolId) as IdProtocolRow;
  return finalize(
    db,
    before,
    after,
    [
      db
        .prepare(
          'UPDATE id_protocols SET label = ?, fields = ?, notes = ?, updated_at = ? WHERE id = ?',
        )
        .bind(edited.label, edited.fields, edited.notes, now, protocolId),
    ],
    { protocolAction: 'updated', protocolLabel: protocol.label },
  );
}

/** Soft delete; the line's current methods are whatever remains flagged (possibly none). */
export function removeProtocolChange(
  db: Db,
  before: LineDocument,
  protocolId: string,
  now: string,
): LineWriteChange {
  const removed = findLiveProtocol(before, protocolId);
  const after = normalized(before).filter((row) => row.id !== protocolId);
  return finalize(
    db,
    before,
    after,
    [
      db
        .prepare(
          'UPDATE id_protocols SET deleted_at = ?, is_current = 0, updated_at = ? WHERE id = ?',
        )
        .bind(now, now, protocolId),
    ],
    { protocolAction: 'removed', protocolLabel: removed.label },
  );
}

/** Marks a protocol as one of the line's current methods, or takes the mark away. */
export function setCurrentChange(
  db: Db,
  before: LineDocument,
  protocolId: string,
  current: boolean,
): LineWriteChange {
  const chosen = findLiveProtocol(before, protocolId);
  const after = normalized(before).map((row) =>
    row.id === protocolId ? { ...row, is_current: current ? 1 : 0 } : row,
  );
  return finalize(db, before, after, [], {
    protocolAction: current ? 'marked_current' : 'unmarked_current',
    protocolLabel: chosen.label,
  });
}

export function reorderChange(
  db: Db,
  before: LineDocument,
  order: readonly string[],
): LineWriteChange {
  const byId = new Map(normalized(before).map((row) => [row.id, row]));
  const statements: DbStatement[] = [];
  const protocols = order.map((id, index): IdProtocolRow => {
    const row = byId.get(id) as IdProtocolRow;
    if (row.sort_order !== index)
      statements.push(
        db.prepare('UPDATE id_protocols SET sort_order = ? WHERE id = ?').bind(index, id),
      );
    return { ...row, sort_order: index };
  });
  return finalize(db, before, protocols, statements, { protocolAction: 'reordered' });
}

/** Admin: brings a removed protocol back at the end of the list (its old place may be taken). */
export function restoreProtocolChange(
  db: Db,
  before: LineDocument,
  deleted: IdProtocolRow,
  now: string,
): LineWriteChange {
  const base = normalized(before);
  const sortOrder = base.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
  const restored: IdProtocolRow = {
    ...deleted,
    deleted_at: null,
    sort_order: sortOrder,
    // A line with no current method gets it back as its current one.
    is_current: base.some((row) => row.is_current === 1) ? 0 : 1,
    updated_at: now,
  };
  return finalize(
    db,
    before,
    [...base, restored],
    [
      db
        .prepare(
          'UPDATE id_protocols SET deleted_at = NULL, sort_order = ?, is_current = ?, updated_at = ? WHERE id = ?',
        )
        .bind(sortOrder, restored.is_current, now, deleted.id),
    ],
    { protocolAction: 'restored', protocolLabel: restored.label },
  );
}

/** The Admin-set defaults for new PCR protocols (Settings): annealing temperature and cycles. */
export async function protocolDefaultsFrom(db: Db): Promise<ProtocolDefaults> {
  const [annealing, cycles] = await Promise.all([
    getSetting(db, 'default_annealing_c'),
    getSetting(db, 'default_cycles'),
  ]);
  const number = (value: string | null) =>
    value !== null && Number.isFinite(Number(value)) ? Number(value) : undefined;
  return {
    ...(number(annealing) === undefined ? {} : { annealing_c: number(annealing) as number }),
    ...(number(cycles) === undefined ? {} : { cycles: number(cycles) as number }),
  };
}
