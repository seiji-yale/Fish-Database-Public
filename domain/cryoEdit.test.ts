import { describe, expect, it } from 'vitest';
import {
  cryoEditMessages,
  compressCryoIds,
  cryoLabelOf,
  cryoUseMessages,
  parseVialIds,
  rangeContains,
  formatCryoId,
  nextCryoId,
  validateCryoRecord,
  validateCryoRemoval,
  validateCryoUse,
  exampleVialRange,
} from './cryoEdit';

const TODAY = '2026-09-30';
const base = { expectedVersion: 2 };

describe('nextCryoId', () => {
  it('is the largest existing number plus one, ignoring other formats and blanks', () => {
    expect(nextCryoId(['C0548', 'C0551', null, 'X12', 'C0636', ' c0600 '])).toBe('C0637');
    expect(nextCryoId([null, 'n/a'])).toBe('C0001');
    expect(nextCryoId([])).toBe('C0001');
    expect(formatCryoId(12345)).toBe('C12345');
  });
});

describe('validateCryoRecord', () => {
  it('derives the count from the range and upper-cases the IDs', () => {
    expect(
      validateCryoRecord(
        {
          ...base,
          cryoDate: '2026-09-01',
          place: 'Demo freezer shelf',
          cryoIdStart: 'c0701',
          cryoIdEnd: ' C0707 ',
          count: 99,
        },
        TODAY,
      ),
    ).toMatchObject({
      ok: true,
      value: { cryoIdStart: 'C0701', cryoIdEnd: 'C0707', count: 7, detailsUnknown: false },
    });
  });

  it('keeps an entered count when there is no range, and reads digits typed as text', () => {
    expect(
      validateCryoRecord({ ...base, place: 'External storage', count: '8' }, TODAY),
    ).toMatchObject({ ok: true, value: { count: 8, cryoIdStart: null } });
    expect(validateCryoRecord({ ...base, place: 'x', count: '' }, TODAY)).toMatchObject({
      ok: true,
      value: { count: null },
    });
  });

  it('rejects bad IDs, a half range, a backwards range and a bad count', () => {
    const errors = (input: object) => {
      const result = validateCryoRecord({ ...base, place: 'x', ...input }, TODAY);
      return result.ok ? {} : result.errors;
    };
    expect(errors({ cryoIdStart: 'C66', cryoIdEnd: 'C0551' })).toEqual({
      cryoIdStart: cryoEditMessages.idFormat,
    });
    expect(errors({ cryoIdStart: 'C0548' })).toHaveProperty('cryoIdEnd');
    expect(errors({ cryoIdEnd: 'C0548' })).toHaveProperty('cryoIdStart');
    expect(errors({ cryoIdStart: 'C0551', cryoIdEnd: 'C0548' })).toEqual({
      cryoIdEnd: cryoEditMessages.rangeBackwards,
    });
    for (const count of [-1, 1.5, 'x'])
      expect(errors({ count })).toEqual({ count: cryoEditMessages.countInvalid });
  });

  it('checks the date and the version, and refuses an empty record unless details are unknown', () => {
    const result = validateCryoRecord(
      { expectedVersion: 0, cryoDate: '2026-10-01', place: 'x' },
      TODAY,
    );
    expect(Object.keys(result.ok ? {} : result.errors).sort()).toEqual([
      'cryoDate',
      'expectedVersion',
    ]);
    const bad = validateCryoRecord({ ...base, cryoDate: 'soon' }, TODAY);
    expect(bad.ok).toBe(false);
    const empty = validateCryoRecord({ ...base }, TODAY);
    expect(Object.keys(empty.ok ? {} : empty.errors)).toEqual(['form']);
    expect(validateCryoRecord({ ...base, detailsUnknown: true }, TODAY).ok).toBe(true);
    expect(validateCryoRecord(5, TODAY).ok).toBe(false);
  });
});

describe('validateCryoRemoval', () => {
  it('needs the version; the note is optional', () => {
    expect(validateCryoRemoval({ expectedVersion: 3 })).toEqual({
      ok: true,
      expectedVersion: 3,
      note: null,
    });
    const bad = validateCryoRemoval({ expectedVersion: 'x' });
    expect(bad.ok).toBe(false);
    expect(validateCryoRemoval(7).ok).toBe(false);
  });
});

describe('cryoLabelOf', () => {
  const record = {
    cryoIdStart: null,
    cryoIdEnd: null,
    count: null,
    place: null,
    cryoDate: null,
    detailsUnknown: false,
  };
  it('describes a range, a single ID, external storage and unknown details', () => {
    expect(
      cryoLabelOf({
        ...record,
        cryoIdStart: 'C0637',
        cryoIdEnd: 'C0644',
        count: 8,
        place: 'Demo freezer shelf',
      }),
    ).toBe('C0637–C0644 (8) at Demo freezer shelf');
    expect(cryoLabelOf({ ...record, cryoIdStart: 'C0637', cryoIdEnd: 'C0637' })).toBe('C0637');
    expect(cryoLabelOf({ ...record, place: 'External storage', cryoDate: '2026-01-02' })).toBe(
      '2026-01-02 at External storage',
    );
    expect(cryoLabelOf({ ...record, detailsUnknown: true })).toBe('details unknown');
    expect(cryoLabelOf(record)).toBe('no IDs');
  });
});

