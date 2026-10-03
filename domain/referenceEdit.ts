/**
 * Adding, editing and removing a line's references (T-016, FR-REF-01): a title plus a link or an
 * uploaded file. Shared by the API and the dialog.
 */
import { z } from 'zod';
import { newLineMessages, optionalText } from './newLine';

export const referenceMessages = {
  expectedVersionInvalid: 'Reload the page and try again.',
  linkOrFile: 'Add a link or upload a file.',
  notBoth: 'Use either a link or a file, not both.',
} as const;

const expectedVersion = z
  .unknown()
  .refine(
    (value) => Number.isInteger(value) && Number(value) >= 1,
    referenceMessages.expectedVersionInvalid,
  )
  .transform((value) => value as number);

export interface ReferenceInput {
  expectedVersion: number;
  title: string;
  url: string | null;
  /** A staged upload to link to this reference. */
  attachmentId: string | null;
  /** Keep the file the reference already has (editing without a new upload). */
  keepFile: boolean;
  note: string | null;
}

export type ReferenceValidation =
  { ok: true; value: ReferenceInput } | { ok: false; errors: Record<string, string> };

/** `hasFile`: the reference being edited already has a file (it may keep it). */
export function validateReference(input: unknown, hasFile = false): ReferenceValidation {
  const parsed = z
    .object({
      expectedVersion,
      title: z
        .string({ error: newLineMessages.referenceTitleRequired })
        .trim()
        .min(1, newLineMessages.referenceTitleRequired)
        .max(200, newLineMessages.textTooLong(200)),
      url: optionalText(2000),
      attachmentId: optionalText(80),
      note: optionalText(500),
    })
    .superRefine((value, context) => {
      if (value.url !== null && !/^https?:\/\/\S+$/i.test(value.url))
        context.addIssue({
          code: 'custom',
          path: ['url'],
          message: newLineMessages.referenceUrlInvalid,
        });
      if (value.url !== null && value.attachmentId !== null)
        context.addIssue({ code: 'custom', path: ['url'], message: referenceMessages.notBoth });
      if (value.url === null && value.attachmentId === null && !hasFile)
        context.addIssue({ code: 'custom', path: ['url'], message: referenceMessages.linkOrFile });
    })
    .safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[issue.path.map(String).join('.') || 'form'] ??= issue.message;
    return { ok: false, errors };
  }
  const value = parsed.data;
  return {
    ok: true,
    value: { ...value, keepFile: hasFile && value.url === null && value.attachmentId === null },
  };
}
