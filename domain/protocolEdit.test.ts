import { describe, expect, it } from 'vitest';
import {
  duplicateLabelWarning,
  protocolEditMessages,
  validateProtocolRequest,
  validateReorder,
  validateSetCurrent,
  validateVersionOnly,
} from './protocolEdit';

const base = { expectedVersion: 2, type: 'pcr', label: 'PCR – a', fields: {} };

describe('validateProtocolRequest', () => {
  it('cleans the protocol, fills BR-9 defaults and defaults setCurrent to false', () => {
    const result = validateProtocolRequest({ ...base, note: ' why ' }, []);
    expect(result).toMatchObject({
      ok: true,
      value: {
        expectedVersion: 2,
        note: 'why',
        setCurrent: false,
        protocol: { type: 'pcr', label: 'PCR – a', fields: { annealing_c: 60, cycles: 35 } },
        warnings: {},
      },
    });
  });

  it('uses the protocol’s own type when editing', () => {
    const result = validateProtocolRequest({ ...base, type: 'tails', setCurrent: true }, [], 'pcr');
    expect(result).toMatchObject({
      ok: true,
      value: { setCurrent: true, protocol: { type: 'pcr' } },
    });
  });

  it('warns about a repeated label (any case) and about bad sequence characters', () => {
    const result = validateProtocolRequest(
      { ...base, label: 'pcr – A', fields: { primer_f_seq: 'AC!' } },
      ['PCR – a'],
    );
    expect(result.ok && Object.keys(result.value.warnings).sort()).toEqual([
      'fields.primer_f_seq',
      'label',
    ]);
  });

  it('collects the envelope and field problems together', () => {
    const result = validateProtocolRequest(
      { expectedVersion: 0, type: 'pcr', fields: { annealing_c: 'x' }, setCurrent: 'yes' },
      [],
    );
    expect(result.ok).toBe(false);
    expect(Object.keys(result.ok ? {} : result.errors).sort()).toEqual([
      'expectedVersion',
      'fields.annealing_c',
      'setCurrent',
    ]);
  });

  it('reports an unknown type and a body that is not an object', () => {
    expect(validateProtocolRequest({ expectedVersion: 1, type: 'x' }, []).ok).toBe(false);
    const result = validateProtocolRequest(5, []);
    expect(result.ok).toBe(false);
  });
});

describe('duplicateLabelWarning', () => {
  it('is null for a new label and names the label otherwise', () => {
    expect(duplicateLabelWarning('A', ['B'])).toBeNull();
    expect(duplicateLabelWarning(' a ', ['A'])).toBe(protocolEditMessages.labelDuplicate(' a '));
  });
});

describe('validateVersionOnly', () => {
  it('accepts a version and an optional note', () => {
    expect(validateVersionOnly({ expectedVersion: 3 })).toEqual({
      ok: true,
      expectedVersion: 3,
      note: null,
    });
    expect(validateVersionOnly({ expectedVersion: 'x' })).toEqual({
      ok: false,
      errors: { expectedVersion: protocolEditMessages.expectedVersionInvalid },
    });
    const bad = validateVersionOnly(3);
    expect(Object.keys(bad.ok ? {} : bad.errors)).toEqual(['form']);
  });
});

describe('validateReorder', () => {
  it('needs exactly the live ids, once each', () => {
    expect(validateReorder({ expectedVersion: 1, order: ['b', 'a'] }, ['a', 'b'])).toEqual({
      ok: true,
      expectedVersion: 1,
      order: ['b', 'a'],
    });
    for (const order of [['a'], ['a', 'a'], ['a', 'c']])
      expect(validateReorder({ expectedVersion: 1, order }, ['a', 'b']).ok).toBe(false);
    expect(validateReorder({ expectedVersion: 1 }, ['a'])).toEqual({
      ok: false,
      errors: { form: protocolEditMessages.orderInvalid },
    });
  });
});

describe('validateSetCurrent', () => {
  it('marks by default and can unmark', () => {
    expect(validateSetCurrent({ expectedVersion: 2 })).toEqual({
      ok: true,
      expectedVersion: 2,
      note: null,
      current: true,
    });
    expect(validateSetCurrent({ expectedVersion: 2, current: false, note: 'x' })).toEqual({
      ok: true,
      expectedVersion: 2,
      note: 'x',
      current: false,
    });
  });

  it('rejects a bad version, a non-boolean flag and a body that is not an object', () => {
    for (const body of [{ expectedVersion: 0 }, { expectedVersion: 1, current: 'no' }, 4]) {
      const result = validateSetCurrent(body);
      expect(result.ok).toBe(false);
    }
  });
});
