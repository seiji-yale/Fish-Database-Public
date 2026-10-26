/**
 * Feeding Schedule rules (T-033, docs/08 §3, §6.6, BR-13 … BR-19). Pure: dates are `YYYY-MM-DD` strings and
 * all calendar arithmetic is done on the numbers, never through a local-time `Date`, so a daylight-saving
 * day cannot shift anything. The Worker and the client use the same functions (BR-16: one tally for the
 * page, the CSV and the PDF).
 */
import { z } from 'zod';
import { isIsoDate } from './dates';
import { newLineMessages, optionalText } from './newLine';

export const FEEDING_MIN_DATE = '2000-01-01';
export const FEEDING_MAX_DATE = '2100-12-31';
export const FEEDING_NOTE_MAX = 200;
export const EVENT_TITLE_MAX = 60;
export const SERIES_MIN_ROWS = 2;
export const SERIES_MAX_ROWS = 104;

export const feedingMessages = {
  monthInvalid: 'Enter the month as YYYY-MM, from 2000-01 to 2100-12.',
  dateInvalid: 'Enter the date as YYYY-MM-DD, from 2000-01-01 to 2100-12-31.',
  userInvalid: 'Choose a person from the list, or Nobody.',
  expectedInvalid: 'Reload the page and try again.',
  noteTooLong: newLineMessages.textTooLong(FEEDING_NOTE_MAX),
  titleRequired: 'Enter a title for this event.',
  titleTooLong: newLineMessages.textTooLong(EVENT_TITLE_MAX),
  untilInvalid: 'Enter the last date as YYYY-MM-DD.',
  untilBeforeStart: 'The last date must not be before the first date.',
  untilTooSoon: 'To repeat weekly, choose a last date at least one week after the first date.',
  tooMany: `A weekly repeat can have at most ${String(SERIES_MAX_ROWS)} events (two years). Choose an earlier last date.`,
  untilOutOfRange: 'The last date cannot be after 2100-12-31.',
  scopeInvalid: 'Choose this event only, or this and all following.',
  scopeNeedsSeries: 'This event does not repeat, so it has no following events.',
  weekInvalid: 'Choose a week in the month on screen.',
  nothingToChange: 'Enter a new title or note.',
} as const;

// ---------------------------------------------------------------- dates

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** Days since 1970-01-01 of a valid calendar date (proleptic Gregorian, no time zone). */
function dayNumber(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(days: number): string {
  const z0 = days + 719468;
  const era = Math.floor(z0 / 146097);
  const doe = z0 - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function parts(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** True for a real calendar date inside the schedule's range (BR-18). */
export function isFeedingDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isIsoDate(value) &&
    value >= FEEDING_MIN_DATE &&
    value <= FEEDING_MAX_DATE
  );
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(...parts(date)) + days);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayIndex(date: string): number {
  return (((dayNumber(...parts(date)) + 4) % 7) + 7) % 7;
}

export function weekdayName(date: string): string {
  return String(WEEKDAYS[weekdayIndex(date)]);
}

/** Saturday and Sunday (BR-16). */
export function isWeekend(date: string): boolean {
  const index = weekdayIndex(date);
  return index === 0 || index === 6;
}

// ---------------------------------------------------------------- months

export type MonthCheck = { ok: true; month: string } | { ok: false; message: string };

export function validateMonth(value: unknown): MonthCheck {
  if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) {
    const month = Number(value.slice(5));
    const year = Number(value.slice(0, 4));
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100)
      return { ok: true, month: value };
  }
  return { ok: false, message: feedingMessages.monthInvalid };
}

/** The first and last date of a valid month. */
export function monthBounds(month: string): { first: string; last: string } {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5));
  const first = `${month}-01`;
  const nextFirst =
    number === 12 ? `${pad(year + 1, 4)}-01-01` : `${pad(year, 4)}-${pad(number + 1)}-01`;
  return { first, last: addDays(nextFirst, -1) };
}

/** Every date of a valid month, in order. */
export function monthDates(month: string): string[] {
  const { first, last } = monthBounds(month);
  const count = Number(last.slice(8));
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

/** Weeks of 7 cells, Sunday first; days outside the month are `null` (FR-FEED-04). */
export function monthGrid(month: string): (string | null)[][] {
  const dates = monthDates(month);
  const cells: (string | null)[] = [
    ...Array.from<null>({ length: weekdayIndex(`${month}-01`) }).fill(null),
    ...dates,
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let at = 0; at < cells.length; at += 7) weeks.push(cells.slice(at, at + 7));
  return weeks;
}

// ---------------------------------------------------------------- tally (BR-16)

export interface DayPerson {
  id: string;
  name: string;
}

export interface TallyDay {
  date: string;
  person: DayPerson | null;
}

export interface UserTally {
  userId: string;
  name: string;
  weekdays: number;
  weekend: number;
  total: number;
}

export interface Tally {
  byUser: UserTally[];
  unassigned: number;
}

/** Days per person (weekdays / weekend days / total), most days first then by name, plus unassigned days. */
export function tally(days: readonly TallyDay[]): Tally {
  const byId = new Map<string, UserTally>();
  let unassigned = 0;
  for (const day of days) {
    if (day.person === null) {
      unassigned += 1;
      continue;
    }
    const entry = byId.get(day.person.id) ?? {
      userId: day.person.id,
      name: day.person.name,
      weekdays: 0,
      weekend: 0,
      total: 0,
    };
    if (isWeekend(day.date)) entry.weekend += 1;
    else entry.weekdays += 1;
    entry.total += 1;
    byId.set(day.person.id, entry);
  }
  const byUser = [...byId.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
  );
  return { byUser, unassigned };
}

// ---------------------------------------------------------------- validation

export type FeedingValidation<T> =
  { ok: true; value: T } | { ok: false; errors: Record<string, string> };

function validate<T>(schema: z.ZodType<T>, input: unknown): FeedingValidation<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join('.');
    errors[path === '' ? 'form' : path] ??= issue.message;
  }
  return { ok: false, errors };
}

