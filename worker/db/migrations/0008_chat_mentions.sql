-- T-017: an unread chat notification is delivered only to explicitly mentioned active users.
CREATE TABLE IF NOT EXISTS chat_mentions (
  id         TEXT NOT NULL PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_messages (id),
  user_id    TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_mentions_user_id ON chat_mentions (user_id, message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_mentions_current
  ON chat_mentions (message_id, user_id) WHERE deleted_at IS NULL;
