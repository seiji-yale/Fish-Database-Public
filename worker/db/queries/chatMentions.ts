import type { Db, DbStatement } from '../db';
import type { ChatMentionRow } from '../types';
import { define, insertStatement, listRowsBy } from './shared';

export const CHAT_MENTIONS = define<ChatMentionRow>(
  'chat_mentions',
  { id: true, message_id: true, user_id: true, created_at: true, deleted_at: true },
  true,
);

export function insertChatMentionStatement(db: Db, row: ChatMentionRow): DbStatement {
  return insertStatement(db, CHAT_MENTIONS, row);
}

export function softDeleteChatMentionsStatement(
  db: Db,
  messageId: string,
  deletedAt: string,
): DbStatement {
  return db
    .prepare('UPDATE chat_mentions SET deleted_at = ? WHERE message_id = ? AND deleted_at IS NULL')
    .bind(deletedAt, messageId);
}

export function listChatMentionsByMessage(db: Db, messageId: string): Promise<ChatMentionRow[]> {
  return listRowsBy(db, CHAT_MENTIONS, 'message_id', messageId, 'created_at, id');
}
