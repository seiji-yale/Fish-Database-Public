/**
 * The Change Activity payloads (T-013, FR-ACT-02…07): one Zod schema per dialog, shared by the API
 * (which enforces it) and the dialogs (which show the same messages inline before anything is sent).
 * The state changes themselves (BR-1, BR-2) stay in `domain/breeding.ts`; this file only checks the
 * shape of what the person typed. Errors are keyed by field name, like `validateNewLine`.
 */
import { z } from 'zod';
import { isIsoDate } from './dates';
import { newLineMessages, optionalText } from './newLine';

export const activityMessages = {
  expectedVersionInvalid: 'Reload the page and try again.',
  dateRequired: 'Enter the date as YYYY-MM-DD.',
  crossDateFuture: 'The cross date cannot be in the future.',
  recordDateFuture: 'The genotyping date cannot be in the future.',
  newDobRequired: 'Enter the new DOB (YYYY-MM-DD).',
  countRequired: 'Enter a whole number that is 0 or more.',
  screenedTooSmall: 'The total screened cannot be smaller than the positive number.',
  generationChoice: 'Choose whether this is the current generation or a new one.',
  reasonTooLong: newLineMessages.textTooLong(500),
} as const;

const expectedVersion = z
  .unknown()
  .refine(
    (value) => Number.isInteger(value) && Number(value) >= 1,
    activityMessages.expectedVersionInvalid,
  )
  .transform((value) => value as number);

const isoDate = (today: string, futureMessage: string) =>
  z
    .string({ error: activityMessages.dateRequired })
    .trim()
    .refine(isIsoDate, activityMessages.dateRequired)
    .refine((value) => value <= today, futureMessage);

/** A whole number >= 0 that may arrive as a number or as typed digits. */
const countValue = z
  .unknown()
  .transform((value) =>
    typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value,
  )
  .refine((value) => Number.isInteger(value) && Number(value) >= 0, activityMessages.countRequired)
  .transform((value) => value as number);

const optionalCount = z
  .unknown()
  .transform((value) => (value === '' || value === undefined ? null : value))
  .refine(
    (value) =>
      value === null ||
      (typeof value === 'string' ? /^\d+$/.test(value.trim()) : Number.isInteger(value)),
    activityMessages.countRequired,
  )
  .refine((value) => value === null || Number(value) >= 0, activityMessages.countRequired)
  .transform((value) => (value === null ? null : Number(value)))
  .optional();

export const startBreedingSchema = (today: string) =>
  z.object({
    expectedVersion,
    crossDate: isoDate(today, activityMessages.crossDateFuture),
    note: optionalText(500),
  });

export const genotypingSchema = (today: string) =>
  z
    .object({
      expectedVersion,
      recordDate: isoDate(today, activityMessages.recordDateFuture),
      protocolId: optionalText(80),
      positiveCount: countValue,
      screenedCount: optionalCount,
      isNewGeneration: z.boolean({ error: activityMessages.generationChoice }),
      /** A gel image uploaded (staged) just before saving (T-016). */
      attachmentId: optionalText(80),
      newDob: optionalText(10),
      note: optionalText(500),
    })
    .superRefine((value, context) => {
      if (value.screenedCount != null && value.screenedCount < value.positiveCount)
        context.addIssue({
          code: 'custom',
          path: ['screenedCount'],
          message: activityMessages.screenedTooSmall,
        });
      if (value.isNewGeneration && value.newDob === null)
        context.addIssue({
          code: 'custom',
          path: ['newDob'],
          message: activityMessages.newDobRequired,
        });
    })
    .transform((value) => ({ ...value, screenedCount: value.screenedCount ?? null }));

export const closeSchema = z.object({ expectedVersion, reason: optionalText(500) });

export const reopenSchema = z.object({ expectedVersion, note: optionalText(500) });

export type StartBreedingInput = z.output<ReturnType<typeof startBreedingSchema>>;
export type GenotypingActivityInput = z.output<ReturnType<typeof genotypingSchema>>;
export type CloseInput = z.output<typeof closeSchema>;
export type ReopenInput = z.output<typeof reopenSchema>;

export type ActivityValidation<T> =
  { ok: true; value: T } | { ok: false; errors: Record<string, string> };

function validate<T>(schema: z.ZodType<T>, input: unknown): ActivityValidation<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join('.');
    errors[path === '' ? 'form' : path] ??= issue.message;
  }
  return { ok: false, errors };
}

export const validateStartBreeding = (input: unknown, today: string) =>
  validate(startBreedingSchema(today), input);
export const validateGenotyping = (input: unknown, today: string) =>
  validate(genotypingSchema(today), input);
export const validateClose = (input: unknown) => validate(closeSchema, input);
export const validateReopen = (input: unknown) => validate(reopenSchema, input);
