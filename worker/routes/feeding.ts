/**
 * Feeding Schedule API (T-033, docs/08 §8): the month read model, a day's history, setting a day, the
 * repeat-week helper and schedule events. Reads need `feeding.read`, writes `feeding.write` (BR-15); the
 * signed-in person is the author of every write (BR-5). `GET /api/feeding/summary.csv` arrives with T-035.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  feedingMessages,
  isFeedingDate,
  repeatEventDates,
  summaryCsvRows,
  validateDayWrite,
  validateEventEdit,
  validateEventScope,
  validateEventWrite,
  validateMonth,
  validateRepeatWeek,
} from '../../domain/feeding';
import { labToday } from '../../domain/dates';
import type { ActingUser } from '../../domain/types';
import { csvFile } from '../export/csv';
import { listAssignmentHistory } from '../db/queries/feedingAssignments';
import { ApiError } from '../lib/errors';
import { dayState, loadMonth, loadUsers, userNameOf } from '../lib/feedingRead';
import { createEvents, deleteEvents, editEvents, repeatWeek, setDay } from '../lib/feedingWrite';
import { messages } from '../lib/messages';
import { requireCapability } from '../lib/permissions';
import type { Bindings } from '../middleware/session';

export const feedingRoutes = new Hono<{ Bindings: Bindings }>();

type Ctx = Context<{ Bindings: Bindings }>;

function invalid(fields: Record<string, string>): ApiError {
  return new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, { fields });
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw invalid({ form: messages.invalidInput });
  }
}

const requireWriter = (c: Ctx): Promise<ActingUser> => requireCapability(c, 'feeding.write');

function dateParam(c: Ctx): string {
  const date = c.req.param('date') ?? '';
  if (!isFeedingDate(date)) throw invalid({ date: feedingMessages.dateInvalid });
  return date;
}

feedingRoutes.get('/feeding', async (c) => {
  await requireCapability(c, 'feeding.read');
  const today = labToday();
  const requested = c.req.query('month') ?? today.slice(0, 7);
  const month = validateMonth(requested);
  if (!month.ok) throw invalid({ month: month.message });
  return c.json(await loadMonth(c.env.DB, month.month, today));
});

/** FR-FEED-17: the month as one CSV (day rows, then totals), from the same numbers as the page (BR-16). */
feedingRoutes.get('/feeding/summary.csv', async (c) => {
  await requireCapability(c, 'feeding.export');
  const month = validateMonth(c.req.query('month'));
  if (!month.ok) throw invalid({ month: month.message });
  const view = await loadMonth(c.env.DB, month.month, labToday());
  const [header, ...rows] = summaryCsvRows(
    view.days.map((day) => ({
      date: day.date,
      person:
        day.assignment === null
          ? null
          : { id: day.assignment.userId, name: day.assignment.userName },
      note: day.assignment?.note ?? null,
      events: day.events.map((event) => event.title),
    })),
  );
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="feeding-schedule_${month.month}.csv"`);
  return c.body(csvFile(header ?? [], rows));
});

feedingRoutes.get('/feeding/days/:date/history', async (c) => {
  await requireCapability(c, 'feeding.read');
  const date = dateParam(c);
  const users = await loadUsers(c.env.DB);
  const rows = await listAssignmentHistory(c.env.DB, date);
  return c.json(
    rows.map((row) => ({
      id: row.id,
      userName: userNameOf(users, row.user_id),
      note: row.note,
      createdAt: row.created_at,
      createdByName: userNameOf(users, row.created_by),
      replacedAt: row.replaced_at,
      replacedByName: row.replaced_at === null ? null : userNameOf(users, row.replaced_by),
    })),
  );
});

feedingRoutes.put('/feeding/days/:date', async (c) => {
  const acting = await requireWriter(c);
  const date = dateParam(c);
  const parsed = validateDayWrite(await readBody(c.req.raw));
  if (!parsed.ok) throw invalid(parsed.errors);
  await setDay(c.env.DB, { date, ...parsed.value, authorId: acting.id });
  return c.json(await dayState(c.env.DB, date));
});

feedingRoutes.post('/feeding/repeat-week', async (c) => {
  const acting = await requireWriter(c);
  const parsed = validateRepeatWeek(await readBody(c.req.raw));
  if (!parsed.ok) throw invalid(parsed.errors);
  return c.json(await repeatWeek(c.env.DB, parsed.value, acting.id));
});

feedingRoutes.post('/feeding/events', async (c) => {
  const acting = await requireWriter(c);
  const parsed = validateEventWrite(await readBody(c.req.raw));
  if (!parsed.ok) throw invalid(parsed.errors);
  const { date, title, note, repeatUntil, dryRun } = parsed.value;
  let dates = [date];
  if (repeatUntil !== null) {
    const plan = repeatEventDates(date, repeatUntil);
    if (!plan.ok) throw invalid({ repeatUntil: plan.message });
    dates = plan.dates;
  }
  if (!dryRun)
    await createEvents(c.env.DB, {
      title,
      note,
      dates,
      series: repeatUntil !== null,
      authorId: acting.id,
    });
  return c.json({ count: dates.length, dates });
});

feedingRoutes.patch('/feeding/events/:id', async (c) => {
  const acting = await requireWriter(c);
  const parsed = validateEventEdit(await readBody(c.req.raw));
  if (!parsed.ok) throw invalid(parsed.errors);
  const updated = await editEvents(c.env.DB, c.req.param('id'), parsed.value, acting.id);
  return c.json({ updated });
});

feedingRoutes.delete('/feeding/events/:id', async (c) => {
  const acting = await requireWriter(c);
  const scope = validateEventScope(c.req.query('scope'));
  if (scope === null) throw invalid({ scope: feedingMessages.scopeInvalid });
  const deleted = await deleteEvents(c.env.DB, c.req.param('id'), scope, acting.id);
  return c.json({ deleted });
});