const dateField = (message: string) => z.string({ error: message }).refine(isFeedingDate, message);
const idOrNull = (message: string) =>
  z.union([z.string({ error: message }).min(1, message), z.null()], { error: message });

const noteField = optionalText(FEEDING_NOTE_MAX);

const titleField = z
  .string({ error: feedingMessages.titleRequired })
  .trim()
  .min(1, feedingMessages.titleRequired)
  .max(EVENT_TITLE_MAX, feedingMessages.titleTooLong);

const dayWriteSchema = z.object({
  userId: idOrNull(feedingMessages.userInvalid),
  note: noteField,
  expectedAssignmentId: idOrNull(feedingMessages.expectedInvalid),
});

export type DayWriteInput = z.output<typeof dayWriteSchema>;

/** `PUT /api/feeding/days/:date` body. A cleared day (`userId` null) carries no note. */
export function validateDayWrite(input: unknown): FeedingValidation<DayWriteInput> {
  const result = validate(dayWriteSchema, input);
  if (result.ok && result.value.userId === null) result.value.note = null;
  return result;
}

const eventCreateSchema = z.object({
  date: dateField(feedingMessages.dateInvalid),
  title: titleField,
  note: noteField,
  repeatUntil: z.string().nullish(),
  dryRun: z.boolean().optional(),
});

export interface EventWriteInput {
  date: string;
  title: string;
  note: string | null;
  /** Present when the event repeats weekly. */
  repeatUntil: string | null;
  dryRun: boolean;
}

/** `POST /api/feeding/events` body. The repeat dates are checked by `repeatEventDates`. */
export function validateEventWrite(input: unknown): FeedingValidation<EventWriteInput> {
  const result = validate(eventCreateSchema, input);
  if (!result.ok) return result;
  const { repeatUntil, dryRun, ...rest } = result.value;
  return {
    ok: true,
    value: { ...rest, repeatUntil: repeatUntil ?? null, dryRun: dryRun === true },
  };
}

export type EventScope = 'this' | 'following';

const eventEditSchema = z
  .object({
    title: titleField.optional(),
    note: noteField.optional(),
    scope: z.enum(['this', 'following'], { error: feedingMessages.scopeInvalid }).optional(),
  })
  .refine((value) => value.title !== undefined || value.note !== undefined, {
    message: feedingMessages.nothingToChange,
    path: ['title'],
  });

export interface EventEditInput {
  title?: string;
  /** `null` clears the note; absent leaves it as it is. */
  note?: string | null;
  scope: EventScope;
}

/** `PATCH /api/feeding/events/:id` body: at least a title or a note; scope defaults to `this`. */
export function validateEventEdit(input: unknown): FeedingValidation<EventEditInput> {
  const result = validate(eventEditSchema, input);
  if (!result.ok) return result;
  const { title, note, scope } = result.value;
  const value: EventEditInput = { scope: scope ?? 'this' };
  if (title !== undefined) value.title = title;
  if (note !== undefined) value.note = note;
  return { ok: true, value };
}

/** `?scope=` of `DELETE /api/feeding/events/:id`. */
export function validateEventScope(value: unknown): EventScope | null {
  if (value === undefined) return 'this';
  return value === 'this' || value === 'following' ? value : null;
}

// ---------------------------------------------------------------- weekly repeat of events (BR-19)

export type RepeatEventProblem =
  'invalidDate' | 'untilBeforeStart' | 'tooFew' | 'tooMany' | 'outOfRange';

export type RepeatEventResult =
  { ok: true; dates: string[] } | { ok: false; problem: RepeatEventProblem; message: string };

const REPEAT_MESSAGES: Record<RepeatEventProblem, string> = {
  invalidDate: feedingMessages.untilInvalid,
  untilBeforeStart: feedingMessages.untilBeforeStart,
  tooFew: feedingMessages.untilTooSoon,
  tooMany: feedingMessages.tooMany,
  outOfRange: feedingMessages.untilOutOfRange,
};

/**
 * The dates of a weekly repeat: `start`, then every 7 days through the last one on or before `until`
 * (2 to 104 dates, all inside the schedule's range).
 */
