/**
 * Feeding Schedule writes (T-033, BR-13, BR-14, BR-17, BR-19). Every write is one `db.batch` (one
 * transaction): a day is changed by closing its current row and inserting the new one; a failed insert
 * (the partial unique index of two concurrent saves) rolls the close back too.
 */
import {
  addDays,
  feedingMessages,
  monthBounds,
  monthDates,
  repeatWeekPlan,
  type EventScope,
  type RepeatWeekInput,
  type RepeatWeekPlan,
} from '../../domain/feeding';
import type { Db } from '../db/db';
import {
  closeAssignmentStatement,
  FEEDING_ASSIGNMENTS,
  getCurrentAssignment,
  insertAssignmentStatement,
  listCurrentAssignments,
} from '../db/queries/feedingAssignments';
import {
  getLiveEvent,
  insertEventStatement,
  listSeriesFrom,
  softDeleteEventStatement,
  updateEventStatement,
} from '../db/queries/scheduleEvents';
import { getRowById } from '../db/queries/shared';
import { newId, nowIso } from '../db/ids';
import type { FeedingAssignmentRow, ScheduleEventRow } from '../db/types';
import { ApiError } from './errors';
import { describeChange, isAssignable, loadUsers } from './feedingRead';
import { messages } from './messages';
import { getUserById } from '../db/queries/users';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE/i.test(error.message);
}

async function assertAssignable(db: Db, userId: string): Promise<void> {
  const user = await getUserById(db, userId);
  if (user === null || !isAssignable(user))
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, {
      fields: { userId: messages.feedingUserNotAssignable },
    });
}

/** The 409 of BR-17: who changed the day, and when. */
async function dayChanged(
  db: Db,
  date: string,
  expectedAssignmentId: string | null,
  now: string,
): Promise<ApiError> {
  const users = await loadUsers(db);
  const current = await getCurrentAssignment(db, date);
  let who: string | null = current?.created_by ?? null;
  let at: string | null = current?.created_at ?? null;
  if (current === null && expectedAssignmentId !== null) {
    const cleared = await getRowById(db, FEEDING_ASSIGNMENTS, expectedAssignmentId);
    who = cleared?.replaced_by ?? null;
    at = cleared?.replaced_at ?? null;
  }
  const { changedBy, changedAt } = describeChange(users, who, at, now);
  return new ApiError(409, 'DAY_CHANGED', messages.dayChanged(changedBy, changedAt), undefined, {
    changedBy,
    changedAt,
  });
}

export interface SetDayInput {
  date: string;
  userId: string | null;
  note: string | null;
  expectedAssignmentId: string | null;
  authorId: string;
  now?: string;
}

/**
 * Sets (or, with `userId` null, clears) one day. Refused with 400 for an unassignable person (BR-14) and
 * 409 `DAY_CHANGED` when the day is no longer the one the person opened (BR-17). Saving the value the day
 * already has changes nothing and writes no row.
 */
export async function setDay(db: Db, input: SetDayInput): Promise<void> {
  const now = input.now ?? nowIso();
  if (input.userId !== null) await assertAssignable(db, input.userId);
  const current = await getCurrentAssignment(db, input.date);
  if ((current?.id ?? null) !== input.expectedAssignmentId)
    throw await dayChanged(db, input.date, input.expectedAssignmentId, now);
  if (current === null && input.userId === null) return;
  if (current !== null && current.user_id === input.userId && current.note === input.note) return;

  const statements = [];
  if (current !== null)
    statements.push(closeAssignmentStatement(db, current.id, now, input.authorId));
  if (input.userId !== null)
    statements.push(
      insertAssignmentStatement(db, {
        id: newId(),
        date: input.date,
        user_id: input.userId,
        note: input.note,
        imported_from: null,
        created_at: now,
        created_by: input.authorId,
        replaced_at: null,
        replaced_by: null,
      }),
    );
  try {
    const results = (await db.batch(statements)) as { meta: { changes: number } }[];
    // A clear whose close changed nothing means someone else replaced the row a moment ago: nothing was written.
    if (current !== null && results[0]?.meta.changes === 0)
      throw await dayChanged(db, input.date, input.expectedAssignmentId, now);
  } catch (error) {
    if (isUniqueViolation(error))
      throw await dayChanged(db, input.date, input.expectedAssignmentId, now);
    throw error;
  }
}

export interface RepeatWeekResult {
  filled: number;
  kept: number;
  replaced: number;
}