describe('parseVialIds', () => {
  it('reads IDs and ranges separated by commas, spaces or line breaks; upper-cases them', () => {
    expect(parseVialIds('c0640, C0642-C0644;C0650\nC0660–C0661')).toEqual({
      ok: true,
      ids: ['C0640', 'C0642', 'C0643', 'C0644', 'C0650', 'C0660', 'C0661'],
    });
  });

  it('explains empty input, bad tokens, backwards ranges, duplicates and too many vials', () => {
    const message = (text: string) => {
      const result = parseVialIds(text);
      return result.ok ? '' : result.message;
    };
    expect(message('  ')).toBe(cryoUseMessages.idsRequired);
    expect(message('C0640 nope')).toBe(cryoUseMessages.idsFormat('NOPE'));
    expect(message('C0644-C0640')).toBe(cryoUseMessages.idsBackwards('C0644-C0640'));
    expect(message('C0640, C0639-C0641')).toBe(cryoUseMessages.idsDuplicate('C0640'));
    expect(message('C0001-C0800')).toBe(cryoUseMessages.idsTooMany);
  });
});

describe('rangeContains and compressCryoIds', () => {
  it('tests membership of a range and folds consecutive IDs', () => {
    expect(rangeContains('C0637', 'C0644', 'C0640')).toBe(true);
    expect(rangeContains('C0637', 'C0644', 'C0645')).toBe(false);
    expect(rangeContains(null, 'C0644', 'C0640')).toBe(false);
    expect(rangeContains('C0637', null, 'C0640')).toBe(false);
    expect(compressCryoIds(['C0643', 'C0640', 'C0642'])).toBe('C0640, C0642–C0643');
    expect(compressCryoIds(['C0640'])).toBe('C0640');
    expect(compressCryoIds([])).toBe('');
  });
});

describe('validateCryoUse', () => {
  const v = { expectedVersion: 2 };
  it('takes vial IDs (default date today) or a record plus a quantity', () => {
    expect(validateCryoUse({ ...v, vialIds: 'C0640-C0641', note: ' x ' }, TODAY)).toEqual({
      ok: true,
      value: {
        expectedVersion: 2,
        note: 'x',
        usedAt: TODAY,
        ids: ['C0640', 'C0641'],
        recordId: null,
        quantity: null,
      },
    });
    expect(
      validateCryoUse({ ...v, recordId: 'r1', quantity: '3', usedAt: '2026-09-01' }, TODAY),
    ).toMatchObject({
      ok: true,
      value: { ids: [], recordId: 'r1', quantity: 3, usedAt: '2026-09-01' },
    });
    expect(validateCryoUse({ ...v, vialIds: 'C0640', usedAt: '' }, TODAY)).toMatchObject({
      ok: true,
      value: { usedAt: TODAY },
    });
  });

  it('reports each problem on its field', () => {
    const errors = (input: object) => {
      const result = validateCryoUse({ ...v, ...input }, TODAY);
      return result.ok ? {} : result.errors;
    };
    expect(errors({})).toEqual({ vialIds: cryoUseMessages.chooseOne });
    const notObject = validateCryoUse(5, TODAY);
    expect(Object.keys(notObject.ok ? {} : notObject.errors)).toEqual(['form']);
    expect(errors({ vialIds: 'zzz' })).toHaveProperty('vialIds');
    expect(errors({ recordId: 'r1' })).toEqual({ quantity: cryoUseMessages.quantityInvalid });
    expect(errors({ recordId: 'r1', quantity: 0 })).toEqual({
      quantity: cryoUseMessages.quantityInvalid,
    });
    expect(errors({ vialIds: 'C0640', usedAt: '2026-10-01' })).toEqual({
      usedAt: cryoUseMessages.dateFuture,
    });
    expect(errors({ vialIds: 'C0640', usedAt: 'soon' })).toHaveProperty('usedAt');
    expect(errors({ vialIds: 'C0640', expectedVersion: 0 })).toHaveProperty('expectedVersion');
  });
});

describe('cryoUseMessages (the API fills these in)', () => {
  it('names the vial or the count in each message', () => {
    expect(cryoUseMessages.idNotOnLine('C1499')).toBe('C1499 is not a vial of this line.');
    expect(cryoUseMessages.idAlreadyUsed('C0640')).toBe(
      'C0640 was already used and cannot be used again.',
    );
    expect(cryoUseMessages.quantityTooMany(3)).toBe('Only 3 vials are left in this record.');
    expect(cryoUseMessages.reusedId('C0640')).toMatch(
      /C0640 was already used and cannot be registered/,
    );
    expect(cryoUseMessages.usedIdOutside('C0640')).toMatch(/\(C0640\)/);
  });
});

describe('exampleVialRange (the hint under "Used vial IDs")', () => {
  it('shows up to three consecutive available IDs', () => {
    expect(exampleVialRange(['C0637', 'C0638', 'C0639', 'C0640', 'C0641'])).toBe('C0637-C0639');
    expect(exampleVialRange(['C0650', 'C0651'])).toBe('C0650-C0651');
  });

  it('skips single IDs and starts at the first consecutive pair', () => {
    expect(exampleVialRange(['C0637', 'C0640', 'C0641', 'C0642', 'C0643'])).toBe('C0640-C0642');
  });

  it('works on unsorted lists and gives null when no two IDs are consecutive', () => {
    expect(exampleVialRange(['C0644', 'C0643'])).toBe('C0643-C0644');
    expect(exampleVialRange(['C0637', 'C0639'])).toBeNull();
    expect(exampleVialRange(['C0637'])).toBeNull();
    expect(exampleVialRange([])).toBeNull();
  });
});
