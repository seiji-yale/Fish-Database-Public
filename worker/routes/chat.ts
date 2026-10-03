import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { newId, nowIso } from '../db/ids';
import { ACTIVITIES } from '../db/queries/activities';
import { CHAT_MESSAGES } from '../db/queries/chatMessages';
import {
  insertChatMentionStatement,
  softDeleteChatMentionsStatement,
} from '../db/queries/chatMentions';
import { insertStatement } from '../db/queries/shared';
import { actingUser, requireAuthor } from '../lib/attribution';
import { ApiError } from '../lib/errors';
import { messages } from '../lib/messages';
import { resolveChatMentions } from '../lib/chatMentions';
import type { ActivityRow, ChatMessageRow, ChatReadRow } from '../db/types';
import type { Bindings } from '../middleware/session';

export const chatRoutes = new Hono<{ Bindings: Bindings }>();

const PAGE_SIZE = 30;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const messageInput = z.object({
  body: z.string().trim().min(1).max(4000),
  requestType: z.string().trim().min(1).max(120).nullable().optional(),
  chosenUserId: z.string().min(1).nullable().optional(),
});

interface ChatMessageView extends ChatMessageRow {
  author_name: string;
  reads: { userId: string; userName: string; readAt: string }[];
  mentions: { userId: string; userName: string }[];
  readByMe: boolean;
}

function cursor(createdAt: string, id: string): string {
  return `${createdAt}::${id}`;
}

function parseCursor(value: string | undefined): { createdAt: string; id: string } | null {
  if (value === undefined) return null;
  const separator = value.lastIndexOf('::');
  if (separator < 1 || separator === value.length - 2) return null;
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 2);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt))
    return null;
  return { createdAt, id };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body !== null && typeof body === 'object' && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
}

async function validateRequestType(db: Bindings['DB'], value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const row = await db
    .prepare(
      "SELECT value FROM enumerations WHERE kind = 'request_type' AND value = ? AND is_active = 1",
    )
    .bind(value)
    .first<{ value: string }>();
  if (row === null) throw new ApiError(400, 'INVALID_INPUT', messages.chatRequestType);
  return row.value;
}

