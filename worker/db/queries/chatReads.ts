import type { Db } from '../db';
import type { ChatReadRow, ChatReadStateRow } from '../types';
import { define } from './shared';

export const CHAT_READS = define<ChatReadRow>('chat_reads', {
  message_id: true,
  user_id: true,
  read_at: true,
});

export const CHAT_READ_STATE = define<ChatReadStateRow>(
  'chat_read_state',
  { message_id: true, user_id: true, read_at: true, deleted_at: true },
  true,
);

/** Records that `userId` has read the message; a second call keeps the first read time. */
export async function markMessageRead(
  db: Db,
  messageId: string,
  userId: string,
  readAt: string,
): Promise<void> {
  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO chat_reads (message_id, user_id, read_at) VALUES (?, ?, ?)')
      .bind(messageId, userId, readAt),
    db
      .prepare(
        `INSERT INTO chat_read_state (message_id, user_id, read_at, deleted_at) VALUES (?, ?, ?, NULL)
      ON CONFLICT(message_id, user_id) DO UPDATE SET
        read_at = CASE WHEN chat_read_state.deleted_at IS NULL THEN chat_read_state.read_at ELSE excluded.read_at END,
        deleted_at = NULL`,
      )
      .bind(messageId, userId, readAt),
  ]);
}

export async function listReadsByMessage(db: Db, messageId: string): Promise<ChatReadRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM chat_read_state WHERE message_id = ? AND deleted_at IS NULL ORDER BY read_at, user_id',
    )
    .bind(messageId)
    .all<ChatReadRow>();
  return results;
}
