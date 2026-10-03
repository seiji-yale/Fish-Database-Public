/**
 * Adding, editing, removing, reordering and switching ID protocols after a line exists (T-014,
 * FR-ID-01…09). One Zod schema per request shape, shared by the API (which enforces it) and the
 * dialogs (which show the same messages inline). The protocol's own fields are checked by
 * `validateProtocol` (`domain/newLine.ts`), the same code the New Line form uses.
 */
import { z } from 'zod';
import { optionalText, validateProtocol, type NewLineProtocol } from './newLine';
import type { ProtocolDefaults } from './protocolTemplates';

export const protocolEditMessages = {
  expectedVersionInvalid: 'Reload the page and try again.',
  orderInvalid:
    'The order must list every ID method of this line exactly once. Reload and try again.',
  labelDuplicate: (label: string) =>
    `Another ID method of this line is already called "${label}". Give this one a different label so they can be told apart.`,
} as const;

const expectedVersion = z
  .unknown()
  .refine(
    (value) => Number.isInteger(value) && Number(value) >= 1,
    protocolEditMessages.expectedVersionInvalid,
  )
  .transform((value) => value as number);

const envelope = z.object({
  expectedVersion,
  note: optionalText(500),
  setCurrent: z.boolean().optional(),
});

export interface ProtocolRequest {
  expectedVersion: number;
  note: string | null;
  setCurrent: boolean;
  protocol: NewLineProtocol;
  /** Problems that do not block saving (invalid sequence characters, a repeated label). */
  warnings: Record<string, string>;
}

export type ProtocolRequestValidation =
  { ok: true; value: ProtocolRequest } | { ok: false; errors: Record<string, string> };

/** A repeated label is a warning, not an error (FR-ID-02): two PCRs may legitimately be named alike. */
export function duplicateLabelWarning(
  label: string,
  otherLabels: readonly string[],
): string | null {
  const folded = label.trim().toLowerCase();
  return otherLabels.some((other) => other.trim().toLowerCase() === folded)
    ? protocolEditMessages.labelDuplicate(label)
    : null;
}

/**
 * The body of `POST /lines/:id/protocols` and `PATCH .../:pid`. `type` is the protocol's own type
 * when editing (a protocol keeps its type), and `otherLabels` are the labels of the line's other
 * live protocols.
 */
export function validateProtocolRequest(
  input: unknown,
  otherLabels: readonly string[],
  type?: string,
  defaults: ProtocolDefaults = {},
): ProtocolRequestValidation {
  const body: unknown =
    type !== undefined && input !== null && typeof input === 'object'
      ? { ...(input as Record<string, unknown>), type }
      : input;
  const errors: Record<string, string> = {};
  const head = envelope.safeParse(body);
  if (!head.success)
    for (const issue of head.error.issues)
      errors[issue.path.map(String).join('.') || 'form'] ??= issue.message;
  const checked = validateProtocol(body, defaults);
  Object.assign(
    errors,
    Object.fromEntries(Object.entries(checked.errors).filter(([key]) => !(key in errors))),
  );
  if (!head.success || checked.value === null) return { ok: false, errors };
  const warnings = { ...checked.warnings };
  const duplicate = duplicateLabelWarning(checked.value.label, otherLabels);
  if (duplicate !== null) warnings['label'] = duplicate;
  return {
    ok: true,
    value: {
      expectedVersion: head.data.expectedVersion,
      note: head.data.note,
      setCurrent: head.data.setCurrent ?? false,
      protocol: checked.value,
      warnings,
    },
  };
}

export type ExpectedVersionValidation =
  | { ok: true; expectedVersion: number; note: string | null }
  | { ok: false; errors: Record<string, string> };

/** Body with only the version and an optional note (remove, set current, restore). */
export function validateVersionOnly(input: unknown): ExpectedVersionValidation {
  const parsed = z.object({ expectedVersion, note: optionalText(500) }).safeParse(input);
  if (parsed.success)
    return { ok: true, expectedVersion: parsed.data.expectedVersion, note: parsed.data.note };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues)
    errors[issue.path.map(String).join('.') || 'form'] ??= issue.message;
  return { ok: false, errors };
}

/** `POST /lines/:id/protocols/reorder`: the new order must be exactly the live protocols. */
export function validateReorder(
  input: unknown,
  liveIds: readonly string[],
):
  | { ok: true; expectedVersion: number; order: string[] }
  | { ok: false; errors: Record<string, string> } {
  const parsed = z.object({ expectedVersion, order: z.array(z.string()) }).safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: protocolEditMessages.orderInvalid } };
  const { order } = parsed.data;
  const sameSet =
    order.length === liveIds.length &&
    new Set(order).size === order.length &&
    order.every((id) => liveIds.includes(id));
  if (!sameSet) return { ok: false, errors: { order: protocolEditMessages.orderInvalid } };
  return { ok: true, expectedVersion: parsed.data.expectedVersion, order };
}

/** Body of `.../:pid/set-current`: mark (default) or unmark the protocol as one of the current methods. */
export function validateSetCurrent(
  input: unknown,
):
  | { ok: true; expectedVersion: number; note: string | null; current: boolean }
  | { ok: false; errors: Record<string, string> } {
  const parsed = z
    .object({ expectedVersion, note: optionalText(500), current: z.boolean().optional() })
    .safeParse(input);
  if (parsed.success)
    return {
      ok: true,
      expectedVersion: parsed.data.expectedVersion,
      note: parsed.data.note,
      current: parsed.data.current ?? true,
    };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues)
    errors[issue.path.map(String).join('.') || 'form'] ??= issue.message;
  return { ok: false, errors };
}