async function messageById(db: Bindings['DB'], id: string): Promise<ChatMessageRow> {
  const row = await db
    .prepare('SELECT * FROM chat_messages WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<ChatMessageRow>();
  if (row === null) throw new ApiError(404, 'MESSAGE_NOT_FOUND', messages.messageNotFound);
  return row;
}

async function lineExists(db: Bindings['DB'], lineId: string) {
  const row = await db
    .prepare('SELECT id FROM lines WHERE id = ?')
    .bind(lineId)
    .first<{ id: string }>();
  if (row === null) throw new ApiError(404, 'LINE_NOT_FOUND', messages.lineNotFound);
}

async function listMessages(
  db: Bindings['DB'],
  lineId: string | null,
  before: { createdAt: string; id: string } | null,
  viewerId: string,
) {
  const scope = lineId === null ? 'm.line_id IS NULL' : 'm.line_id = ?';
  const cursorSql =
    before === null ? '' : 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))';
  const statement = db.prepare(
    `SELECT m.*, u.name AS author_name
     FROM chat_messages m JOIN users u ON u.id = m.user_id
     WHERE ${scope} ${cursorSql}
     ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
  );
  const args: (string | number)[] = [];
  if (lineId !== null) args.push(lineId);
  if (before !== null) args.push(before.createdAt, before.createdAt, before.id);
  args.push(PAGE_SIZE + 1);
  const { results } = await statement.bind(...args).all<ChatMessageView>();
  const hasMore = results.length > PAGE_SIZE;
  const pageNewestFirst = results.slice(0, PAGE_SIZE);
  const ids = pageNewestFirst.map((row) => row.id);
  const readsByMessage = new Map<string, ChatMessageView['reads']>();
  const mentionsByMessage = new Map<string, ChatMessageView['mentions']>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ');
    const [reads, mentions] = await Promise.all([
      db
        .prepare(
          `SELECT r.message_id, r.user_id, r.read_at, u.name AS user_name
         FROM chat_read_state r JOIN users u ON u.id = r.user_id
         WHERE r.message_id IN (${placeholders}) AND r.deleted_at IS NULL ORDER BY r.read_at, u.name`,
        )
        .bind(...ids)
        .all<ChatReadRow & { user_name: string }>(),
      db
        .prepare(
          `SELECT cm.message_id, cm.user_id, u.name AS user_name
         FROM chat_mentions cm JOIN users u ON u.id = cm.user_id
         WHERE cm.message_id IN (${placeholders}) AND cm.deleted_at IS NULL
         ORDER BY u.name`,
        )
        .bind(...ids)
        .all<{ message_id: string; user_id: string; user_name: string }>(),
    ]);
    for (const read of reads.results) {
      const list = readsByMessage.get(read.message_id) ?? [];
      list.push({ userId: read.user_id, userName: read.user_name, readAt: read.read_at });
      readsByMessage.set(read.message_id, list);
    }
    for (const mention of mentions.results) {
      const list = mentionsByMessage.get(mention.message_id) ?? [];
      list.push({ userId: mention.user_id, userName: mention.user_name });
      mentionsByMessage.set(mention.message_id, list);
    }
  }
  const items = pageNewestFirst.reverse().map((row) => ({
    ...row,
    body: row.deleted_at === null ? row.body : messages.chatMessageRequired,
    reads: readsByMessage.get(row.id) ?? [],
    mentions: mentionsByMessage.get(row.id) ?? [],
    readByMe: (readsByMessage.get(row.id) ?? []).some((read) => read.userId === viewerId),
  }));
  const oldest = items[0];
  const openRequestFilter = lineId === null ? 'line_id IS NULL' : 'line_id = ?';
  const [requestTypes, openRequestCount] = await Promise.all([
    db
      .prepare(
        "SELECT value FROM enumerations WHERE kind = 'request_type' AND is_active = 1 ORDER BY sort_order, value",
      )
      .all<{ value: string }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM chat_messages WHERE ${openRequestFilter} AND deleted_at IS NULL AND request_status = 'open'`,
      )
      .bind(...(lineId === null ? [] : [lineId]))
      .first<{ count: number }>(),
  ]);
  const openRequestRows = await db
    .prepare(
      `SELECT m.id, m.body, m.request_type AS requestType, m.user_id AS userId,
        u.name AS authorName, m.created_at AS createdAt
      FROM chat_messages m JOIN users u ON u.id = m.user_id
      WHERE ${lineId === null ? 'm.line_id IS NULL' : 'm.line_id = ?'}
        AND m.deleted_at IS NULL AND m.request_status = 'open'
      ORDER BY m.created_at, m.id`,
    )
    .bind(...(lineId === null ? [] : [lineId]))
    .all<{
      id: string;
      body: string;
      requestType: string;
      userId: string;
      authorName: string;
      createdAt: string;
    }>();
  return {
    items,
    nextBefore: hasMore && oldest !== undefined ? cursor(oldest.created_at, oldest.id) : null,
    openRequestCount: openRequestCount?.count ?? 0,
    openRequests: openRequestRows.results,
    requestTypes,
  };
}

function makeActivity(
  db: Bindings['DB'],
  message: ChatMessageRow,
  author: { id: string; viaAdmin: boolean },
  type: ActivityRow['type'],
  summary: string,
  now: string,
) {
  const activity: ActivityRow = {
    id: newId(),
    line_id: message.line_id,
    user_id: author.id,
    via_admin: author.viaAdmin ? 1 : 0,
    type,
    summary,
    ref_type: 'chat_message',
    ref_id: message.id,
    created_at: now,
  };
  return insertStatement(db, ACTIVITIES, activity);
}

