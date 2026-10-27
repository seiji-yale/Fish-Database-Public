/**
 * The Feeding Schedule read model (docs/08 §8): one query per table for a month, joined in memory.
 * `GET /api/feeding` and the answer of `PUT /api/feeding/days/:date` both use `dayState` / `loadMonth`,
 * so the page and the day dialog never see two different shapes.
 */
import { ASSIGNABLE_ROLES } from '../../domain/permissions';
import { monthDates, tally, weekdayName, type Tally } from '../../domain/feeding';
import type { Db } from '../db/db';
import { listCurrentAssignments } from '../db/queries/feedingAssignments';
import { listEventsInRange, listSeriesDatesFrom } from '../db/queries/scheduleEvents';
import { getSetting } from '../db/queries/settings';
import { listUsers } from '../db/queries/users';
import type { FeedingAssignmentRow, ScheduleEventRow, UserRow } from '../db/types';
import { displayTimestamp } from './lineWrite';

export interface AssignmentView {
  id: string;
  userId: string;
  userName: string;
  note: string | null;
  createdAt: string;
  createdByName: string;
}

export interface EventView {
  id: string;
  seriesId: string | null;
  title: string;
  note: string | null;
  /** This occurrence plus every later live one of the same series; 1 for a one-off. */
  followingCount: number;
}

export interface FeedingDayView {
  date: string;
  weekday: string;
  assignment: AssignmentView | null;
  events: EventView[];
}

export interface PersonView {
  id: string;
  name: string;
  role: UserRow['role'];
}

export interface MonthView {
  month: string;
  today: string;
  days: FeedingDayView[];
  assignable: PersonView[];
  totals: { byUser: Tally['byUser']; unassigned: number };
  notes: string;
}

/** BR-14: active, and an Admin, Member or Feeder (never the built-in Guest). */
export function isAssignable(user: Pick<UserRow, 'is_active' | 'role'>): boolean {
  return user.is_active === 1 && (ASSIGNABLE_ROLES as readonly string[]).includes(user.role);
}

export function userNameOf(users: ReadonlyMap<string, UserRow>, id: string | null): string {
  return (id === null ? undefined : users.get(id)?.name) ?? 'someone';
}

export async function loadUsers(db: Db): Promise<Map<string, UserRow>> {
  return new Map((await listUsers(db, { includeInactive: true })).map((user) => [user.id, user]));
}

export function toAssignmentView(
  row: FeedingAssignmentRow,
  users: ReadonlyMap<string, UserRow>,
): AssignmentView {
  return {
    id: row.id,
    userId: row.user_id,
    userName: userNameOf(users, row.user_id),
    note: row.note,
    createdAt: row.created_at,
    createdByName: userNameOf(users, row.created_by),
  };
}

/** The days `from … to` (inclusive, `dates` in order) with their current assignment and events. */
async function loadDays(
  db: Db,
  dates: readonly string[],
  users: ReadonlyMap<string, UserRow>,
): Promise<FeedingDayView[]> {
  const first = dates[0] ?? '';
  const last = dates[dates.length - 1] ?? '';
  const [assignments, events, seriesRows] = await Promise.all([
    listCurrentAssignments(db, first, last),
    listEventsInRange(db, first, last),
    listSeriesDatesFrom(db, first, last),
  ]);
  const assignmentByDate = new Map(assignments.map((row) => [row.date, row]));
  const eventsByDate = new Map<string, ScheduleEventRow[]>();
  for (const event of events) {
    eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]);
  }
  const following = (event: ScheduleEventRow): number =>
    event.series_id === null
      ? 1
      : seriesRows.filter((row) => row.series_id === event.series_id && row.date >= event.date)
          .length;
  return dates.map((date) => {
    const assignment = assignmentByDate.get(date);
    return {
      date,
      weekday: weekdayName(date),
      assignment: assignment === undefined ? null : toAssignmentView(assignment, users),
      events: (eventsByDate.get(date) ?? []).map((event) => ({
        id: event.id,
        seriesId: event.series_id,
        title: event.title,
        note: event.note,
        followingCount: following(event),
      })),
    };
  });
}

/** One day as `GET /api/feeding` shows it. */
export async function dayState(db: Db, date: string): Promise<FeedingDayView> {
  const users = await loadUsers(db);
  const [day] = await loadDays(db, [date], users);
  return day as FeedingDayView;
}

export async function loadMonth(db: Db, month: string, today: string): Promise<MonthView> {
  const users = await loadUsers(db);
  const days = await loadDays(db, monthDates(month), users);
  const assignable = [...users.values()]
    .filter(isAssignable)
    .map((user) => ({ id: user.id, name: user.name, role: user.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const totals = tally(
    days.map((day) => ({
      date: day.date,
      person:
        day.assignment === null
          ? null
          : { id: day.assignment.userId, name: day.assignment.userName },
    })),
  );
  return {
    month,
    today,
    days,
    assignable,
    totals,
    notes: (await getSetting(db, 'feeding_schedule_notes')) ?? '',
  };
}

/** The changed-by wording of a 409: who and when, in the lab's time zone. */
export function describeChange(
  users: ReadonlyMap<string, UserRow>,
  userId: string | null,
  at: string | null,
  fallbackAt: string,
): { changedBy: string; changedAt: string } {
  return { changedBy: userNameOf(users, userId), changedAt: displayTimestamp(at ?? fallbackAt) };
}
