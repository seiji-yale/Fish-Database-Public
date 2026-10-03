import { describe, expect, it } from 'vitest';
import {
  ageInMonths,
  applyGenotyping,
  closeLine,
  InvalidGenotypingInputError,
  InvalidTransitionError,
  needsBreeding,
  reopenLine,
  runningIdedTotals,
  startBreeding,
} from './breeding';
import type { LineDoc, LineStatus } from './types';

function line(status: LineStatus = 'Current'): LineDoc {
  return {
    id: 'line-1',
    name: 'demo_c3',
    status,
    dob: '2025-09-07',
    generationNo: 3,
    idedNumber: 6,
    lastIdDate: '2026-01-08',
    breedingStartedAt: null,
    closedAt: null,
    closedReason: null,
    version: 1,
  };
}

describe('BR-1 status machine', () => {
  it.each<readonly [LineStatus, LineStatus]>([
    ['Current', 'Breeding'],
    ['Closed', 'Breeding'],
    ['Current', 'Closed'],
    ['Breeding', 'Closed'],
    ['Closed', 'Current'],
  ])('allows %s to %s only through its named action', (from, to) => {
    const source = line(from);
    const result =
      to === 'Breeding'
        ? startBreeding(source, '2026-09-20', '2026-09-25')
        : to === 'Closed'
          ? closeLine(source, '2026-09-20')
          : reopenLine(source);
    expect(result.status).toBe(to);
  });

  it.each<readonly [LineStatus, string]>([
    ['Breeding', 'start'],
    ['Closed', 'close'],
    ['Current', 'reopen'],
    ['Breeding', 'reopen'],
    ['Closed', 'new-generation'],
  ])('rejects forbidden transitions from %s', (status, action) => {
    const source = line(status);
    const act = () => {
      if (action === 'start') return startBreeding(source, '2026-09-20', '2026-09-25');
      if (action === 'close') return closeLine(source, '2026-09-20');
      if (action === 'reopen') return reopenLine(source);
      return applyGenotyping(
        source,
        { recordDate: '2026-09-20', positiveCount: 1, isNewGeneration: true, newDob: '2026-09-20' },
        '2026-09-25',
      );
    };
    expect(act).toThrow(InvalidTransitionError);
  });

  it('clears a closed reason when Start Breeding is used directly from Closed', () => {
    const result = startBreeding(
      { ...line('Closed'), closedAt: '2026-09-01', closedReason: 'Retired' },
      '2026-09-20',
      '2026-09-25',
    );
    expect(result).toMatchObject({
      breedingStartedAt: '2026-09-20',
      closedAt: null,
      closedReason: null,
    });
  });

  it('rejects malformed and future status dates', () => {
    expect(() => startBreeding(line(), 'not-a-date')).toThrow(InvalidGenotypingInputError);
    expect(() => startBreeding(line(), '2026-09-26', '2026-09-25')).toThrow(
      InvalidGenotypingInputError,
    );
    expect(() => startBreeding(line(), '2026-09-20', 'not-a-date')).toThrow(
      InvalidGenotypingInputError,
    );
    expect(() => closeLine(line(), 'not-a-date')).toThrow(InvalidGenotypingInputError);
  });
});