/**
 * Copies a week's feeders onto the rest of the month as ordinary replacements (FR-FEED-15). People who
 * can no longer be assigned (BR-14) are treated as "no feeder" in the source week. `dryRun` only counts.
 */
export async function repeatWeek(
  db: Db,
  input: RepeatWeekInput,
  authorId: string,
  now: string = nowIso(),
): Promise<RepeatWeekResult> {
  const users = await loadUsers(db);
  const weekEnd = addDays(input.weekStart, 6);
  const { first, last } = monthBounds(input.month);
  const source = await listCurrentAssignments(db, input.weekStart, weekEnd);
  const sourceByDate = new Map(source.map((row) => [row.date, row]));
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(input.weekStart, index);
    const user = users.get(sourceByDate.get(date)?.user_id ?? '');
    return { date, userId: user !== undefined && isAssignable(user) ? user.id : null };
  });
  const currentRows = await listCurrentAssignments(db, first, last);
  const currentByDate = new Map(currentRows.map((row) => [row.date, row]));
  const monthDays = monthDates(input.month).map((date) => ({
    date,
    userId: currentByDate.get(date)?.user_id ?? null,
  }));
  const plan: RepeatWeekPlan = repeatWeekPlan(weekDays, monthDays, input.overwrite);
  const result = { filled: plan.filled, kept: plan.kept, replaced: plan.replaced };
  if (input.dryRun || plan.writes.length === 0) return result;

  const statements = plan.writes.flatMap((write) => {
    const previous = currentByDate.get(write.date);
    const row: FeedingAssignmentRow = {
      id: newId(),
      date: write.date,
      user_id: write.userId,
      note: null,
      imported_from: null,
      created_at: now,
      created_by: authorId,
      replaced_at: null,
      replaced_by: null,
    };
    return previous === undefined
      ? [insertAssignmentStatement(db, row)]
      : [
          closeAssignmentStatement(db, previous.id, now, authorId),
          insertAssignmentStatement(db, row),
        ];
  });
  try {
    await db.batch(statements);
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ApiError(409, 'DAY_CHANGED', messages.dayChanged('someone', 'just now'));
    throw error;
  }
  return result;
}

export interface NewEvent {
  title: string;
  note: string | null;
  /** The dates to write: one for a one-off, the weekly dates of a repeat. */
  dates: readonly string[];
  /** True when `dates` is a series (BR-19): the rows share one new series id. */
  series: boolean;
  authorId: string;
  now?: string;
}

/** Inserts the event rows in one batch. */
export async function createEvents(db: Db, input: NewEvent): Promise<void> {
  const now = input.now ?? nowIso();
  const seriesId = input.series ? newId() : null;
  await db.batch(
    input.dates.map((date) => {
      const row: ScheduleEventRow = {
        id: newId(),
        date,
        series_id: seriesId,
        title: input.title,
        note: input.note,
        created_at: now,
        created_by: input.authorId,
        updated_at: now,
        updated_by: input.authorId,
        deleted_at: null,
        deleted_by: null,
      };
      return insertEventStatement(db, row);
    }),
  );
}

async function eventsInScope(db: Db, id: string, scope: EventScope): Promise<ScheduleEventRow[]> {
  const event = await getLiveEvent(db, id);
  if (event === null) throw new ApiError(404, 'EVENT_NOT_FOUND', messages.scheduleEventNotFound);
  if (scope === 'this') return [event];
  if (event.series_id === null)
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, {
      fields: { scope: feedingMessages.scopeNeedsSeries },
    });
  return listSeriesFrom(db, event.series_id, event.date);
}

/** Edits title and/or note of this event, or of this and every later one of its series. */
export async function editEvents(
  db: Db,
  id: string,
  change: { title?: string; note?: string | null; scope: EventScope },
  authorId: string,
  now: string = nowIso(),
): Promise<number> {
  const rows = await eventsInScope(db, id, change.scope);
  await db.batch(
    rows.map((row) =>
      updateEventStatement(db, row.id, {
        title: change.title ?? row.title,
        note: change.note === undefined ? row.note : change.note,
        updatedAt: now,
        updatedBy: authorId,
      }),
    ),
  );
  return rows.length;
}

/** Soft-deletes this event, or this and every later one of its series (BR-19). */
export async function deleteEvents(
  db: Db,
  id: string,
  scope: EventScope,
  authorId: string,
  now: string = nowIso(),
): Promise<number> {
  const rows = await eventsInScope(db, id, scope);
  await db.batch(rows.map((row) => softDeleteEventStatement(db, row.id, now, authorId)));
  return rows.length;
}
