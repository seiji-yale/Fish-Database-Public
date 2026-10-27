/**
 * Pure helpers of the Feeding Schedule page (T-034): the URL, the "unassigned soon" rule, the cell text,
 * the totals after a local change and the Notes & links linker. Calendar arithmetic comes from
 * `domain/feeding.ts`, the same code the server uses (BR-16).
 */
import { addDays, tally, validateMonth, weekdayIndex } from '../../domain/feeding';
import { labToday } from '../../domain/dates';
import type { FeedingDay, FeedingMonth } from './feedingApi';

export type FeedingViewMode = 'grid' | 'list';

export interface FeedingUrl {
  month: string;
  view: FeedingViewMode;
}

/** `?month=YYYY-MM&view=grid|list`; a missing or bad month means the current month in the lab's time zone. */
export function readFeedingUrl(search: string, today: string = labToday()): FeedingUrl {
  const params = new URLSearchParams(search);
  const month = validateMonth(params.get('month'));
  return {
    month: month.ok ? month.month : today.slice(0, 7),
    view: params.get('view') === 'list' ? 'list' : 'grid',
  };
}

/** The URL for a month and view; the default view stays out of the address. */
export function feedingHref(month: string, view: FeedingViewMode): string {
  return `/feeding?month=${month}${view === 'list' ? '&view=list' : ''}`;
}

/** The month before or after (`delta` -1 or 1), still inside the schedule's range; null at the edge. */
export function shiftMonth(month: string, delta: -1 | 1): string | null {
  const year = Number(month.slice(0, 4));
  const index = year * 12 + Number(month.slice(5)) - 1 + delta;
  const next = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
  return validateMonth(next).ok ? next : null;
}

/** FR-FEED-06: from today through today + 13 days a day without a feeder is flagged. */
export function isUnassignedSoon(day: FeedingDay, today: string): boolean {
  return day.assignment === null && day.date >= today && day.date <= addDays(today, 13);
}

/** The first date (a Sunday) of the week a grid row belongs to, from any date in that row. */
export function weekStartOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

/** One day replaced by the server's answer; the totals follow (same tally as the server, BR-16). */
export function withDay(month: FeedingMonth, day: FeedingDay): FeedingMonth {
  const days = month.days.map((existing) => (existing.date === day.date ? day : existing));
  const totals = tally(
    days.map((entry) => ({
      date: entry.date,
      person:
        entry.assignment === null
          ? null
          : { id: entry.assignment.userId, name: entry.assignment.userName },
    })),
  );
  return { ...month, days, totals };
}

/** "1 day", "2 days". */
export function dayCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'day' : 'days'}`;
}

export type TextPart = { text: string; href?: string };

/** Splits plain text into text and http(s) links; trailing punctuation stays outside the link. */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let rest = text;
  for (;;) {
    const match = /https?:\/\/[^\s<>"]+/.exec(rest);
    if (match === null) break;
    const url = match[0].replace(/[.,;:!?)\]]+$/, '');
    if (match.index > 0) parts.push({ text: rest.slice(0, match.index) });
    parts.push({ text: url, href: url });
    rest = rest.slice(match.index + url.length);
  }
  if (rest !== '') parts.push({ text: rest });
  return parts;
}