function canStillEdit(message: ChatMessageRow, now: string): boolean {
  const age = Date.parse(now) - Date.parse(message.created_at);
  return Number.isFinite(age) && age >= 0 && age <= EDIT_WINDOW_MS;
}

const beforeQuery = z.string().max(512).optional();

chatRoutes.get('/lines/:id/messages', async (c) => {
  const beforeValue = beforeQuery.safeParse(c.req.query('before'));
  if (!beforeValue.success) throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  const before = parseCursor(beforeValue.data);
  if (beforeValue.data !== undefined && before === null)
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  const lineId = c.req.param('id');
  await lineExists(c.env.DB, lineId);
  const viewer = await actingUser(c);
  return c.json(await listMessages(c.env.DB, lineId, before, viewer.id));
});

chatRoutes.get('/messages', async (c) => {
  const beforeValue = beforeQuery.safeParse(c.req.query('before'));
  if (!beforeValue.success) throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  const before = parseCursor(beforeValue.data);
  if (beforeValue.data !== undefined && before === null)
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  const viewer = await actingUser(c);
  return c.json(await listMessages(c.env.DB, null, before, viewer.id));
});

async function postMessage(c: Context<{ Bindings: Bindings }>, lineId: string | null) {
  const raw = await readJson(c.req.raw);
  const parsed = messageInput.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', messages.chatInvalidMessage);
  if (lineId !== null) await lineExists(c.env.DB, lineId);
  const requestType = await validateRequestType(c.env.DB, parsed.data.requestType);
  const author = await requireAuthor(c, 'chat');
  const now = nowIso();
  const message: ChatMessageRow = {
    id: newId(),
    line_id: lineId,
    user_id: author.authorId,
    via_admin: author.viaAdmin ? 1 : 0,
    body: parsed.data.body,
    request_type: requestType,
    request_status: requestType === null ? null : 'open',
    request_done_by: null,
    request_done_at: null,
    edited_at: null,
    deleted_at: null,
    created_at: now,
  };
  const activeUsers = await c.env.DB.prepare(
    'SELECT id, name, is_active FROM users WHERE is_active = 1',
  ).all<{ id: string; name: string; is_active: number }>();
  const mentionedUsers = resolveChatMentions(message.body, activeUsers.results, message.user_id);
  const summary =
    requestType === null
      ? `Chat: ${message.body.slice(0, 100)}`
      : `Request opened: ${requestType} — ${message.body.slice(0, 100)}`;
  await c.env.DB.batch([
    insertStatement(c.env.DB, CHAT_MESSAGES, message),
    makeActivity(
      c.env.DB,
      message,
      { id: author.authorId, viaAdmin: author.viaAdmin },
      requestType === null ? 'chat_posted' : 'request_opened',
      summary,
      now,
    ),
    ...mentionedUsers.map((user) =>
      insertChatMentionStatement(c.env.DB, {
        id: newId(),
        message_id: message.id,
        user_id: user.id,
        created_at: now,
        deleted_at: null,
      }),
    ),
  ]);
  return c.json({ id: message.id, createdAt: now }, 201);
}

chatRoutes.post('/lines/:id/messages', (c) => postMessage(c, c.req.param('id')));
chatRoutes.post('/messages', (c) => postMessage(c, null));

