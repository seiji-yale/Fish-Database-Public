/**
 * Adding, editing and removing cryopreservation records after a line exists (T-015, FR-CRYO-01…03,
 * BR-6, BR-7). One check shared by the API (which enforces it) and the dialog (which shows the same
 * messages inline). IDs look like `C0548`; when both ends of a range are given the count is derived
 * from them (`cryoRangeCount`), otherwise the entered count is kept.
 */
import { z } from 'zod';
import { cryoRangeCount } from './cryo';
import { isIsoDate } from './dates';
import { newLineMessages, optionalText } from './newLine';

export const CRYO_ID_PATTERN = /^C\d{4}$/;

export const cryoEditMessages = {
  expectedVersionInvalid: 'Reload the page and try again.',
  idFormat: 'Enter the ID as C followed by four digits, for example C0548.',
  rangeBackwards: 'The last ID must not be smaller than the first ID.',
  countInvalid: newLineMessages.cryoCountInvalid,
  nothingLeft: 'Every vial of this range was already used. Remove the record instead.',
  recordNotFound: 'This cryopreservation record does not exist. Reload the page and try again.',
} as const;

/** `C0637`: the ID format used across the lab. */
export function formatCryoId(number: number): string {
  return `C${String(number).padStart(4, '0')}`;
}

/**
 * FR-CRYO-03: the next free ID is the largest numeric part of any existing start/end ID, plus one
 * (the Excel `NEW CryoID` formula). IDs that do not look like `C<digits>` are ignored.
 */
export function nextCryoId(existing: readonly (string | null)[]): string {
  let highest = 0;
  for (const id of existing) {
    const match = id === null ? null : /^C(\d+)$/.exec(id.trim().toUpperCase());
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return formatCryoId(highest + 1);
}

const expectedVersion = z
  .unknown()
  .refine(
    (value) => Number.isInteger(value) && Number(value) >= 1,
    cryoEditMessages.expectedVersionInvalid,
  )
  .transform((value) => value as number);

/** An ID: trimmed, upper-cased; blank means none. */
const idField = z
  .string()
  .trim()
  .nullish()
  .transform((value) =>
    value === undefined || value === null || value === '' ? null : value.toUpperCase(),
  );

const countField = z
  .unknown()
  .transform((value) => (value === '' || value === undefined ? null : value))
  .refine(
    (value) =>
      value === null ||
      (typeof value === 'string' ? /^\d+$/.test(value.trim()) : Number.isInteger(value)),
    cryoEditMessages.countInvalid,
  )
  .refine((value) => value === null || Number(value) >= 0, cryoEditMessages.countInvalid)
  .transform((value) => (value === null ? null : Number(value)))
  .optional();

export function cryoRecordSchema(today: string) {
  return z
    .object({
      expectedVersion,
      note: optionalText(500),
      cryoDate: optionalText(10),
      place: optionalText(120),
      boxName: optionalText(120),
      cryoIdStart: idField,
      cryoIdEnd: idField,
      count: countField,
      detailsUnknown: z.boolean().default(false),
      notes: optionalText(2000),
    })
    .superRefine((value, context) => {
      const { cryoDate, cryoIdStart, cryoIdEnd } = value;
      if (cryoDate !== null && !isIsoDate(cryoDate))
        context.addIssue({
          code: 'custom',
          path: ['cryoDate'],
          message: newLineMessages.cryoDateInvalid,
        });
      else if (cryoDate !== null && cryoDate > today)
        context.addIssue({
          code: 'custom',
          path: ['cryoDate'],
          message: newLineMessages.cryoDateFuture,
        });
      for (const [key, id] of [
        ['cryoIdStart', cryoIdStart],
        ['cryoIdEnd', cryoIdEnd],
      ] as const)
        if (id !== null && !CRYO_ID_PATTERN.test(id))
          context.addIssue({ code: 'custom', path: [key], message: cryoEditMessages.idFormat });
      if ((cryoIdStart === null) !== (cryoIdEnd === null))
        context.addIssue({
          code: 'custom',
          path: [cryoIdStart === null ? 'cryoIdStart' : 'cryoIdEnd'],
          message: newLineMessages.cryoRangeInvalid,
        });
      else if (
        cryoIdStart !== null &&
        cryoIdEnd !== null &&
        CRYO_ID_PATTERN.test(cryoIdStart) &&
        CRYO_ID_PATTERN.test(cryoIdEnd) &&
        cryoRangeCount(cryoIdStart, cryoIdEnd) === null
      )
        context.addIssue({
          code: 'custom',
          path: ['cryoIdEnd'],
          message: cryoEditMessages.rangeBackwards,
        });
      if (
        !value.detailsUnknown &&
        [
          cryoDate,
          value.place,
          value.boxName,
          cryoIdStart,
          cryoIdEnd,
          value.count,
          value.notes,
        ].every((entry) => entry === null || entry === undefined)
      )
        context.addIssue({ code: 'custom', path: [], message: newLineMessages.cryoEmpty });
    });
}

export interface CryoRecordInput {
  expectedVersion: number;
  note: string | null;
  cryoDate: string | null;
  place: string | null;
  boxName: string | null;
  cryoIdStart: string | null;
  cryoIdEnd: string | null;
  /** Derived from the range when both IDs are given, else the entered count. */
  count: number | null;
  detailsUnknown: boolean;
  notes: string | null;
}

export type CryoRecordValidation =
  { ok: true; value: CryoRecordInput } | { ok: false; errors: Record<string, string> };

export function validateCryoRecord(input: unknown, today: string): CryoRecordValidation {
  const parsed = cryoRecordSchema(today).safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[issue.path.map(String).join('.') || 'form'] ??= issue.message;
    return { ok: false, errors };
  }
  const { count, ...rest } = parsed.data;
  return {
    ok: true,
    value: { ...rest, count: cryoRangeCount(rest.cryoIdStart, rest.cryoIdEnd) ?? count ?? null },
  };
}

