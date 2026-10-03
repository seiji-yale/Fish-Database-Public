/**
 * The New Line payload (T-011, FR-NEW-01…04, BR-8, BR-9): one Zod schema shared by the API (which
 * enforces it) and the form (which shows the same messages inline before anything is sent).
 *
 * `validateNewLine` never changes what the person typed except to trim text, drop empty rows and
 * fill the documented defaults (annealing 60 °C, cycles 35, status Current, IDed number 0).
 * Errors are keyed by field path (`name`, `dob`, `protocols.0.fields.primer_f_name`, ...), which is
 * what the form needs to put each message next to its input.
 */
import { z } from 'zod';
import { isIsoDate } from './dates';
import {
  defaultProtocolFields,
  validateProtocolFields,
  type ProtocolDefaults,
} from './protocolTemplates';

export const NEW_LINE_PROTOCOL_TYPES = [
  'none',
  'tails',
  'pcr',
  'pcr_sequence',
  'fluorescence',
  'custom',
] as const;
export type NewLineProtocolType = (typeof NEW_LINE_PROTOCOL_TYPES)[number];

/** The label a protocol gets when the person does not type one (matches the imported lines). */
export const PROTOCOL_TYPE_LABELS: Record<NewLineProtocolType, string> = {
  none: 'None',
  tails: 'Tails',
  pcr: 'PCR',
  pcr_sequence: 'PCR + Sequence',
  fluorescence: 'Fluorescence',
  custom: 'Custom',
};

export const NAME_MAX_LENGTH = 60;

export const newLineMessages = {
  nameRequired: 'Enter the line name.',
  nameTooLong: `The line name can have at most ${String(NAME_MAX_LENGTH)} characters.`,
  nameTaken: (existing: string) =>
    `A line named "${existing}" already exists (names are not case-sensitive). Use a different name.`,
  dobRequired: 'Enter the date of birth (YYYY-MM-DD).',
  dobInvalid: 'Enter the date of birth as YYYY-MM-DD.',
  dobFuture: 'The date of birth cannot be in the future.',
  statusInvalid: 'Choose Current or Breeding.',
  idedNumberInvalid: 'Enter a whole number that is 0 or more.',
  textTooLong: (max: number) => `Use at most ${String(max)} characters.`,
  attributeKeyRequired: 'Enter a name for this attribute, or remove the row.',
  attributeKeyDuplicate: 'Each attribute name can be used only once.',
  referenceTitleRequired: 'Enter a title for this reference, or remove the row.',
  referenceUrlInvalid: 'Enter a link that starts with http:// or https://.',
  cryoDateInvalid: 'Enter the cryopreservation date as YYYY-MM-DD.',
  cryoDateFuture: 'The cryopreservation date cannot be in the future.',
  cryoCountInvalid: 'Enter a whole number that is 0 or more.',
  cryoRangeInvalid: 'Enter both the first and last ID, for example C0548 and C0551.',
  cryoEmpty: 'Enter at least one detail, tick "Details unknown", or choose "Not cryopreserved".',
  protocolTypeInvalid: 'Choose an ID method.',
  customItemName: 'Enter a name for this field, or remove the row.',
} as const;

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, newLineMessages.textTooLong(max))
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));

const protocolSchema = z.object({
  type: z.enum(NEW_LINE_PROTOCOL_TYPES, { error: newLineMessages.protocolTypeInvalid }),
  label: optionalText(80),
  fields: z.record(z.string(), z.unknown()).default({}),
  notes: optionalText(2000),
});

const cryoSchema = z.object({
  cryoDate: optionalText(10),
  place: optionalText(120),
  boxName: optionalText(120),
  cryoIdStart: optionalText(20),
  cryoIdEnd: optionalText(20),
  count: z
    .unknown()
    .refine(
      (value) =>
        value === null || value === undefined || (Number.isInteger(value) && Number(value) >= 0),
      newLineMessages.cryoCountInvalid,
    )
    .transform((value) => value as number | null | undefined)
    .optional(),
  detailsUnknown: z.boolean().default(false),
  notes: optionalText(2000),
});

const referenceSchema = z.object({
  title: z.string().trim().max(200, newLineMessages.textTooLong(200)).default(''),
  url: optionalText(2000),
});

/** Field schemas shared with the edit form (`domain/lineEdit.ts`): one rule, one message. */
export const nameField = z
  .string({ error: newLineMessages.nameRequired })
  .trim()
  .min(1, newLineMessages.nameRequired)
  .max(NAME_MAX_LENGTH, newLineMessages.nameTooLong);

export const phenotypesField = z
  .array(z.string().trim().max(200, newLineMessages.textTooLong(200)))
  .max(50);

export const attributesField = z
  .array(
    z.object({
      key: z.string().trim().max(60, newLineMessages.textTooLong(60)).default(''),
      value: optionalText(500),
    }),
  )
  .max(30);

