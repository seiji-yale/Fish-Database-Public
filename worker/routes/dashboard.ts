import { Hono } from 'hono';
import { z } from 'zod';
import { getSetting } from '../db/queries/settings';
import { listCryoRecordsByLines } from '../db/queries/cryoRecords';
import { listCurrentIdProtocols } from '../db/queries/idProtocols';
import { listLines } from '../db/queries/lines';
import { actingUser } from '../lib/attribution';
import { ApiError } from '../lib/errors';
import { messages } from '../lib/messages';
import type { ActivityRow } from '../db/types';
import { buildDashboardLists } from '../lib/dashboard';
import type { Bindings } from '../middleware/session';

const ACTIVITY_PREVIEW_SIZE = 10;
const ACTIVITY_PAGE_SIZE = 20;
const DEFAULT_THRESHOLD_MONTHS = 11;

interface DashboardActivity {
  id: string;
  lineId: string | null;
  lineName: string | null;
  userName: string;
  type: ActivityRow['type'];
  summary: string;
  createdAt: string;
}

interface ActivityCursor {
  createdAt: string;
  id: string;
}

function cursorFor(item: Pick<DashboardActivity, 'createdAt' | 'id'>): string {
  return `${item.createdAt}::${item.id}`;
}

function parseCursor(value: string | undefined): ActivityCursor | null {
  if (value === undefined) return null;
  const separator = value.lastIndexOf('::');
  if (separator < 1 || separator === value.length - 2) return null;
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 2);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt))
    return null;
  return { createdAt, id };
}

/**
 * Recent Activity is about the lines' data: created/imported, edits, breeding, genotyping, close and
 * reopen, ID methods, cryo, references, restores. Chat, requests, user and settings events stay out
 * (owner decision 2026-09-30).
 */
const LINE_ACTIVITY_TYPES = [
  'created',
  'imported',
  'edited',
  'breeding_started',
  'genotyping_same_gen',
  'genotyping_new_gen',
  'closed',
  'reopened',
  'protocol_changed',
  'cryo_changed',
  'reference_changed',
  'restored',
] as const;
const TYPE_FILTER = `a.type IN (${LINE_ACTIVITY_TYPES.map((type) => `'${type}'`).join(', ')})`;

async function listActivityPage(
  db: Bindings['DB'],
  before: ActivityCursor | null,
  limit = ACTIVITY_PAGE_SIZE,
): Promise<{ items: DashboardActivity[]; nextBefore: string | null }> {
  const cursorWhere =
    before === null ? '' : 'AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))';
  const statement = db.prepare(
    `SELECT a.id, a.line_id AS lineId, l.name AS lineName, u.name AS userName,
      a.type, a.summary, a.created_at AS createdAt
     FROM activities a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN lines l ON l.id = a.line_id
     WHERE ${TYPE_FILTER} ${cursorWhere}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ?`,
  );
  const query =
    before === null
      ? statement.bind(limit + 1)
      : statement.bind(before.createdAt, before.createdAt, before.id, limit + 1);
  const { results } = await query.all<DashboardActivity>();
  const items = results.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextBefore: results.length > limit && last !== undefined ? cursorFor(last) : null,
  };
}

function labToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values['year'] ?? ''}-${values['month'] ?? ''}-${values['day'] ?? ''}`;
}

function thresholdFromSetting(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_MONTHS;
}

export const dashboardRoutes = new Hono<{ Bindings: Bindings }>();

dashboardRoutes.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const [lines, thresholdRaw, acting] = await Promise.all([
    listLines(db),
    getSetting(db, 'upcoming_breeding_months'),
    actingUser(c),
  ]);
  const lineIds = lines.map((line) => line.id);
  const protocolIds = [
    ...new Set(
      lines.map((line) => line.current_protocol_id).filter((id): id is string => id !== null),
    ),
  ];
  const [
    protocols,
    cryoRecords,
    unreadRow,
    unreadMessageRows,
    openRequestRow,
    openRequests,
    activityPage,
  ] = await Promise.all([
    listCurrentIdProtocols(db, protocolIds),
    listCryoRecordsByLines(db, lineIds),
    db
      .prepare(
        `SELECT COUNT(*) AS count
       FROM chat_messages m
       JOIN chat_mentions cm ON cm.message_id = m.id AND cm.user_id = ? AND cm.deleted_at IS NULL
       LEFT JOIN chat_read_state r ON r.message_id = m.id AND r.user_id = ?
        WHERE m.deleted_at IS NULL AND m.user_id <> ? AND (r.message_id IS NULL OR r.deleted_at IS NOT NULL)`,
      )
      .bind(acting.id, acting.id, acting.id)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT m.id, m.line_id AS lineId, l.name AS lineName, m.body,
            u.name AS authorName, m.created_at AS createdAt
           FROM chat_messages m
           JOIN chat_mentions cm ON cm.message_id = m.id AND cm.user_id = ? AND cm.deleted_at IS NULL
           LEFT JOIN chat_read_state r ON r.message_id = m.id AND r.user_id = ?
           LEFT JOIN lines l ON l.id = m.line_id
           JOIN users u ON u.id = m.user_id
           WHERE m.deleted_at IS NULL AND m.user_id <> ?
             AND (r.message_id IS NULL OR r.deleted_at IS NOT NULL)
           ORDER BY m.created_at DESC, m.id DESC`,
      )
      .bind(acting.id, acting.id, acting.id)
      .all<{
        id: string;
        lineId: string | null;
        lineName: string | null;
        body: string;
        authorName: string;
        createdAt: string;
      }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM chat_messages WHERE deleted_at IS NULL AND request_status = 'open'",
      )
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT m.id, m.line_id AS lineId, l.name AS lineName, m.body,
          m.request_type AS requestType, m.user_id AS userId, u.name AS authorName,
          m.created_at AS createdAt
         FROM chat_messages m
         LEFT JOIN lines l ON l.id = m.line_id
         JOIN users u ON u.id = m.user_id
         WHERE m.deleted_at IS NULL AND m.request_status = 'open'
         ORDER BY m.created_at DESC, m.id DESC`,
      )
      .all<{
        id: string;
        lineId: string | null;
        lineName: string | null;
        body: string;
        requestType: string;
        userId: string;
        authorName: string;
        createdAt: string;
      }>(),
    listActivityPage(db, null, ACTIVITY_PREVIEW_SIZE),
  ]);
  const today = labToday();
  const thresholdMonths = thresholdFromSetting(thresholdRaw);
  const lists = buildDashboardLists({ lines, protocols, cryoRecords, thresholdMonths, today });

  return c.json({
    today,
    thresholdMonths,
    counters: {
      ...lists.counters,
      unreadMessages: unreadRow?.count ?? 0,
      openRequests: openRequestRow?.count ?? 0,
    },
    upcoming: lists.upcoming,
    currentlyBreeding: lists.currentlyBreeding,
    missingDob: lists.missingDob,
    openRequests: openRequests.results,
    unreadMessages: unreadMessageRows.results,
    recentActivity: activityPage,
  });
});

const activityQuery = z.object({
  before: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(ACTIVITY_PAGE_SIZE),
});

dashboardRoutes.get('/activities', async (c) => {
  const parsed = activityQuery.safeParse(c.req.query());
  const before = parsed.success ? parseCursor(parsed.data.before) : null;
  if (!parsed.success || (parsed.data.before !== undefined && before === null))
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  return c.json(await listActivityPage(c.env.DB, before, parsed.data.limit));
});