export type VersionOnlyValidation =
  | { ok: true; expectedVersion: number; note: string | null }
  | { ok: false; errors: Record<string, string> };

/** Body of a removal: the version the page was loaded with and an optional note. */
export function validateCryoRemoval(input: unknown): VersionOnlyValidation {
  const parsed = z.object({ expectedVersion, note: optionalText(500) }).safeParse(input);
  if (parsed.success)
    return { ok: true, expectedVersion: parsed.data.expectedVersion, note: parsed.data.note };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues)
    errors[issue.path.map(String).join('.') || 'form'] ??= issue.message;
  return { ok: false, errors };
}

/** History wording for one record: `C0637–C0644 (8) at Demo freezer shelf`; without IDs, the date or "no IDs". */
export function cryoLabelOf(record: {
  cryoIdStart: string | null;
  cryoIdEnd: string | null;
  count: number | null;
  place: string | null;
  cryoDate: string | null;
  detailsUnknown: boolean;
}): string {
  const { cryoIdStart: start, cryoIdEnd: end, count } = record;
  const ids =
    start === null || end === null
      ? null
      : `${start === end ? start : `${start}–${end}`}${count === null ? '' : ` (${String(count)})`}`;
  const what = ids ?? (record.detailsUnknown ? 'details unknown' : (record.cryoDate ?? 'no IDs'));
  return record.place === null ? what : `${what} at ${record.place}`;
}

// ---------------------------------------------------------------------------------------------
// Using vials (owner request 2026-09-30): a used vial is recorded as used and leaves the list; its
// Cryo ID is never handed out again.

export const cryoUseMessages = {
  idsRequired: 'Enter the IDs of the vials that were used, for example C0640 or C0642-C0644.',
  idsFormat: (token: string) =>
    `"${token}" is not a vial ID or a range. Use IDs like C0640 or ranges like C0642-C0644.`,
  idsBackwards: (token: string) => `The range "${token}" runs backwards.`,
  idsTooMany: 'Enter at most 200 vials at a time.',
  idsDuplicate: (id: string) => `${id} is listed more than once.`,
  idNotOnLine: (id: string) => `${id} is not a vial of this line.`,
  idAlreadyUsed: (id: string) => `${id} was already used and cannot be used again.`,
  quantityInvalid: 'Enter how many vials were used (a whole number, 1 or more).',
  quantityTooMany: (remaining: number) =>
    `Only ${String(remaining)} vials are left in this record.`,
  recordRequired: 'Choose the record the vials were taken from.',
  recordHasIds: 'This record has vial IDs: enter the IDs that were used.',
  chooseOne: 'Enter vial IDs, or choose a record without IDs and a number of vials.',
  dateFuture: 'The date of use cannot be in the future.',
  reusedId: (id: string) => `${id} was already used and cannot be registered again.`,
  usedIdOutside: (ids: string) =>
    `The range must still include the vials already used from this record (${ids}).`,
  useNotFound: 'This vial use does not exist on this line. Reload the page and try again.',
  alreadyUndone: 'This use was already undone. Reload the page.',
  recordRemoved:
    'The record these vials came from was removed on purpose. Restore the record first (Settings → Deleted items), then undo the use.',
  idsInUse:
    'The vial IDs of this record now belong to another record, so the vials cannot go back.',
} as const;

const USE_ID_LIMIT = 200;

/**
 * Reads "C0640, C0642-C0644" into a list of IDs (ranges expanded). Separators: commas, semicolons,
 * spaces or line breaks; a range may use a hyphen or an en dash.
 */
