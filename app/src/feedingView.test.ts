import { describe, expect, it } from 'vitest';
import type { FeedingDay, FeedingMonth } from './feedingApi';
import {
  dayCount,
  feedingHref,
  isUnassignedSoon,
  linkParts,
  readFeedingUrl,
  shiftMonth,
  weekStartOf,
  withDay,
} from './feedingView';

const day = (date: string, name: string | null): FeedingDay => ({
  date,
  weekday: 'Thursday',
  assignment:
    name === null
      ? null
      : {
          id: `a-${date}`,
          userId: name,
          userName: name,
          note: null,
          createdAt: '',
          createdByName: '',
        },
  events: [],
});

describe('the Feeding Schedule URL', () => {
  it('reads the month and the phone layout, and falls back to the current month', () => {
    expect(readFeedingUrl('?month=2026-11&view=list', '2026-10-09')).toEqual({
      month: '2026-11',
      view: 'list',
    });
    expect(readFeedingUrl('', '2026-10-09')).toEqual({ month: '2026-10', view: 'grid' });
    expect(readFeedingUrl('?month=2026-13&view=other', '2026-10-09')).toEqual({
      month: '2026-10',
      view: 'grid',
    });
  });

  it('writes the month, and the view only when it is not the default', () => {
    expect(feedingHref('2026-10', 'grid')).toBe('/feeding?month=2026-10');
    expect(feedingHref('2026-10', 'list')).toBe('/feeding?month=2026-10&view=list');
  });

  it('moves to the next and previous month across years and stops at the range', () => {
    expect(shiftMonth('2026-10', 1)).toBe('2026-11');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2000-01', -1)).toBeNull();
    expect(shiftMonth('2100-12', 1)).toBeNull();
  });
});

describe('the unassigned warning (FR-FEED-06)', () => {
  it('covers today through today + 13 days, and only days without a feeder', () => {
    const today = '2026-10-09';
    expect(isUnassignedSoon(day('2026-10-08', null), today)).toBe(false);
    expect(isUnassignedSoon(day('2026-10-09', null), today)).toBe(true);
    expect(isUnassignedSoon(day('2026-10-22', null), today)).toBe(true);
    expect(isUnassignedSoon(day('2026-10-23', null), today)).toBe(false);
    expect(isUnassignedSoon(day('2026-10-10', 'Feeder One'), today)).toBe(false);
  });
});

describe('week rows', () => {
  it('start on Sunday, whichever day of the row is given', () => {
    expect(weekStartOf('2026-10-01')).toBe('2026-09-27');
    expect(weekStartOf('2026-10-04')).toBe('2026-10-04');
    expect(weekStartOf('2026-10-10')).toBe('2026-10-04');
  });
});

describe('a local change', () => {
  const month: FeedingMonth = {
    month: '2026-10',
    today: '2026-10-09',
    days: [day('2026-10-01', 'Feeder One'), day('2026-10-03', null)],
    assignable: [],
    totals: { byUser: [], unassigned: 0 },
    notes: '',
  };

  it('replaces the day and recounts the totals the way the server does', () => {
    const next = withDay(month, day('2026-10-03', 'Feeder Two'));
    expect(next.days[1]?.assignment?.userName).toBe('Feeder Two');
    expect(next.totals.unassigned).toBe(0);
    expect(next.totals.byUser).toEqual([
      { userId: 'Feeder One', name: 'Feeder One', weekdays: 1, weekend: 0, total: 1 },
      { userId: 'Feeder Two', name: 'Feeder Two', weekdays: 0, weekend: 1, total: 1 },
    ]);
    const cleared = withDay(next, day('2026-10-01', null));
    expect(cleared.totals.unassigned).toBe(1);
  });
});

describe('text helpers', () => {
  it('counts days in the singular and the plural', () => {
    expect(dayCount(1)).toBe('1 day');
    expect(dayCount(0)).toBe('0 days');
    expect(dayCount(12)).toBe('12 days');
  });

  it('turns web addresses into links and keeps the punctuation after them', () => {
    expect(linkParts('Rota: https://example.test/a, then see https://example.test/b.')).toEqual([
      { text: 'Rota: ' },
      { text: 'https://example.test/a', href: 'https://example.test/a' },
      { text: ', then see ' },
      { text: 'https://example.test/b', href: 'https://example.test/b' },
      { text: '.' },
    ]);
    expect(linkParts('no links here')).toEqual([{ text: 'no links here' }]);
    expect(linkParts('http://x.test')).toEqual([{ text: 'http://x.test', href: 'http://x.test' }]);
    expect(linkParts('')).toEqual([]);
  });
});
