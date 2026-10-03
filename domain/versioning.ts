import type { SnapshotDiff } from './types';

const OMITTED_KEYS = new Set(['updatedAt', 'updated_at', 'version']);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !OMITTED_KEYS.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

/** Builds a JSON-compatible snapshot with deterministic object-key ordering. */
export function buildSnapshot(lineDoc: Record<string, unknown>): Record<string, unknown> {
  return stableValue(lineDoc) as Record<string, unknown>;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function collectDiffs(
  before: unknown,
  after: unknown,
  path: string,
  changes: SnapshotDiff[],
): void {
  if (sameValue(before, after)) return;
  const beforeObject = before !== null && typeof before === 'object' && !Array.isArray(before);
  const afterObject = after !== null && typeof after === 'object' && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const childPath = path === '' ? key : `${path}.${key}`;
      collectDiffs(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        childPath,
        changes,
      );
    }
    return;
  }
  changes.push({ path, before, after });
}

export function diffSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): SnapshotDiff[] {
  const changes: SnapshotDiff[] = [];
  collectDiffs(buildSnapshot(before), buildSnapshot(after), '', changes);
  return changes;
}

export type ChangeType =
  | 'created'
  | 'edited'
  | 'breeding_started'
  | 'genotyping_same_gen'
  | 'genotyping_new_gen'
  | 'closed'
  | 'reopened'
  | 'protocol_changed'
  | 'cryo_changed'
  | 'reference_changed'
  | 'restored'
  | 'imported';

export interface SummaryContext {
  /**
   * A sentence written by the caller for changes the diff cannot describe (an image upload, a
   * reference). Used as-is for every change type except `created` and `imported`.
   */
  text?: string;
  positiveCount?: number;
  idedNumber?: number;
  lineName?: string;
  /** For `restored`: the version whose content was put back. */
  restoredVersionNo?: number;
  /** For `protocol_changed`: what happened to which ID method (T-014). */
  protocolAction?:
    | 'added'
    | 'updated'
    | 'removed'
    | 'restored'
    | 'marked_current'
    | 'unmarked_current'
    | 'reordered';
  protocolLabel?: string;
  /** For `cryo_changed`: what happened to which record, e.g. `C0637–C0644 (8) at Demo freezer shelf` (T-015). */
  cryoAction?: 'added' | 'updated' | 'removed' | 'used' | 'use_undone';
  cryoLabel?: string;
}

function protocolSummary(context: SummaryContext): string {
  const label = context.protocolLabel ?? '';
  if (context.protocolAction === undefined) return 'ID method updated.';
  switch (context.protocolAction) {
    case 'added':
      return `Added ID method: ${label}.`;
    case 'updated':
      return `Updated ID method: ${label}.`;
    case 'removed':
      return `Removed ID method: ${label}.`;
    case 'restored':
      return `Restored ID method: ${label}.`;
    case 'marked_current':
      return `Now a current ID method: ${label}.`;
    case 'unmarked_current':
      return `No longer a current ID method: ${label}.`;
    case 'reordered':
      return 'ID methods reordered.';
  }
}

function cryoSummary(context: SummaryContext): string {
  const label = context.cryoLabel ?? '';
  if (context.cryoAction === undefined) return 'Cryopreservation information updated.';
  if (context.cryoAction === 'used') return `Used cryo vials ${label}.`;
  if (context.cryoAction === 'use_undone') return `Undid a cryo vial use ${label}.`;
  const verb = { added: 'Added', updated: 'Updated', removed: 'Removed' }[context.cryoAction];
  return `${verb} cryo record ${label}.`;
}

/** Human-readable history copy. Callers provide values that are not inferable from a diff. */
export function summarize(
  changeType: ChangeType,
  diff: SnapshotDiff[],
  context: SummaryContext = {},
): string {
  if (context.text !== undefined && changeType !== 'created' && changeType !== 'imported')
    return context.text;
  switch (changeType) {
    case 'created':
      return 'Line created.';
    case 'breeding_started':
      return 'Breeding started.';
    case 'genotyping_same_gen':
      return `Genotyping: +${String(context.positiveCount ?? 0)} positive (total ${String(context.idedNumber ?? 0)}), same generation.`;
    case 'genotyping_new_gen':
      return `Genotyping: +${String(context.positiveCount ?? 0)} positive (total ${String(context.idedNumber ?? 0)}), new generation.`;
    case 'closed':
      return 'Line closed.';
    case 'reopened':
      return 'Line reopened.';
    case 'protocol_changed':
      return protocolSummary(context);
    case 'cryo_changed':
      return cryoSummary(context);
    case 'reference_changed':
      return 'Reference updated.';
    case 'restored':
      return context.restoredVersionNo === undefined
        ? 'Item restored.'
        : `Restored the content of version ${String(context.restoredVersionNo)}.`;
    case 'imported':
      return 'Line imported.';
    case 'edited': {
      if (diff.length === 0) return 'Line details updated.';
      const fields = diff.slice(0, 2).map((change) => change.path.replaceAll('_', ' '));
      return `Line details updated: ${fields.join(', ')}.`;
    }
  }
}
