import { describe, expect, it } from 'vitest';
import {
  defaultProtocolFields,
  protocolTemplates,
  validateProtocolFields,
} from './protocolTemplates';

describe('protocol templates', () => {
  it('provides the BR-9 PCR defaults', () => {
    expect(defaultProtocolFields('pcr')).toEqual({ annealing_c: 60, cycles: 35 });
    expect(defaultProtocolFields('none')).toEqual({});
    expect(() => defaultProtocolFields('not-real')).toThrow('Unknown protocol type');
  });
  it('accepts valid fields and warns, rather than errors, on unexpected sequence characters', () => {
    expect(
      validateProtocolFields('pcr', { primer_f_name: 'F', annealing_c: 60, cycles: 35 }).errors,
    ).toEqual([]);
    expect(validateProtocolFields('pcr', { primer_f_seq: 'AX' })).toEqual({
      errors: [],
      warnings: [
        {
          field: 'primer_f_seq',
          message: 'Sequence contains characters outside the accepted nucleotide codes.',
        },
      ],
    });
    expect(validateProtocolFields('pcr', { primer_f_seq: 'ACGT NRY' })).toEqual({
      errors: [],
      warnings: [],
    });
  });
  it.each([
    ['pcr', { annealing_c: '60' }],
    ['pcr', { primer_f_name: 7 }],
    ['pcr', { primer_f_seq: 7 }],
    ['pcr_sequence', { seq_result_urls: ['ok', 2] }],
    ['pcr_sequence', { seq_result_urls: 'not-a-list' }],
    ['custom', { items: [{ key: 'a' }] }],
    ['custom', { items: 'not-a-list' }],
    ['fluorescence', { screening_day: '2-9' }],
    ['pcr', { fluorophore: 'GFP' }],
  ] as const)('rejects invalid fields for %s', (type, fields) => {
    expect(validateProtocolFields(type, fields).errors.length).toBeGreaterThan(0);
  });
  it('accepts fluorescence screening days from 0 to 7, including an ascending range', () => {
    expect(validateProtocolFields('fluorescence', { screening_day: '0-7' }).errors).toEqual([]);
    expect(validateProtocolFields('fluorescence', { screening_day: '2' }).errors).toEqual([]);
    expect(
      validateProtocolFields('fluorescence', { screening_day: 'not-a-day' }).errors,
    ).not.toEqual([]);
    expect(validateProtocolFields('fluorescence', { screening_day: '6-2' }).errors).not.toEqual([]);
    expect(validateProtocolFields('fluorescence', { screening_day: 2 }).errors).not.toEqual([]);
    expect(validateProtocolFields('fluorescence', { fluorophore: 'GFP' }).errors).toEqual([]);
  });
  it('accepts absent optional fields and checks every custom-item shape', () => {
    expect(
      validateProtocolFields('pcr', { primer_f_name: null, primer_r_name: undefined }),
    ).toEqual({
      errors: [],
      warnings: [],
    });
    expect(validateProtocolFields('pcr', { annealing_c: Number.NaN }).errors).not.toEqual([]);
    expect(validateProtocolFields('custom', { items: [null] }).errors).not.toEqual([]);
    expect(validateProtocolFields('custom', { items: [{ key: 'a', value: 'b' }] })).toEqual({
      errors: [],
      warnings: [],
    });
  });
  it('rejects an unknown type and lets a new template be supplied without changing validation code', () => {
    expect(validateProtocolFields('not-real', {}).errors[0]?.field).toBe('protocol_type');
    const templates = {
      ...protocolTemplates,
      immunostain: { fields: { antibody: { kind: 'text' as const } } },
    };
    expect(
      validateProtocolFields('immunostain', { antibody: 'acetylated tubulin' }, templates),
    ).toEqual({ errors: [], warnings: [] });
  });
});

describe('defaultProtocolFields with Admin-set overrides', () => {
  it('replaces only annealing and cycles, and only where the template has them', () => {
    expect(defaultProtocolFields('pcr', undefined, { annealing_c: 55, cycles: 28 })).toEqual({
      annealing_c: 55,
      cycles: 28,
    });
    expect(defaultProtocolFields('pcr', undefined, { cycles: 28 })).toEqual({
      annealing_c: 60,
      cycles: 28,
    });
    expect(defaultProtocolFields('tails', undefined, { annealing_c: 55 })).toEqual({});
  });
});
