import { describe, expect, it } from 'vitest';
import {
  addDays,
  feedingMessages,
  isFeedingDate,
  isWeekend,
  monthBounds,
  monthDates,
  monthGrid,
  repeatEventDates,
  repeatWeekPlan,
  summaryCsvRows,
  tally,
  validateDayWrite,
  validateEventEdit,
  validateEventScope,
  validateEventWrite,
  validateMonth,
  validateRepeatWeek,
  weekdayIndex,
  weekdayName,
  type TallyDay,
} from './feeding';

const ANY_TEXT = expect.any(String) as string;
const ONE = { id: 'u1', name: 'Feeder One' };
const TWO = { id: 'u2', name: 'Feeder Two' };
const THREE = { id: 'u3', name: 'Feeder Three' };

describe('calendar arithmetic (no time zone involved)', () => {
  it('names the weekday of known dates', () => {
    expect(weekdayName('2026-10-01')).toBe('Thursday');
    expect(weekdayName('2026-10-31')).toBe('Saturday');
    expect(weekdayName('2024-02-29')).toBe('Thursday');
    expect(weekdayName('2000-01-01')).toBe('Saturday');
    expect(weekdayName('2100-12-31')).toBe('Friday');
    expect(weekdayIndex('2026-10-04')).toBe(0);
    expect(weekdayIndex('1969-12-31')).toBe(3);
  });

  it('adds days across month, year and leap-year edges and over daylight-saving changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01');
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29');
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-10-09', 7)).toBe('2026-10-16');
  });

  it('knows the weekend', () => {
    expect(isWeekend('2026-10-03')).toBe(true);
    expect(isWeekend('2026-10-04')).toBe(true);
    expect(isWeekend('2026-10-05')).toBe(false);
    expect(isWeekend('2026-10-02')).toBe(false);
  });

  it('accepts real dates inside 2000-01-01 … 2100-12-31 only', () => {
    expect(isFeedingDate('2026-10-09')).toBe(true);
    expect(isFeedingDate('2000-01-01')).toBe(true);
    expect(isFeedingDate('2100-12-31')).toBe(true);
    expect(isFeedingDate('1999-12-31')).toBe(false);
    expect(isFeedingDate('2101-01-01')).toBe(false);
    expect(isFeedingDate('2026-02-30')).toBe(false);
    expect(isFeedingDate(20261009)).toBe(false);
  });
});

describe('months', () => {
  it('validates YYYY-MM inside the range', () => {
    expect(validateMonth('2026-10')).toEqual({ ok: true, month: '2026-10' });
    expect(validateMonth('2000-01').ok).toBe(true);
    expect(validateMonth('2100-12').ok).toBe(true);
    for (const bad of ['2026-13', '2026-00', '1999-12', '2101-01', '2026-1', 'abc', 7, undefined]) {
      expect(validateMonth(bad)).toEqual({ ok: false, message: feedingMessages.monthInvalid });
    }
  });

  it('knows the first and last date of a month', () => {
    expect(monthBounds('2026-10')).toEqual({ first: '2026-10-01', last: '2026-10-31' });
    expect(monthBounds('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' });
    expect(monthBounds('2024-02').last).toBe('2024-02-29');
    expect(monthBounds('2026-02').last).toBe('2026-02-28');
    expect(monthBounds('2026-04').last).toBe('2026-04-30');
    expect(monthDates('2026-02')).toHaveLength(28);
    expect(monthDates('2024-02')).toHaveLength(29);
    expect(monthDates('2026-10')[30]).toBe('2026-10-31');
  });

  it('lays October 2026 out Sunday first: the 1st on Thursday, the 31st on Saturday', () => {
    const grid = monthGrid('2026-10');
    expect(grid).toHaveLength(5);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(grid[4]?.[6]).toBe('2026-10-31');
    expect(grid.flat().filter((cell) => cell !== null)).toHaveLength(31);
  });

  it('lays out months starting on every weekday, 28 to 31 days', () => {
    // Sunday start: 2026-02 starts on Sunday and has 28 days: exactly four full weeks.
    expect(monthGrid('2026-02')).toHaveLength(4);
    expect(monthGrid('2026-02')[0]?.[0]).toBe('2026-02-01');
    // Monday: 2026-06; Tuesday: 2026-09; Wednesday: 2026-04; Friday: 2026-05; Saturday: 2026-08.
    for (const [month, index] of [
      ['2026-06', 1],
      ['2026-09', 2],
      ['2026-04', 3],
      ['2026-10', 4],
      ['2026-05', 5],
      ['2026-08', 6],
    ] as const) {
      const first = monthGrid(month)[0]?.findIndex((cell) => cell !== null);
      expect(first).toBe(index);
    }
    // A 31-day month that starts on Saturday needs six rows.
    expect(monthGrid('2026-08')).toHaveLength(6);
  });
});

