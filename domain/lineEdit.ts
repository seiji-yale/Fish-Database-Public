/**
 * Editing a line's descriptive fields (T-012, FR-LINE-02/03, BR-8, BR-12) and restoring them from
 * an earlier version (FR-HIST-02).
 *
 * "Descriptive content" is what the Edit form changes: name, gene, notes, DOB, phenotypes and More
 * attributes. Status, IDed number, protocols, cryo records and references have their own tickets
 * (T-013…T-016), so a restore puts back only the descriptive content (OQ-36): it never rewinds
 * genotyping totals or protocols that other records depend on.
 */
import { z } from 'zod';
import {
  addAttributeIssues,
  attributesField,
  cleanPhenotypes,
  dobField,
  nameField,
  newLineMessages,
  phenotypesField,
} from './newLine';

export interface DescriptiveContent {
  name: string;
  gene: string | null;
  notes: string | null;
  dob: string | null;
  phenotypes: string[];
  attributes: { key: string; value: string | null }[];
}

export const editLineMessages = {
  expectedVersionInvalid: 'Reload the page and try again.',
  noteTooLong: newLineMessages.textTooLong(500),
} as const;

/** Text that may be omitted (leave unchanged) or blank/null (clear it). */
const patchText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, newLineMessages.textTooLong(max))
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value))
    .optional();

export function editLineSchema(today: string) {
  return z
    .object({
      expectedVersion: z
        .unknown()
        .refine(
          (value) => Number.isInteger(value) && Number(value) >= 1,
          editLineMessages.expectedVersionInvalid,
        )
        .transform((value) => value as number),
      note: patchText(500),
      name: nameField.optional(),
      gene: patchText(200),
      notes: patchText(5000),
      dob: dobField(today).optional(),
      phenotypes: phenotypesField.optional(),
      attributes: attributesField.optional(),
    })
    .superRefine((value, context) => {
      if (value.attributes !== undefined)
        addAttributeIssues(value.attributes, context, ['attributes']);
    });
}

export interface LineEdit {
  expectedVersion: number;
  /** The optional "Reason / note" (FR-LINE-02). */
  note: string | null;
  /** Only the fields the person sent. */
  changes: Partial<DescriptiveContent>;
}

export type LineEditValidation =
  { ok: true; value: LineEdit } | { ok: false; errors: Record<string, string> };

export function validateLineEdit(input: unknown, today: string): LineEditValidation {
  const parsed = editLineSchema(today).safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.');
      errors[path === '' ? 'form' : path] ??= issue.message;
    }
    return { ok: false, errors };
  }
  const { expectedVersion, note, ...fields } = parsed.data;
  const changes: Partial<DescriptiveContent> = {};
  if (fields.name !== undefined) changes.name = fields.name;
  if (fields.gene !== undefined) changes.gene = fields.gene;
  if (fields.notes !== undefined) changes.notes = fields.notes;
  if (fields.dob !== undefined) changes.dob = fields.dob;
  if (fields.phenotypes !== undefined) changes.phenotypes = cleanPhenotypes(fields.phenotypes);
  if (fields.attributes !== undefined) changes.attributes = fields.attributes;
  return { ok: true, value: { expectedVersion, note: note ?? null, changes } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The descriptive content stored in a `line_versions.snapshot`, or null when the snapshot has a
 * shape this code does not know. Two shapes exist: the document written by every write path
 * (`{ line, phenotypes: rows, attributes: rows, ... }`) and the flat one the Excel import wrote for
 * version 1 (`{ name, gene, phenotypes: strings, source_attribute, ... }`, docs/03-data-model.md 2.12).
 */
export function descriptiveFromSnapshot(snapshot: unknown): DescriptiveContent | null {
  if (!isRecord(snapshot)) return null;
  const line = snapshot['line'];
  if (isRecord(line)) {
    if (typeof line['name'] !== 'string') return null;
    const rows = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
    return {
      name: line['name'],
      gene: textOrNull(line['gene']),
      notes: textOrNull(line['notes']),
      dob: textOrNull(line['dob']),
      phenotypes: rows(snapshot['phenotypes'])
        .map((row) => row['description'])
        .filter((description): description is string => typeof description === 'string'),
      attributes: rows(snapshot['attributes'])
        .filter((row) => typeof row['key'] === 'string')
        .map((row) => ({ key: String(row['key']), value: textOrNull(row['value']) })),
    };
  }
  if (typeof snapshot['name'] !== 'string') return null;
  const source = textOrNull(snapshot['source_attribute']);
  const keyed = Array.isArray(snapshot['attributes'])
    ? snapshot['attributes'].filter(isRecord).filter((row) => typeof row['key'] === 'string')
    : null;
  return {
    name: snapshot['name'],
    gene: textOrNull(snapshot['gene']),
    notes: textOrNull(snapshot['notes']),
    dob: textOrNull(snapshot['dob']),
    phenotypes: Array.isArray(snapshot['phenotypes'])
      ? snapshot['phenotypes'].filter((entry): entry is string => typeof entry === 'string')
      : [],
    attributes:
      keyed !== null
        ? keyed.map((row) => ({ key: String(row['key']), value: textOrNull(row['value']) }))
        : source === null
          ? []
          : [{ key: 'Source', value: source }],
  };
}