export function repeatEventDates(start: string, until: unknown): RepeatEventResult {
  const fail = (problem: RepeatEventProblem): RepeatEventResult => ({
    ok: false,
    problem,
    message: REPEAT_MESSAGES[problem],
  });
  if (typeof until !== 'string' || !isIsoDate(until) || !isFeedingDate(start))
    return fail('invalidDate');
  if (until < start) return fail('untilBeforeStart');
  if (until > FEEDING_MAX_DATE) return fail('outOfRange');
  const dates: string[] = [];
  for (let date = start; date <= until; date = addDays(date, 7)) {
    dates.push(date);
    if (dates.length > SERIES_MAX_ROWS) return fail('tooMany');
  }
  return dates.length < SERIES_MIN_ROWS ? fail('tooFew') : { ok: true, dates };
}

// ---------------------------------------------------------------- repeat this week (FR-FEED-15)

export interface WeekDay {
  date: string;
  /** The assigned person's id, or null. */
  userId: string | null;
}

export interface RepeatWeekPlan {
  /** Days to write, in date order: each is an ordinary replacement (or a first assignment). */
  writes: { date: string; userId: string }[];
  /** Empty days that get a feeder. */
  filled: number;
  /** Assigned days left as they are. */
  kept: number;
  /** Assigned days given a different feeder (only with `overwrite`). */
  replaced: number;
}

/**
 * Copies a week's pattern onto the rest of the month: every day of `monthDays` after the source week
 * (`weekDays`, the 7 dates from its first day) takes the feeder its weekday has in the source week. A
 * weekday with no feeder in the source week is left unchanged. Assigned days are kept unless
 * `overwrite`; a day that already has the pattern's feeder is kept either way.
 */
export function repeatWeekPlan(
  weekDays: readonly WeekDay[],
  monthDays: readonly WeekDay[],
  overwrite: boolean,
): RepeatWeekPlan {
  const pattern = new Map<number, string>();
  for (const day of weekDays)
    if (day.userId !== null) pattern.set(weekdayIndex(day.date), day.userId);
  const weekEnd = weekDays.reduce((latest, day) => (day.date > latest ? day.date : latest), '');
  const plan: RepeatWeekPlan = { writes: [], filled: 0, kept: 0, replaced: 0 };
  for (const day of monthDays) {
    const wanted = pattern.get(weekdayIndex(day.date));
    if (day.date <= weekEnd || wanted === undefined) continue;
    if (day.userId === null) {
      plan.filled += 1;
      plan.writes.push({ date: day.date, userId: wanted });
    } else if (overwrite && day.userId !== wanted) {
      plan.replaced += 1;
      plan.writes.push({ date: day.date, userId: wanted });
    } else {
      plan.kept += 1;
    }
  }
  return plan;
}

/** `POST /api/feeding/repeat-week` body. */
export interface RepeatWeekInput {
  weekStart: string;
  month: string;
  overwrite: boolean;
  dryRun: boolean;
}

export function validateRepeatWeek(input: unknown): FeedingValidation<RepeatWeekInput> {
  const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  const month = validateMonth(raw['month']);
  if (!month.ok) errors['month'] = month.message;
  if (!isFeedingDate(raw['weekStart'])) errors['weekStart'] = feedingMessages.dateInvalid;
  else if (month.ok) {
    const { first, last } = monthBounds(month.month);
    if (addDays(raw['weekStart'], 6) < first || raw['weekStart'] > last)
      errors['weekStart'] = feedingMessages.weekInvalid;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      weekStart: raw['weekStart'] as string,
      month: (month as { month: string }).month,
      overwrite: raw['overwrite'] === true,
      dryRun: raw['dryRun'] === true,
    },
  };
}

// ---------------------------------------------------------------- summary CSV rows (FR-FEED-17, used by T-035)

export interface SummaryDay {
  date: string;
  person: DayPerson | null;
  note: string | null;
  /** Event titles of the day. */
  events: readonly string[];
}

export const SUMMARY_HEADER = [
  'Section',
  'Date',
  'Weekday',
  'Feeder',
  'Note',
  'Events',
  'Weekday days',
  'Weekend days',
  'Total days',
] as const;

/**
 * The monthly summary as rows of text, header first: one `day` row per calendar day, then one `total` row
 * per person and an `Unassigned` row when a day has no feeder. Same tally as the page (BR-16).
 */
export function summaryCsvRows(days: readonly SummaryDay[]): string[][] {
  const rows: string[][] = [[...SUMMARY_HEADER]];
  for (const day of days) {
    rows.push([
      'day',
      day.date,
      weekdayName(day.date),
      day.person?.name ?? '',
      day.note ?? '',
      day.events.join('; '),
      '',
      '',
      '',
    ]);
  }
  const { byUser, unassigned } = tally(days);
  for (const entry of byUser) {
    rows.push([
      'total',
      '',
      '',
      entry.name,
      '',
      '',
      String(entry.weekdays),
      String(entry.weekend),
      String(entry.total),
    ]);
  }
  if (unassigned > 0)
    rows.push(['total', '', '', 'Unassigned', '', '', '', '', String(unassigned)]);
  return rows;
}
