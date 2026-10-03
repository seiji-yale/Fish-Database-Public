-- T-017: track current read state separately so the append-only chat_reads audit remains intact.
CREATE TABLE IF NOT EXISTS chat_read_state (
  message_id TEXT NOT NULL REFERENCES chat_messages (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  read_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_read_state_user_id ON chat_read_state (user_id);

INSERT OR IGNORE INTO chat_read_state (message_id, user_id, read_at, deleted_at)
SELECT message_id, user_id, read_at, NULL FROM chat_reads;