export function parseVialIds(
  text: string,
): { ok: true; ids: string[] } | { ok: false; message: string } {
  const tokens = text
    .split(/[\s,;]+/)
    .map((token) => token.trim().toUpperCase())
    .filter((token) => token !== '');
  if (tokens.length === 0) return { ok: false, message: cryoUseMessages.idsRequired };
  const ids: string[] = [];
  for (const token of tokens) {
    const range = /^(C\d{4})\s*[-–]\s*(C\d{4})$/.exec(token);
    if (range !== null) {
      const first = Number((range[1] as string).slice(1));
      const last = Number((range[2] as string).slice(1));
      if (last < first) return { ok: false, message: cryoUseMessages.idsBackwards(token) };
      for (let number = first; number <= last; number += 1) ids.push(formatCryoId(number));
    } else if (CRYO_ID_PATTERN.test(token)) ids.push(token);
    else return { ok: false, message: cryoUseMessages.idsFormat(token) };
    if (ids.length > USE_ID_LIMIT) return { ok: false, message: cryoUseMessages.idsTooMany };
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return { ok: false, message: cryoUseMessages.idsDuplicate(id) };
    seen.add(id);
  }
  return { ok: true, ids };
}

/** True when `id` lies in the range `start`..`end` (both `C####`). */
export function rangeContains(start: string | null, end: string | null, id: string): boolean {
  if (start === null || end === null) return false;
  const number = (value: string) => Number(value.slice(1));
  return number(id) >= number(start) && number(id) <= number(end);
}

/** `C0640, C0642–C0643`: consecutive IDs folded into ranges, for History wording. */
export function compressCryoIds(ids: readonly string[]): string {
  const numbers = ids.map((id) => Number(id.slice(1))).sort((a, b) => a - b);
  const parts: string[] = [];
  let index = 0;
  while (index < numbers.length) {
    let last = index;
    while (
      last + 1 < numbers.length &&
      (numbers[last + 1] as number) === (numbers[last] as number) + 1
    )
      last += 1;
    const from = formatCryoId(numbers[index] as number);
    parts.push(last === index ? from : `${from}–${formatCryoId(numbers[last] as number)}`);
    index = last + 1;
  }
  return parts.join(', ');
}

/**
 * A real example for the hint under "Used vial IDs", taken from the vials that can still be used
 * (`C0637-C0639`: up to three consecutive IDs, written the way the form reads them). Null when no two
 * available IDs are consecutive.
 */
export function exampleVialRange(available: readonly string[]): string | null {
  const numbers = [...new Set(available.map((id) => Number(id.slice(1))))].sort((a, b) => a - b);
  for (let index = 0; index + 1 < numbers.length; index += 1) {
    if ((numbers[index + 1] as number) !== (numbers[index] as number) + 1) continue;
    let last = index + 1;
    while (last - index < 2 && (numbers[last + 1] as number) === (numbers[last] as number) + 1)
      last += 1;
    return `${formatCryoId(numbers[index] as number)}-${formatCryoId(numbers[last] as number)}`;
  }
  return null;
}

export interface CryoUseInput {
  expectedVersion: number;
  note: string | null;
  usedAt: string;
  /** Vial IDs to take out (ranges expanded); empty when a count-only record is used. */
  ids: string[];
  /** Count-only record and how many vials to take from it. */
  recordId: string | null;
  quantity: number | null;
}

export type CryoUseValidation =
  { ok: true; value: CryoUseInput } | { ok: false; errors: Record<string, string> };

/** Body of `POST /lines/:id/cryo/use`: vial IDs, or a record without IDs plus a quantity. */
export function validateCryoUse(input: unknown, today: string): CryoUseValidation {
  const parsed = z
    .object({
      expectedVersion,
      note: optionalText(500),
      usedAt: z.string().trim().optional(),
      vialIds: z.string().optional(),
      recordId: optionalText(80),
      quantity: countField,
    })
    .safeParse(input);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      errors[issue.path.map(String).join('.') || 'form'] ??= issue.message;
    return { ok: false, errors };
  }
  const { vialIds, recordId, quantity } = parsed.data;
  const usedAt =
    parsed.data.usedAt === undefined || parsed.data.usedAt === '' ? today : parsed.data.usedAt;
  if (!isIsoDate(usedAt)) errors['usedAt'] = newLineMessages.cryoDateInvalid;
  else if (usedAt > today) errors['usedAt'] = cryoUseMessages.dateFuture;
  let ids: string[] = [];
  let amount: number | null = null;
  const hasIds = vialIds !== undefined && vialIds.trim() !== '';
  if (hasIds) {
    const read = parseVialIds(vialIds);
    if (read.ok) ids = read.ids;
    else errors['vialIds'] = read.message;
  } else if (recordId === null) errors['vialIds'] = cryoUseMessages.chooseOne;
  else if (quantity === undefined || quantity === null || quantity < 1)
    errors['quantity'] = cryoUseMessages.quantityInvalid;
  else amount = quantity;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      expectedVersion: parsed.data.expectedVersion,
      note: parsed.data.note,
      usedAt,
      ids,
      recordId: hasIds ? null : recordId,
      quantity: amount,
    },
  };
}
