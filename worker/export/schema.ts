/**
 * The shape of `fish-database.json` (docs/03-data-model.md section 6), as a Zod schema: the export is
 * checked against it in the tests, and a later restore-from-export tool can reuse it to refuse a
 * file that is not one of ours.
 */
import { z } from 'zod';

const row = z.record(z.string(), z.unknown());

export const exportLineSchema = z.object({
  line: row,
  phenotypes: z.array(row),
  attributes: z.array(row),
  protocols: z.array(row),
  genotypingRecords: z.array(row),
  cryoRecords: z.array(row),
  cryoVialUses: z.array(row),
  references: z.array(row),
  attachments: z.array(row),
});

export const exportSchema = z.object({
  exported_at: z.string(),
  app_version: z.string(),
  lines: z.array(exportLineSchema),
  users: z.array(row),
  enumerations: z.array(row),
  // History and talk, so a restore from this one file loses nothing (T-021). Older exports lack
  // them: a missing list reads as empty.
  lineVersions: z.array(row).default([]),
  activities: z.array(row).default([]),
  chatMessages: z.array(row).default([]),
  settings: z.object({
    upcoming_breeding_months: z.string().nullable(),
    default_annealing_c: z.string().nullable(),
    default_cycles: z.string().nullable(),
    // Exports before ADR-0005 (2026-10-02) still carry the retired lab passphrase flag.
    lab_passphrase_enabled: z.boolean().optional(),
  }),
});

export type ExportDocument = z.infer<typeof exportSchema>;
