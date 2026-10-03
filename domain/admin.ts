/**
 * Admin input rules (T-018, FR-ADM-01…03): users, pick-lists, settings, invites. One check shared by
 * the API (which enforces it) and the Settings page (which shows the same messages inline).
 */
import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from './accounts';

export const adminMessages = {
  nameRequired: 'Enter a name.',
  nameTooLong: 'Use at most 40 characters for a name.',
  nameTaken: (name: string) =>
    `A user named "${name}" already exists (names are not case-sensitive).`,
  roleInvalid: 'Choose Member or Admin.',
  builtinLocked: 'The built-in Guest and Admin entries cannot be renamed, changed or removed.',
  inviteSelf: 'Use Change password in your account menu for your own password.',
  deleteSelf: 'You cannot delete yourself.',
  deleteNeedsRemoved: 'Remove the user first, then delete the entry.',
  userHasHistory:
    'This person appears in History (changes, messages or invites), so the entry has to stay. It stays under "Removed users"; reactivate it to invite them again.',
  inviteInactive: 'Reactivate this user before sending a new invite.',
  lastAdmin: 'At least one active Admin must remain. Make another user Admin first.',
  valueRequired: 'Enter a value.',
  valueTooLong: 'Use at most 80 characters.',
  valueTaken: (value: string) => `"${value}" is already in this list (not case-sensitive).`,
  listReadOnly: 'This list is fixed by the application and cannot be changed here.',
  thresholdInvalid: 'Enter a whole number of months from 1 to 60.',
  databaseNameRequired: 'Enter a database name.',
  databaseNameTooLong: 'Use at most 80 characters for the database name.',
  annealingInvalid: 'Enter a temperature from 30 to 80 °C.',
  cyclesInvalid: 'Enter a whole number of cycles from 1 to 100.',
  passwordTooShort: 'Use at least 8 characters.',
  nothingToChange: 'Nothing to change.',
} as const;

export const ENUMERATION_KINDS = [
  'id_method_type',
  'fluorophore',
  'cryo_place',
  'request_type',
  'attribute_key',
] as const;
export type AdminEnumerationKind = (typeof ENUMERATION_KINDS)[number];

/** `id_method_type` is shown, not edited: the forms offer a fixed set of templates. */
export const EDITABLE_KINDS: readonly AdminEnumerationKind[] = [
  'fluorophore',
  'cryo_place',
  'request_type',
  'attribute_key',
];

export const USER_NAME_MAX = 40;

const userName = z
  .string({ error: adminMessages.nameRequired })
  .trim()
  .min(1, adminMessages.nameRequired)
  .max(USER_NAME_MAX, adminMessages.nameTooLong);

/** People are Members or Admins; Guests come in through the Guest URL (ADR-0005). */
const assignableRole = z.enum(['member', 'admin'], { error: adminMessages.roleInvalid });
const initialPassword = z
  .string({ error: adminMessages.passwordTooShort })
  .min(MIN_PASSWORD_LENGTH, adminMessages.passwordTooShort);

export const addUserSchema = z.object({
  name: userName,
  role: assignableRole.default('member'),
  initialPassword,
});
/** A new invite: Admin chooses a new initial password (ADR-0005). */
export const inviteSchema = z.object({ initialPassword });
export const updateUserSchema = z.object({
  name: userName.optional(),
  role: assignableRole.optional(),
  isActive: z.boolean().optional(),
});

const listValue = z
  .string({ error: adminMessages.valueRequired })
  .trim()
  .min(1, adminMessages.valueRequired)
  .max(80, adminMessages.valueTooLong);

export const addEnumerationSchema = z.object({
  kind: z.enum(ENUMERATION_KINDS),
  value: listValue,
});
export const updateEnumerationSchema = z.object({
  value: listValue.optional(),
  isActive: z.boolean().optional(),
});

/** Whole numbers may arrive as digits typed into a text box. */
const wholeNumber = (min: number, max: number, message: string) =>
  z
    .unknown()
    .transform((value) =>
      typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value,
    )
    .refine(
      (value) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max,
      message,
    )
    .transform((value) => value as number);

export const settingsSchema = z.object({
  databaseName: z
    .string({ error: adminMessages.databaseNameRequired })
    .trim()
    .min(1, adminMessages.databaseNameRequired)
    .max(80, adminMessages.databaseNameTooLong)
    .optional(),
  upcomingBreedingMonths: wholeNumber(1, 60, adminMessages.thresholdInvalid).optional(),
  defaultAnnealingC: z
    .unknown()
    .transform((value) =>
      typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
    )
    .refine(
      (value) => typeof value === 'number' && Number.isFinite(value) && value >= 30 && value <= 80,
      adminMessages.annealingInvalid,
    )
    .transform((value) => value as number)
    .optional(),
  defaultCycles: wholeNumber(1, 100, adminMessages.cyclesInvalid).optional(),
});

/** Read-only mode on or off (T-021). */
export const readOnlySchema = z.object({ enabled: z.boolean() });

export type AdminValidation<T> =
  { ok: true; value: T } | { ok: false; errors: Record<string, string> };

export function validateAdmin<T>(schema: z.ZodType<T>, input: unknown): AdminValidation<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues)
    errors[issue.path.map(String).join('.') || 'form'] ??= issue.message;
  return { ok: false, errors };
}

/** True when `candidate` (any case) is already in `existing`; `except` lets a rename keep its own name. */
export function nameTaken(
  existing: readonly string[],
  candidate: string,
  except?: string,
): boolean {
  const folded = candidate.trim().toLowerCase();
  return existing.some(
    (name) => name.toLowerCase() === folded && name.toLowerCase() !== except?.toLowerCase(),
  );
}