export const dobField = (today: string) =>
  z
    .string({ error: newLineMessages.dobRequired })
    .trim()
    .min(1, newLineMessages.dobRequired)
    .refine(isIsoDate, newLineMessages.dobInvalid)
    .refine((value) => !isIsoDate(value) || value <= today, newLineMessages.dobFuture);

/** An attribute needs a name, and a name can be used once (any case): issues go under `path`. */
export function addAttributeIssues(
  attributes: readonly { key: string }[],
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  const seen = new Set<string>();
  attributes.forEach((attribute, index) => {
    if (attribute.key === '') {
      context.addIssue({
        code: 'custom',
        path: [...path, index, 'key'],
        message: newLineMessages.attributeKeyRequired,
      });
      return;
    }
    const folded = attribute.key.toLowerCase();
    if (seen.has(folded))
      context.addIssue({
        code: 'custom',
        path: [...path, index, 'key'],
        message: newLineMessages.attributeKeyDuplicate,
      });
    seen.add(folded);
  });
}

/** Trimmed, no empty entries, no case-insensitive duplicates, order kept. */
export function cleanPhenotypes(phenotypes: readonly string[]): string[] {
  const seen = new Set<string>();
  return phenotypes.filter((phenotype) => {
    const folded = phenotype.toLowerCase();
    if (phenotype === '' || seen.has(folded)) return false;
    seen.add(folded);
    return true;
  });
}

/** `today` is the lab's calendar date (America/New_York, `YYYY-MM-DD`): the API and the form both pass it in. */
export function newLineSchema(today: string) {
  return z
    .object({
      name: nameField,
      gene: optionalText(200),
      phenotypes: phenotypesField.default([]),
      notes: optionalText(5000),
      attributes: attributesField.default([]),
      dob: dobField(today),
      status: z
        .enum(['Current', 'Breeding'], { error: newLineMessages.statusInvalid })
        .default('Current'),
      // `unknown().refine`, not `number()`: a wrong type must not stop the other fields being checked.
      idedNumber: z
        .unknown()
        .refine(
          (value) => value === undefined || (Number.isInteger(value) && Number(value) >= 0),
          newLineMessages.idedNumberInvalid,
        )
        .transform((value) => value as number | undefined)
        .optional(),
      protocols: z.array(protocolSchema).max(10).default([]),
      cryo: cryoSchema.nullish().transform((value) => value ?? null),
      references: z.array(referenceSchema).max(30).default([]),
    })
    .superRefine((value, context) => {
      addAttributeIssues(value.attributes, context, ['attributes']);
      value.references.forEach((reference, index) => {
        if (reference.title === '')
          context.addIssue({
            code: 'custom',
            path: ['references', index, 'title'],
            message: newLineMessages.referenceTitleRequired,
          });
        if (reference.url !== null && !/^https?:\/\/\S+$/i.test(reference.url))
          context.addIssue({
            code: 'custom',
            path: ['references', index, 'url'],
            message: newLineMessages.referenceUrlInvalid,
          });
      });
      if (value.cryo !== null) {
        const { cryoDate, cryoIdStart, cryoIdEnd } = value.cryo;
        const { place, boxName, count, detailsUnknown, notes } = value.cryo;
        if (
          !detailsUnknown &&
          [cryoDate, place, boxName, cryoIdStart, cryoIdEnd, count, notes].every(
            (entry) => entry === null || entry === undefined,
          )
        )
          context.addIssue({ code: 'custom', path: ['cryo'], message: newLineMessages.cryoEmpty });
        if (cryoDate !== null && !isIsoDate(cryoDate))
          context.addIssue({
            code: 'custom',
            path: ['cryo', 'cryoDate'],
            message: newLineMessages.cryoDateInvalid,
          });
        else if (cryoDate !== null && cryoDate > today)
          context.addIssue({
            code: 'custom',
            path: ['cryo', 'cryoDate'],
            message: newLineMessages.cryoDateFuture,
          });
        if ((cryoIdStart === null) !== (cryoIdEnd === null))
          context.addIssue({
            code: 'custom',
            path: ['cryo', cryoIdStart === null ? 'cryoIdStart' : 'cryoIdEnd'],
            message: newLineMessages.cryoRangeInvalid,
          });
      }
    });
}

export type NewLineValue = z.output<ReturnType<typeof newLineSchema>>;

export interface NewLineProtocol {
  type: NewLineProtocolType;
  label: string;
  fields: Record<string, unknown>;
  notes: string | null;
}

/** The validated payload with defaults applied and empty rows dropped: what gets stored. */
export interface NewLineInput extends Omit<
  NewLineValue,
  'protocols' | 'phenotypes' | 'idedNumber' | 'cryo'
> {
  idedNumber: number;
  cryo: (Omit<NonNullable<NewLineValue['cryo']>, 'count'> & { count: number | null }) | null;
  phenotypes: string[];
  protocols: NewLineProtocol[];
}

export type NewLineValidation =
  | { ok: true; value: NewLineInput; warnings: Record<string, string> }
  | { ok: false; errors: Record<string, string> };