describe('BR-2 genotyping arithmetic', () => {
  it('adds positives and keeps status for a same-generation record', () => {
    expect(
      applyGenotyping(
        line('Breeding'),
        { recordDate: '2026-09-20', positiveCount: 4, isNewGeneration: false },
        '2026-09-25',
      ),
    ).toMatchObject({
      idedNumber: 10,
      lastIdDate: '2026-09-20',
      status: 'Breeding',
      generationNo: 3,
    });
  });

  it('resets positives and moves a Breeding line to Current for a new generation', () => {
    expect(
      applyGenotyping(
        { ...line('Breeding'), breedingStartedAt: '2026-09-01' },
        { recordDate: '2026-09-20', positiveCount: 8, isNewGeneration: true, newDob: '2026-09-01' },
        '2026-09-25',
      ),
    ).toMatchObject({
      idedNumber: 8,
      generationNo: 4,
      dob: '2026-09-01',
      status: 'Current',
      breedingStartedAt: null,
    });
  });

  it('allows a new generation directly from Current without pressing Start Breeding', () => {
    expect(
      applyGenotyping(
        line(),
        { recordDate: '2026-09-20', positiveCount: 8, isNewGeneration: true, newDob: '2026-09-02' },
        '2026-09-25',
      ).status,
    ).toBe('Current');
  });

  it('keeps generation dates consistent (OQ-31): the new DOB is later than the current one, and genotyping is not before it', () => {
    const newGeneration =
      (newDob: string, recordDate = '2026-09-20') =>
      () =>
        applyGenotyping(
          line(),
          { recordDate, positiveCount: 1, isNewGeneration: true, newDob },
          '2026-09-25',
        );
    expect(newGeneration('2025-09-07')).toThrow("later than the current generation's DOB");
    expect(newGeneration('2025-01-11')).toThrow("later than the current generation's DOB");
    expect(newGeneration('2026-09-10', '2026-09-05')).toThrow('cannot be before the new DOB');
    expect(newGeneration('2025-09-24')().generationNo).toBe(4);
    expect(
      applyGenotyping(
        { ...line(), dob: null },
        { recordDate: '2026-09-20', positiveCount: 2, isNewGeneration: true, newDob: '2026-09-01' },
        '2026-09-25',
      ).dob,
    ).toBe('2026-09-01');
  });

  it.each([
    [{ recordDate: '2026-09-20', positiveCount: -1, isNewGeneration: false }, 'negative positives'],
    [
      { recordDate: '2026-09-20', positiveCount: 1.5, isNewGeneration: false },
      'fractional positives',
    ],
    [{ recordDate: '2026-09-20', positiveCount: 1, isNewGeneration: true }, 'missing new DOB'],
    [{ recordDate: '2026-09-26', positiveCount: 1, isNewGeneration: false }, 'future record date'],
    [
      { recordDate: '2026-09-20', positiveCount: 1, isNewGeneration: true, newDob: '2026-09-26' },
      'future new DOB',
    ],
    [
      { recordDate: 'not-a-date', positiveCount: 1, isNewGeneration: false },
      'malformed record date',
    ],
    [
      { recordDate: '2026-09-20', positiveCount: 1, isNewGeneration: true, newDob: null },
      'null new DOB',
    ],
    [
      { recordDate: '2026-09-20', positiveCount: 1, isNewGeneration: true, newDob: '' },
      'empty new DOB',
    ],
  ] as const)('rejects %s', (record, description) => {
    expect(description).toBeTypeOf('string');
    expect(() => applyGenotyping(line(), record, '2026-09-25')).toThrow(
      InvalidGenotypingInputError,
    );
  });
});

describe('BR-3 upcoming breeding and calendar age', () => {
  it('uses calendar months, including a month-end DOB', () => {
    expect(ageInMonths('2026-01-31', '2026-02-28')).toBe(1);
    expect(ageInMonths('2026-01-31', '2026-02-27')).toBe(0);
    expect(ageInMonths('2025-09-25', '2026-09-25')).toBe(12);
    expect(() => ageInMonths('not-a-date', '2026-09-25')).toThrow(InvalidGenotypingInputError);
  });

  it('uses America/New_York when a timestamp is supplied', () => {
    expect(ageInMonths('2025-09-25', new Date('2026-08-25T03:30:00Z'))).toBe(10);
  });

  it('flags a Current line at exactly the threshold but excludes Breeding and missing DOB', () => {
    expect(needsBreeding(line(), '2026-08-07', 11)).toEqual({
      needsBreeding: true,
      missingDob: false,
      ageMonths: 11,
    });
    expect(
      needsBreeding({ ...line('Breeding'), dob: '2025-01-11' }, '2026-09-25', 11).needsBreeding,
    ).toBe(false);
    expect(needsBreeding(line(), '2026-08-06', 11).needsBreeding).toBe(false);
    expect(needsBreeding({ ...line(), dob: null }, '2026-09-25', 11)).toEqual({
      needsBreeding: false,
      missingDob: true,
      ageMonths: null,
    });
  });

  it('filters a synthetic cohort at the breeding threshold', () => {
    const exampleLines: ReadonlyArray<readonly [string, LineStatus, string]> = [
      ['example-old', 'Current', '2025-08-15'],
      ['example-boundary', 'Current', '2025-10-25'],
      ['example-young', 'Current', '2025-11-01'],
      ['example-breeding', 'Breeding', '2024-01-01'],
      ['example-closed', 'Closed', '2023-01-01'],
    ];
    const upcoming = exampleLines
      .filter(([, status, dob]) => needsBreeding({ status, dob }, '2026-09-25', 11).needsBreeding)
      .map(([name]) => name);
    const breeding = exampleLines
      .filter(([, status]) => status === 'Breeding')
      .map(([name]) => name);
    expect(upcoming).toEqual(['example-old', 'example-boundary']);
    expect(breeding).toEqual(['example-breeding']);
  });
});

describe('BR-2 running IDed total per generation (display)', () => {
  it('sums positives oldest first, and is empty for no records', () => {
    expect(runningIdedTotals([12, 0, 6])).toEqual([12, 12, 18]);
    expect(runningIdedTotals([])).toEqual([]);
  });
});
