import type { Db } from '../db';
import type { ChatMessageRow } from '../types';
import {
  assertNotAdminAuthor,
  define,
  getRowById,
  insertRow,
  listRowsBy,
  listRowsByIn,
  softDeleteRow,
  type ListOptions,
} from './shared';

export const CHAT_MESSAGES = define<ChatMessageRow>(
  'chat_messages',
  {
    id: true,
    line_id: true,
    user_id: true,
    via_admin: true,
    body: true,
    request_type: true,
    request_status: true,
    request_done_by: true,
    request_done_at: true,
    edited_at: true,
    deleted_at: true,
    created_at: true,
  },
  true,
);

/** Throws `AdminAuthorError` when `user_id` is the Admin user (BR-5). */
export async function insertChatMessage(db: Db, row: ChatMessageRow): Promise<void> {
  await assertNotAdminAuthor(db, row.user_id, 'A chat message');
  await insertRow(db, CHAT_MESSAGES, row);
}

export function getChatMessageById(db: Db, id: string): Promise<ChatMessageRow | null> {
  return getRowById(db, CHAT_MESSAGES, id);
}

export function listChatMessagesByLine(
  db: Db,
  lineId: string,
  options?: ListOptions,
): Promise<ChatMessageRow[]> {
  return listRowsBy(db, CHAT_MESSAGES, 'line_id', lineId, 'created_at, id', options);
}

/** Batch load for list views: one query for every line on the page, grouped by caller. */
export function listChatMessagesByLines(
  db: Db,
  lineIds: readonly string[],
): Promise<ChatMessageRow[]> {
  return listRowsByIn(db, CHAT_MESSAGES, 'line_id', lineIds, 'line_id, created_at, id');
}

/** Lab-wide chat (`line_id IS NULL`), oldest first. */
export async function listLabChatMessages(
  db: Db,
  options?: ListOptions,
): Promise<ChatMessageRow[]> {
  const filter = options?.includeDeleted === true ? '1 = 1' : 'deleted_at IS NULL';
  const { results } = await db
    .prepare(
      `SELECT * FROM chat_messages WHERE line_id IS NULL AND ${filter} ORDER BY created_at, id`,
    )
    .all<ChatMessageRow>();
  return results;
}

export function softDeleteChatMessage(db: Db, id: string, now: string): Promise<boolean> {
  return softDeleteRow(db, CHAT_MESSAGES, id, now);
}