/** Fields the form treats as empty: blank text, and empty lists (`primer_f_seq: []` is not a value). */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** BR-9: defaults fill only what was left out; an explicit value (even 0) is the person's choice. */
function withProtocolDefaults(
  type: NewLineProtocolType,
  fields: Record<string, unknown>,
  overrides: ProtocolDefaults,
): Record<string, unknown> {
  const defaults = defaultProtocolFields(type, undefined, overrides);
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(fields)) {
    if (isBlank(value) && key in defaults) continue;
    merged[key] = value;
  }
  return merged;
}

/** Cleans one protocol's fields and reports field problems under `protocols.<index>.fields.<name>`. */
function cleanProtocol(
  protocol: z.output<typeof protocolSchema>,
  index: number,
  errors: Record<string, string>,
  warnings: Record<string, string>,
  overrides: ProtocolDefaults,
): NewLineProtocol {
  const fields = withProtocolDefaults(protocol.type, protocol.fields, overrides);
  if (protocol.type === 'custom' && Array.isArray(fields.items)) {
    // Custom items are `{ key, value }` text rows: trim them, drop fully empty rows, require a name.
    const text = (entry: unknown) => (typeof entry === 'string' ? entry.trim() : '');
    const rows = (fields.items as unknown[]).map((item) => {
      const row = (typeof item === 'object' && item !== null ? item : {}) as Record<
        string,
        unknown
      >;
      return { key: text(row.key), value: text(row.value) };
    });
    fields.items = rows.filter((row) => row.key !== '' || row.value !== '');
    (fields.items as { key: string }[]).forEach((row, itemIndex) => {
      if (row.key === '')
        errors[`protocols.${String(index)}.fields.items.${String(itemIndex)}.key`] =
          newLineMessages.customItemName;
    });
  }
  // Blank optional fields are stored as absent, not as empty strings.
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, value]) => !isBlank(value)));
  const result = validateProtocolFields(protocol.type, cleaned);
  for (const issue of result.errors)
    errors[`protocols.${String(index)}.fields.${issue.field}`] ??= issue.message;
  for (const issue of result.warnings)
    warnings[`protocols.${String(index)}.fields.${issue.field}`] ??= issue.message;
  return {
    type: protocol.type,
    label: protocol.label ?? PROTOCOL_TYPE_LABELS[protocol.type],
    fields: cleaned,
    notes: protocol.notes,
  };
}

/**
 * Checks everything in one pass, so the form can show all problems at once instead of revealing
 * a second batch after the first is fixed: the top-level schema, and each protocol's own fields
 * (checked even when another field is wrong).
 */
export function validateNewLine(
  input: unknown,
  today: string,
  defaults: ProtocolDefaults = {},
): NewLineValidation {
  const parsed = newLineSchema(today).safeParse(input);
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.');
      // The first message for a field is the most useful one; later ones would only repeat it.
      errors[path === '' ? 'form' : path] ??= issue.message;
    }
  }

  const rawProtocols =
    typeof input === 'object' &&
    input !== null &&
    Array.isArray((input as { protocols?: unknown }).protocols)
      ? (input as { protocols: unknown[] }).protocols
      : [];
  const protocols: NewLineProtocol[] = [];
  rawProtocols.forEach((raw, index) => {
    const protocol = protocolSchema.safeParse(raw);
    if (protocol.success)
      protocols.push(cleanProtocol(protocol.data, index, errors, warnings, defaults));
  });
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };

  const value = parsed.data;
  const phenotypes = cleanPhenotypes(value.phenotypes);
  return {
    ok: true,
    value: {
      ...value,
      idedNumber: value.idedNumber ?? 0,
      cryo: value.cryo === null ? null : { ...value.cryo, count: value.cryo.count ?? null },
      phenotypes,
      protocols,
    },
    warnings,
  };
}

export interface ProtocolValidation {
  ok: boolean;
  /** The cleaned protocol; present when `ok`. */
  value: NewLineProtocol | null;
  /** Keyed `type`, `label`, `notes`, `fields.<name>`, `fields.items.<n>.key`. */
  errors: Record<string, string>;
  warnings: Record<string, string>;
}

/**
 * One ID protocol on its own (T-014): the same checks and cleaning `validateNewLine` applies to each
 * protocol of a new line, for adding or editing a protocol later. Blank optional fields are dropped,
 * BR-9 defaults fill what was left out, and invalid sequence characters are a warning (FR-ID-08).
 */
export function validateProtocol(
  input: unknown,
  defaults: ProtocolDefaults = {},
): ProtocolValidation {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};
  const parsed = protocolSchema.safeParse(input);
  let value: NewLineProtocol | null = null;
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      errors[issue.path.map(String).join('.') || 'form'] ??= issue.message;
  } else value = cleanProtocol(parsed.data, 0, errors, warnings, defaults);
  const strip = (all: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(all).map(([key, text]) => [key.replace(/^protocols\.0\./, ''), text]),
    );
  const clean = strip(errors);
  return {
    ok: Object.keys(clean).length === 0,
    value: Object.keys(clean).length === 0 ? value : null,
    errors: clean,
    warnings: strip(warnings),
  };
}
