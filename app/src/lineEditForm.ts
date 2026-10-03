/**
 * The Edit form's state and its conversion to a PATCH body (T-012). Only fields the person
 * changed are sent, so a legacy value that would not pass today's rules (for example an imported
 * line with no DOB) never blocks an unrelated edit.
 */
import type { LineDetailDocument } from './lineDetailApi';

export interface LineEditFormState {
  name: string;
  gene: string;
  dob: string;
  notes: string;
  phenotypes: string[];
  attributes: { key: string; value: string }[];
  /** The optional "Reason / note" (FR-LINE-02). */
  reason: string;
}

export function editFormFrom(line: LineDetailDocument): LineEditFormState {
  return {
    name: line.name,
    gene: line.gene ?? '',
    dob: line.dob ?? '',
    notes: line.notes ?? '',
    phenotypes: line.phenotypes.map((row) => row.description),
    attributes: line.attributes.map((row) => ({ key: row.key, value: row.value ?? '' })),
    reason: '',
  };
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** The PATCH body: `expectedVersion`, the reason, and the fields that differ from `original`. */
export function buildEditPayload(
  form: LineEditFormState,
  original: LineEditFormState,
  expectedVersion: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { expectedVersion, note: form.reason };
  if (form.name !== original.name) payload['name'] = form.name;
  if (form.gene !== original.gene) payload['gene'] = form.gene;
  if (form.dob !== original.dob) payload['dob'] = form.dob;
  if (form.notes !== original.notes) payload['notes'] = form.notes;
  if (!sameJson(form.phenotypes, original.phenotypes)) payload['phenotypes'] = form.phenotypes;
  if (!sameJson(form.attributes, original.attributes)) payload['attributes'] = form.attributes;
  return payload;
}

/** True when the person changed a field or typed a reason: the unsaved-changes guard's test. */
export function editIsDirty(form: LineEditFormState, original: LineEditFormState): boolean {
  return !sameJson(form, original);
}

/** Maps a validation path (`attributes.1.key`) to the DOM id of its input. */
export function editFieldDomId(path: string): string {
  const attribute = /^attributes\.(\d+)\.(.+)$/.exec(path);
  if (attribute !== null) return `el-attr-${String(attribute[1])}-${String(attribute[2])}`;
  return `el-${path}`;
}