describe('tally (BR-16)', () => {
  const day = (date: string, person: typeof ONE | null): TallyDay => ({ date, person });

  it('counts weekdays and weekend days per person and the unassigned days', () => {
    const result = tally([
      day('2026-10-01', ONE),
      day('2026-10-02', ONE),
      day('2026-10-03', TWO),
      day('2026-10-04', ONE),
      day('2026-10-05', null),
      day('2026-10-06', TWO),
    ]);
    expect(result.unassigned).toBe(1);
    expect(result.byUser).toEqual([
      { userId: 'u1', name: 'Feeder One', weekdays: 2, weekend: 1, total: 3 },
      { userId: 'u2', name: 'Feeder Two', weekdays: 1, weekend: 1, total: 2 },
    ]);
  });

  it('sorts by total (most first), then name, then id', () => {
    const a = { id: 'b', name: 'Same' };
    const b = { id: 'a', name: 'Same' };
    const result = tally([
      day('2026-10-05', THREE),
      day('2026-10-06', TWO),
      day('2026-10-07', ONE),
      day('2026-10-08', ONE),
      day('2026-10-09', a),
      day('2026-10-12', b),
    ]);
    expect(result.byUser.map((entry) => entry.userId)).toEqual(['u1', 'u3', 'u2', 'a', 'b']);
  });

  it('is empty for no days', () => {
    expect(tally([])).toEqual({ byUser: [], unassigned: 0 });
  });

  it('reproduces a hand count for October 2026 (31 days, 22 weekdays and 9 weekend days)', () => {
    const days = monthDates('2026-10').map((date, index) =>
      day(date, index % 3 === 0 ? ONE : index % 3 === 1 ? TWO : THREE),
    );
    const result = tally(days);
    // Days 1, 4, 7 … 31 are One (11 days), 2, 5 … 29 Two (10), 3, 6 … 30 Three (10).
    expect(result.byUser.map((entry) => [entry.name, entry.total])).toEqual([
      ['Feeder One', 11],
      ['Feeder Three', 10],
      ['Feeder Two', 10],
    ]);
    expect(result.byUser.reduce((sum, entry) => sum + entry.weekdays, 0)).toBe(22);
    expect(result.byUser.reduce((sum, entry) => sum + entry.weekend, 0)).toBe(9);
  });
});

describe('validateDayWrite', () => {
  it('accepts a person with a trimmed note, and an empty note as null', () => {
    expect(
      validateDayWrite({ userId: 'u1', note: '  cover for Mon ', expectedAssignmentId: null }),
    ).toEqual({
      ok: true,
      value: { userId: 'u1', note: 'cover for Mon', expectedAssignmentId: null },
    });
    expect(validateDayWrite({ userId: 'u1', expectedAssignmentId: 'a1' })).toEqual({
      ok: true,
      value: { userId: 'u1', note: null, expectedAssignmentId: 'a1' },
    });
    expect(validateDayWrite({ userId: 'u1', note: '', expectedAssignmentId: null })).toMatchObject({
      ok: true,
      value: { note: null },
    });
  });

  it('clears the day: no person means no note', () => {
    expect(validateDayWrite({ userId: null, note: 'ignored', expectedAssignmentId: 'a1' })).toEqual(
      {
        ok: true,
        value: { userId: null, note: null, expectedAssignmentId: 'a1' },
      },
    );
  });

  it('refuses a missing person key, an empty id, a long note and a missing expected id', () => {
    expect(validateDayWrite({ expectedAssignmentId: null })).toEqual({
      ok: false,
      errors: { userId: feedingMessages.userInvalid },
    });
    expect(validateDayWrite({ userId: '', expectedAssignmentId: null })).toMatchObject({
      ok: false,
    });
    expect(
      validateDayWrite({ userId: 'u1', note: 'x'.repeat(201), expectedAssignmentId: null }),
    ).toEqual({
      ok: false,
      errors: { note: feedingMessages.noteTooLong },
    });
    expect(validateDayWrite({ userId: 'u1' })).toEqual({
      ok: false,
      errors: { expectedAssignmentId: feedingMessages.expectedInvalid },
    });
    expect(validateDayWrite('nope')).toMatchObject({ ok: false });
    expect(validateDayWrite(undefined)).toMatchObject({
      ok: false,
      errors: { form: ANY_TEXT },
    });
    expect(
      validateDayWrite({ userId: 'u1', note: 'x'.repeat(200), expectedAssignmentId: null }).ok,
    ).toBe(true);
  });
});