chatRoutes.patch('/messages/:mid', async (c) => {
  const message = await messageById(c.env.DB, c.req.param('mid'));
  const acting = await actingUser(c);
  if (acting.id !== message.user_id)
    throw new ApiError(403, 'FORBIDDEN', messages.chatEditNotAllowed);
  const now = nowIso();
  if (!canStillEdit(message, now))
    throw new ApiError(403, 'EDIT_WINDOW_EXPIRED', messages.chatEditExpired);
  const raw = await readJson(c.req.raw);
  const parsed = messageInput.pick({ body: true }).safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', messages.chatInvalidMessage);
  const [activeUsers, oldMentions] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, is_active FROM users WHERE is_active = 1').all<{
      id: string;
      name: string;
      is_active: number;
    }>(),
    c.env.DB.prepare(
      'SELECT user_id FROM chat_mentions WHERE message_id = ? AND deleted_at IS NULL',
    )
      .bind(message.id)
      .all<{ user_id: string }>(),
  ]);
  const mentionedUsers = resolveChatMentions(
    parsed.data.body,
    activeUsers.results,
    message.user_id,
  );
  const oldMentionIds = new Set(oldMentions.results.map((mention) => mention.user_id));
  const addedMentionIds = mentionedUsers
    .filter((user) => !oldMentionIds.has(user.id))
    .map((user) => user.id);
  const statements = [
    c.env.DB.prepare(
      'UPDATE chat_messages SET body = ?, edited_at = ? WHERE id = ? AND deleted_at IS NULL',
    ).bind(parsed.data.body, now, message.id),
    softDeleteChatMentionsStatement(c.env.DB, message.id, now),
    ...mentionedUsers.map((user) =>
      insertChatMentionStatement(c.env.DB, {
        id: newId(),
        message_id: message.id,
        user_id: user.id,
        created_at: now,
        deleted_at: null,
      }),
    ),
    ...(addedMentionIds.length === 0
      ? []
      : [
          c.env.DB.prepare(
            `UPDATE chat_read_state SET deleted_at = ?
             WHERE message_id = ? AND user_id IN (${addedMentionIds.map(() => '?').join(', ')})
               AND deleted_at IS NULL`,
          ).bind(now, message.id, ...addedMentionIds),
        ]),
  ];
  await c.env.DB.batch(statements);
  return c.json({ id: message.id, editedAt: now });
});

chatRoutes.delete('/messages/:mid', async (c) => {
  const message = await messageById(c.env.DB, c.req.param('mid'));
  const acting = await actingUser(c);
  if (acting.id !== message.user_id)
    throw new ApiError(403, 'FORBIDDEN', messages.chatEditNotAllowed);
  const now = nowIso();
  if (!canStillEdit(message, now))
    throw new ApiError(403, 'EDIT_WINDOW_EXPIRED', messages.chatEditExpired);
  await c.env.DB.prepare(
    'UPDATE chat_messages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
  )
    .bind(now, message.id)
    .run();
  return c.body(null, 204);
});

chatRoutes.patch('/messages/:mid/request', async (c) => {
  const message = await messageById(c.env.DB, c.req.param('mid'));
  if (message.request_status === null)
    throw new ApiError(400, 'INVALID_INPUT', messages.chatRequestType);
  const raw = await readJson(c.req.raw);
  const parsed = z.object({ status: z.enum(['open', 'done']) }).safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  const nextStatus = parsed.data.status;
  if (message.request_status === nextStatus)
    return c.json({
      id: message.id,
      status: nextStatus,
      doneBy: message.request_done_by,
      doneAt: message.request_done_at,
    });
  const author = await requireAuthor(c, 'chat');
  const actor = await actingUser(c);
  const acting = {
    id: author.authorId,
    name:
      (
        await c.env.DB.prepare('SELECT name FROM users WHERE id = ?')
          .bind(author.authorId)
          .first<{ name: string }>()
      )?.name ?? actor.name,
  };
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE chat_messages SET request_status = ?, request_done_by = ?, request_done_at = ? WHERE id = ?',
    ).bind(
      nextStatus,
      nextStatus === 'done' ? acting.id : null,
      nextStatus === 'done' ? now : null,
      message.id,
    ),
    makeActivity(
      c.env.DB,
      message,
      { id: acting.id, viaAdmin: author.viaAdmin },
      nextStatus === 'done' ? 'request_done' : 'request_opened',
      `${nextStatus === 'done' ? 'Request completed' : 'Request reopened'}: ${message.request_type ?? ''} — ${message.body.slice(0, 100)}`,
      now,
    ),
  ]);
  return c.json({
    id: message.id,
    status: nextStatus,
    doneBy: nextStatus === 'done' ? acting.name : null,
    doneAt: nextStatus === 'done' ? now : null,
  });
});

