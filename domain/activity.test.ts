import { describe, expect, it } from 'vitest';
import {
  activityMessages,
  validateClose,
  validateGenotyping,
  validateReopen,
  validateStartBreeding,
} from './activity';

const TODAY = '2026-09-30';

describe('validateStartBreeding', () => {
  it('accepts a date and trims the note', () => {
    expect(
      validateStartBreeding({ expectedVersion: 3, crossDate: '2026-09-01', note: ' x ' }, TODAY),
    ).toEqual({ ok: true, value: { expectedVersion: 3, crossDate: '2026-09-01', note: 'x' } });
  });

  it('explains a missing version, a bad date and a future date', () => {
    expect(validateStartBreeding({ crossDate: 'nope' }, TODAY)).toEqual({
      ok: false,
      errors: {
        expectedVersion: activityMessages.expectedVersionInvalid,
        crossDate: activityMessages.dateRequired,
      },
    });
    expect(validateStartBreeding({ expectedVersion: 1, crossDate: '2026-10-01' }, TODAY)).toEqual({
      ok: false,
      errors: { crossDate: activityMessages.crossDateFuture },
    });
  });

  it('reports a body that is not an object under "form"', () => {
    const result = validateStartBreeding(7, TODAY);
    expect(result.ok).toBe(false);
    expect(Object.keys(result.ok ? {} : result.errors)).toEqual(['form']);
  });
});

describe('validateGenotyping', () => {
  const base = { expectedVersion: 1, recordDate: '2026-09-10', isNewGeneration: false };

  it('reads counts typed as digits and blank screened as none', () => {
    expect(
      validateGenotyping({ ...base, positiveCount: '6', screenedCount: '' }, TODAY),
    ).toMatchObject({ ok: true, value: { positiveCount: 6, screenedCount: null, newDob: null } });
    expect(validateGenotyping({ ...base, positiveCount: 0 }, TODAY)).toMatchObject({
      ok: true,
      value: { positiveCount: 0, screenedCount: null },
    });
    expect(
      validateGenotyping({ ...base, positiveCount: 2, screenedCount: ' 9 ' }, TODAY),
    ).toMatchObject({ ok: true, value: { screenedCount: 9 } });
  });

  it('rejects negative, fractional and text counts', () => {
    for (const positiveCount of [-1, 1.5, 'x', undefined]) {
      expect(validateGenotyping({ ...base, positiveCount }, TODAY)).toMatchObject({
        ok: false,
        errors: { positiveCount: activityMessages.countRequired },
      });
    }
    expect(
      validateGenotyping({ ...base, positiveCount: 1, screenedCount: -2 }, TODAY),
    ).toMatchObject({ ok: false, errors: { screenedCount: activityMessages.countRequired } });
    expect(
      validateGenotyping({ ...base, positiveCount: 1, screenedCount: 'a' }, TODAY),
    ).toMatchObject({ ok: false, errors: { screenedCount: activityMessages.countRequired } });
  });

  it('needs the generation choice, a future date is refused', () => {
    expect(
      validateGenotyping({ expectedVersion: 1, recordDate: '2026-09-10', positiveCount: 1 }, TODAY),
    ).toMatchObject({ ok: false, errors: { isNewGeneration: activityMessages.generationChoice } });
    expect(
      validateGenotyping({ ...base, recordDate: '2026-12-01', positiveCount: 1 }, TODAY),
    ).toMatchObject({ ok: false, errors: { recordDate: activityMessages.recordDateFuture } });
  });

  it('screened must not be below positive; a new generation needs a new DOB', () => {
    expect(
      validateGenotyping(
        { ...base, positiveCount: 5, screenedCount: 4, isNewGeneration: true },
        TODAY,
      ),
    ).toEqual({
      ok: false,
      errors: {
        screenedCount: activityMessages.screenedTooSmall,
        newDob: activityMessages.newDobRequired,
      },
    });
    expect(
      validateGenotyping(
        {
          ...base,
          positiveCount: 5,
          screenedCount: 5,
          isNewGeneration: true,
          newDob: '2026-09-01',
        },
        TODAY,
      ),
    ).toMatchObject({ ok: true, value: { newDob: '2026-09-01' } });
  });
});

describe('validateClose and validateReopen', () => {
  it('treat the reason and note as optional text', () => {
    expect(validateClose({ expectedVersion: 2 })).toEqual({
      ok: true,
      value: { expectedVersion: 2, reason: null },
    });
    expect(validateClose({ expectedVersion: 2, reason: 'x'.repeat(501) })).toMatchObject({
      ok: false,
      errors: { reason: activityMessages.reasonTooLong },
    });
    expect(validateReopen({ expectedVersion: 2, note: 'back' })).toEqual({
      ok: true,
      value: { expectedVersion: 2, note: 'back' },
    });
  });
});