describe('validateEventWrite', () => {
  it('accepts a one-off and a weekly repeat request', () => {
    expect(validateEventWrite({ date: '2026-10-12', title: ' Test Water Quality ' })).toEqual({
      ok: true,
      value: {
        date: '2026-10-12',
        title: 'Test Water Quality',
        note: null,
        repeatUntil: null,
        dryRun: false,
      },
    });
    expect(
      validateEventWrite({
        date: '2026-10-12',
        title: 'Inspection',
        note: 'all',
        repeatUntil: '2026-12-28',
        dryRun: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        date: '2026-10-12',
        title: 'Inspection',
        note: 'all',
        repeatUntil: '2026-12-28',
        dryRun: true,
      },
    });
  });

  it('refuses a bad date, a missing, blank or long title and a long note', () => {
    expect(validateEventWrite({ title: 'x' })).toEqual({
      ok: false,
      errors: { date: feedingMessages.dateInvalid },
    });
    expect(validateEventWrite({ date: '2101-01-01', title: 'x' })).toMatchObject({ ok: false });
    expect(validateEventWrite({ date: '2026-10-12' })).toEqual({
      ok: false,
      errors: { title: feedingMessages.titleRequired },
    });
    expect(validateEventWrite({ date: '2026-10-12', title: '   ' })).toMatchObject({ ok: false });
    expect(validateEventWrite({ date: '2026-10-12', title: 'x'.repeat(61) })).toEqual({
      ok: false,
      errors: { title: feedingMessages.titleTooLong },
    });
    expect(validateEventWrite({ date: '2026-10-12', title: 'x'.repeat(60) }).ok).toBe(true);
    expect(
      validateEventWrite({ date: '2026-10-12', title: 'x', note: 'y'.repeat(201) }),
    ).toMatchObject({ ok: false });
  });
});

describe('validateEventEdit / validateEventScope', () => {
  it('accepts a title, a note or both, with scope defaulting to this', () => {
    expect(validateEventEdit({ title: ' New ' })).toEqual({
      ok: true,
      value: { scope: 'this', title: 'New' },
    });
    expect(validateEventEdit({ note: 'later', scope: 'following' })).toEqual({
      ok: true,
      value: { scope: 'following', note: 'later' },
    });
    expect(validateEventEdit({ title: 'T', note: '' })).toEqual({
      ok: true,
      value: { scope: 'this', title: 'T', note: null },
    });
  });

  it('refuses an empty change, a blank title and an unknown scope', () => {
    expect(validateEventEdit({})).toEqual({
      ok: false,
      errors: { title: feedingMessages.nothingToChange },
    });
    expect(validateEventEdit({ scope: 'this' })).toMatchObject({ ok: false });
    expect(validateEventEdit({ title: ' ' })).toMatchObject({ ok: false });
    expect(validateEventEdit({ title: 'T', scope: 'all' })).toEqual({
      ok: false,
      errors: { scope: feedingMessages.scopeInvalid },
    });
    expect(validateEventEdit(undefined)).toMatchObject({ ok: false });
  });

  it('reads the delete scope from the query string', () => {
    expect(validateEventScope(undefined)).toBe('this');
    expect(validateEventScope('this')).toBe('this');
    expect(validateEventScope('following')).toBe('following');
    expect(validateEventScope('all')).toBeNull();
  });
});