async function markRead(c: Context<{ Bindings: Bindings }>, remove = false) {
  const message = await messageById(c.env.DB, c.req.param('mid') ?? '');
  const acting = await actingUser(c);
  if (!remove && acting.id === message.user_id)
    throw new ApiError(403, 'OWN_MESSAGE', messages.chatReadOwn);
  if (remove) {
    await c.env.DB.prepare(
      'UPDATE chat_read_state SET deleted_at = ? WHERE message_id = ? AND user_id = ? AND deleted_at IS NULL',
    )
      .bind(nowIso(), message.id, acting.id)
      .run();
  } else {
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO chat_reads (message_id, user_id, read_at) VALUES (?, ?, ?)',
      ).bind(message.id, acting.id, now),
      c.env.DB.prepare(
        `INSERT INTO chat_read_state (message_id, user_id, read_at, deleted_at) VALUES (?, ?, ?, NULL)
        ON CONFLICT(message_id, user_id) DO UPDATE SET
          read_at = CASE WHEN chat_read_state.deleted_at IS NULL THEN chat_read_state.read_at ELSE excluded.read_at END,
          deleted_at = NULL`,
      ).bind(message.id, acting.id, now),
    ]);
  }
  return c.body(null, 204);
}

chatRoutes.post('/messages/:mid/read', (c) => markRead(c));
chatRoutes.delete('/messages/:mid/read', (c) => markRead(c, true));

chatRoutes.get('/messages/unread-count', async (c) => {
  const acting = await actingUser(c);
  const [unread, openRequests] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM chat_messages m
      JOIN chat_mentions cm ON cm.message_id = m.id AND cm.user_id = ? AND cm.deleted_at IS NULL
      LEFT JOIN chat_read_state r ON r.message_id = m.id AND r.user_id = ?
      WHERE m.deleted_at IS NULL AND m.user_id <> ? AND (r.message_id IS NULL OR r.deleted_at IS NOT NULL)`,
    )
      .bind(acting.id, acting.id, acting.id)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM chat_messages WHERE deleted_at IS NULL AND request_status = 'open'",
    ).first<{ count: number }>(),
  ]);
  return c.json({ unread: unread?.count ?? 0, openRequests: openRequests?.count ?? 0 });
});

chatRoutes.post('/messages/read-all', async (c) => {
  const acting = await actingUser(c);
  const unread = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM chat_messages m
     JOIN chat_mentions cm ON cm.message_id = m.id AND cm.user_id = ? AND cm.deleted_at IS NULL
     LEFT JOIN chat_read_state r ON r.message_id = m.id AND r.user_id = ?
     WHERE m.deleted_at IS NULL AND m.user_id <> ?
       AND (r.message_id IS NULL OR r.deleted_at IS NOT NULL)`,
  )
    .bind(acting.id, acting.id, acting.id)
    .first<{ count: number }>();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO chat_read_state (message_id, user_id, read_at, deleted_at)
       SELECT m.id, ?, ?, NULL FROM chat_messages m
       JOIN chat_mentions cm ON cm.message_id = m.id AND cm.user_id = ? AND cm.deleted_at IS NULL
       LEFT JOIN chat_read_state r ON r.message_id = m.id AND r.user_id = ?
       WHERE m.deleted_at IS NULL AND m.user_id <> ?
         AND (r.message_id IS NULL OR r.deleted_at IS NOT NULL)
       ON CONFLICT(message_id, user_id) DO UPDATE SET read_at = excluded.read_at, deleted_at = NULL`,
    ).bind(acting.id, now, acting.id, acting.id, acting.id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO chat_reads (message_id, user_id, read_at)
       SELECT message_id, user_id, read_at FROM chat_read_state
       WHERE user_id = ? AND read_at = ? AND deleted_at IS NULL`,
    ).bind(acting.id, now),
  ]);
  return c.json({ marked: unread?.count ?? 0 });
});
