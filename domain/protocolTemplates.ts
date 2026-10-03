import type { ProtocolValidationResult } from './types';

export type ProtocolFieldKind = 'text' | 'number' | 'sequence' | 'url[]' | 'enum' | 'items';

export interface ProtocolFieldTemplate {
  kind: ProtocolFieldKind;
  defaultValue?: unknown;
}

export interface ProtocolTemplate {
  fields: Record<string, ProtocolFieldTemplate>;
}

const PCR_FIELDS: Record<string, ProtocolFieldTemplate> = {
  primer_f_name: { kind: 'text' },
  primer_f_seq: { kind: 'sequence' },
  primer_r_name: { kind: 'text' },
  primer_r_seq: { kind: 'sequence' },
  annealing_c: { kind: 'number', defaultValue: 60 },
  expected_band: { kind: 'text' },
  cycles: { kind: 'number', defaultValue: 35 },
};

export const protocolTemplates: Record<string, ProtocolTemplate> = {
  none: { fields: {} },
  tails: { fields: {} },
  pcr: { fields: PCR_FIELDS },
  pcr_sequence: {
    fields: {
      ...PCR_FIELDS,
      seq_primer: { kind: 'text' },
      guide_seq: { kind: 'sequence' },
      expected_mutation: { kind: 'text' },
      seq_result_urls: { kind: 'url[]' },
    },
  },
  fluorescence: {
    fields: {
      fluorophore: { kind: 'enum' },
      screening_day: { kind: 'text' },
      description: { kind: 'text' },
    },
  },
  custom: { fields: { items: { kind: 'items' } } },
};

/** The Admin-set defaults (Settings, FR-ADM-03): they replace the built-in 60 °C / 35 cycles. */
export interface ProtocolDefaults {
  annealing_c?: number;
  cycles?: number;
}

export function defaultProtocolFields(
  type: string,
  templates: Record<string, ProtocolTemplate> = protocolTemplates,
  overrides: ProtocolDefaults = {},
): Record<string, unknown> {
  const template = templates[type];
  if (template === undefined) throw new Error(`Unknown protocol type: ${type}.`);
  return Object.fromEntries(
    Object.entries(template.fields)
      .filter(([, field]) => field.defaultValue !== undefined)
      // Only annealing and cycles carry defaults, and those are the two an Admin can override.
      .map(([key, field]) => [key, overrides[key as keyof ProtocolDefaults] ?? field.defaultValue]),
  );
}

function hasInvalidSequenceCharacters(value: string): boolean {
  return /[^ACGTUNRYKMSWBDHV\s]/i.test(value);
}

function validScreeningDay(value: string): boolean {
  const match = /^(\d)(?:-(\d))?$/.exec(value);
  if (match === null) return false;
  const first = Number(match[1]);
  const second = match[2] === undefined ? first : Number(match[2]);
  return first >= 0 && second <= 7 && first <= second;
}

/** Validates fields without changing them; invalid sequence characters are a warning (FR-ID-08). */
export function validateProtocolFields(
  type: string,
  fields: Record<string, unknown>,
  templates: Record<string, ProtocolTemplate> = protocolTemplates,
): ProtocolValidationResult {
  const template = templates[type];
  const errors: ProtocolValidationResult['errors'] = [];
  const warnings: ProtocolValidationResult['warnings'] = [];
  if (template === undefined) {
    errors.push({ field: 'protocol_type', message: `Unknown protocol type: ${type}.` });
    return { errors, warnings };
  }
  for (const [key, value] of Object.entries(fields)) {
    const field = template.fields[key];
    if (field === undefined) {
      errors.push({
        field: key,
        message: 'This field is not available for the selected ID method.',
      });
      continue;
    }
    if (value === null || value === undefined || value === '') continue;
    if (field.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      errors.push({ field: key, message: 'Enter a number.' });
    }
    if (field.kind === 'text' && typeof value !== 'string') {
      errors.push({ field: key, message: 'Enter text.' });
    }
    if (field.kind === 'sequence') {
      if (typeof value !== 'string')
        errors.push({ field: key, message: 'Enter a sequence as text.' });
      else if (hasInvalidSequenceCharacters(value)) {
        warnings.push({
          field: key,
          message: 'Sequence contains characters outside the accepted nucleotide codes.',
        });
      }
    }
    if (
      field.kind === 'url[]' &&
      (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    ) {
      errors.push({ field: key, message: 'Enter a list of links.' });
    }
    if (
      field.kind === 'items' &&
      (!Array.isArray(value) ||
        value.some((entry) => {
          if (entry === null || typeof entry !== 'object') return true;
          const item = entry as Record<string, unknown>;
          return typeof item.key !== 'string' || typeof item.value !== 'string';
        }))
    ) {
      errors.push({ field: key, message: 'Each custom field needs a name and value.' });
    }
    if (
      type === 'fluorescence' &&
      key === 'screening_day' &&
      (typeof value !== 'string' || !validScreeningDay(value))
    ) {
      errors.push({
        field: key,
        message: 'Screening day must be from 0 to 7 dpf, optionally as a range.',
      });
    }
  }
  return { errors, warnings };
}