describe('repeatEventDates (BR-19)', () => {
  it('steps weekly from the start through the last date on or before the end', () => {
    const result = repeatEventDates('2026-10-12', '2026-12-28');
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.dates).toHaveLength(12);
      expect(result.dates[0]).toBe('2026-10-12');
      expect(result.dates[11]).toBe('2026-12-28');
      expect(result.dates.every((date) => weekdayIndex(date) === 1)).toBe(true);
    }
    expect(repeatEventDates('2026-10-12', '2026-12-30')).toMatchObject({ ok: true });
    expect(repeatEventDates('2026-10-12', '2026-10-19')).toEqual({
      ok: true,
      dates: ['2026-10-12', '2026-10-19'],
    });
  });

  it('keeps the date strings exact across daylight-saving changes', () => {
    const result = repeatEventDates('2026-10-26', '2026-11-16');
    expect(result).toEqual({
      ok: true,
      dates: ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'],
    });
  });

  it('allows 104 rows and refuses 105', () => {
    const last = addDays('2026-10-12', 7 * 103);
    const ok = repeatEventDates('2026-10-12', last);
    expect(ok.ok && ok.dates.length).toBe(104);
    expect(repeatEventDates('2026-10-12', addDays(last, 7))).toEqual({
      ok: false,
      problem: 'tooMany',
      message: feedingMessages.tooMany,
    });
  });

  it('names each problem', () => {
    expect(repeatEventDates('2026-10-12', '2026-10-11')).toMatchObject({
      ok: false,
      problem: 'untilBeforeStart',
    });
    expect(repeatEventDates('2026-10-12', '2026-10-12')).toMatchObject({
      ok: false,
      problem: 'tooFew',
    });
    expect(repeatEventDates('2026-10-12', '2026-10-18')).toMatchObject({
      ok: false,
      problem: 'tooFew',
    });
    expect(repeatEventDates('2100-12-24', '2101-01-07')).toMatchObject({
      ok: false,
      problem: 'outOfRange',
    });
    expect(repeatEventDates('2100-12-24', '2100-12-31')).toMatchObject({ ok: true });
    expect(repeatEventDates('2026-10-12', 'soon')).toMatchObject({
      ok: false,
      problem: 'invalidDate',
    });
    expect(repeatEventDates('2026-10-12', undefined)).toMatchObject({
      ok: false,
      problem: 'invalidDate',
    });
    expect(repeatEventDates('1999-01-01', '2026-10-12')).toMatchObject({
      ok: false,
      problem: 'invalidDate',
    });
  });
});

describe('repeatWeekPlan (FR-FEED-15)', () => {
  const week = [
    { date: '2026-10-04', userId: null },
    { date: '2026-10-05', userId: 'u1' },
    { date: '2026-10-06', userId: 'u2' },
    { date: '2026-10-07', userId: 'u1' },
    { date: '2026-10-08', userId: null },
    { date: '2026-10-09', userId: 'u3' },
    { date: '2026-10-10', userId: 'u3' },
  ];
  const month = (assigned: Record<string, string>) =>
    monthDates('2026-10').map((date) => ({ date, userId: assigned[date] ?? null }));

  it('fills the empty days after the source week with the weekday pattern', () => {
    const plan = repeatWeekPlan(week, month({}), false);
    // Weeks of Oct 11, 18, 25: Mon, Tue, Wed, Fri, Sat each have a feeder → 5 per week for 3 weeks.
    expect(plan.filled).toBe(15);
    expect(plan.kept).toBe(0);
    expect(plan.replaced).toBe(0);
    expect(plan.writes[0]).toEqual({ date: '2026-10-12', userId: 'u1' });
    expect(plan.writes.map((write) => write.date)).toEqual(
      [...plan.writes.map((write) => write.date)].sort(),
    );
    // Sundays and Thursdays have no feeder in the source week: left unchanged.
    expect(
      plan.writes.some((write) => weekdayIndex(write.date) === 0 || weekdayIndex(write.date) === 4),
    ).toBe(false);
    // Nothing before or inside the source week.
    expect(plan.writes.every((write) => write.date > '2026-10-10')).toBe(true);
  });

  it('keeps assigned days, or replaces them with overwrite (a day that already matches is kept)', () => {
    const assigned = { '2026-10-12': 'u2', '2026-10-13': 'u2', '2026-10-14': 'u1' };
    const keep = repeatWeekPlan(week, month(assigned), false);
    expect(keep).toMatchObject({ filled: 12, kept: 3, replaced: 0 });
    expect(keep.writes.some((write) => write.date === '2026-10-12')).toBe(false);
    const over = repeatWeekPlan(week, month(assigned), true);
    expect(over).toMatchObject({ filled: 12, kept: 2, replaced: 1 });
    expect(over.writes.find((write) => write.date === '2026-10-12')).toEqual({
      date: '2026-10-12',
      userId: 'u1',
    });
  });

  it('does not depend on the order of the source days', () => {
    const forward = repeatWeekPlan(week, month({}), false);
    expect(repeatWeekPlan([...week].reverse(), month({}), false)).toEqual(forward);
  });

  it('does nothing when the source week has no feeder', () => {
    const empty = week.map((day) => ({ ...day, userId: null }));
    expect(repeatWeekPlan(empty, month({}), true)).toEqual({
      writes: [],
      filled: 0,
      kept: 0,
      replaced: 0,
    });
  });
});

describe('validateRepeatWeek', () => {
  it('accepts a week that overlaps the month, with optional flags', () => {
    expect(validateRepeatWeek({ weekStart: '2026-10-04', month: '2026-10' })).toEqual({
      ok: true,
      value: { weekStart: '2026-10-04', month: '2026-10', overwrite: false, dryRun: false },
    });
    expect(
      validateRepeatWeek({
        weekStart: '2026-09-27',
        month: '2026-10',
        overwrite: true,
        dryRun: true,
      }),
    ).toMatchObject({
      ok: true,
      value: { overwrite: true, dryRun: true },
    });
  });

  it('refuses a bad month, a bad date and a week outside the month', () => {
    expect(validateRepeatWeek({ weekStart: '2026-10-04', month: '2026-13' })).toEqual({
      ok: false,
      errors: { month: feedingMessages.monthInvalid },
    });
    expect(validateRepeatWeek({ weekStart: 'x', month: '2026-10' })).toEqual({
      ok: false,
      errors: { weekStart: feedingMessages.dateInvalid },
    });
    expect(validateRepeatWeek({ weekStart: '2026-09-20', month: '2026-10' })).toEqual({
      ok: false,
      errors: { weekStart: feedingMessages.weekInvalid },
    });
    expect(validateRepeatWeek({ weekStart: '2026-11-01', month: '2026-10' })).toMatchObject({
      ok: false,
    });
    expect(validateRepeatWeek(null)).toMatchObject({
      ok: false,
      errors: { month: ANY_TEXT, weekStart: ANY_TEXT },
    });
  });
});

describe('summaryCsvRows (FR-FEED-17)', () => {
  it('writes a header, one row per day, then totals and Unassigned', () => {
    const rows = summaryCsvRows([
      { date: '2026-10-01', person: ONE, note: 'cover', events: [] },
      { date: '2026-10-02', person: null, note: null, events: ['Inspection', 'Water'] },
      { date: '2026-10-03', person: TWO, note: null, events: [] },
    ]);
    expect(rows[0]).toEqual([
      'Section',
      'Date',
      'Weekday',
      'Feeder',
      'Note',
      'Events',
      'Weekday days',
      'Weekend days',
      'Total days',
    ]);
    expect(rows[1]).toEqual([
      'day',
      '2026-10-01',
      'Thursday',
      'Feeder One',
      'cover',
      '',
      '',
      '',
      '',
    ]);
    expect(rows[2]).toEqual([
      'day',
      '2026-10-02',
      'Friday',
      '',
      '',
      'Inspection; Water',
      '',
      '',
      '',
    ]);
    expect(rows.slice(4)).toEqual([
      ['total', '', '', 'Feeder One', '', '', '1', '0', '1'],
      ['total', '', '', 'Feeder Two', '', '', '0', '1', '1'],
      ['total', '', '', 'Unassigned', '', '', '', '', '1'],
    ]);
  });

  it('has no Unassigned row when every day has a feeder', () => {
    const rows = summaryCsvRows([{ date: '2026-10-01', person: ONE, note: null, events: [] }]);
    expect(rows.map((row) => row[3])).toEqual(['Feeder', 'Feeder One', 'Feeder One']);
  });
});
