-- 0010_accounts.sql
-- Personal accounts, role invites and the shareable Guest URL (ADR-0005, T-027).
-- password_hash: pbkdf2-sha256 (same format as the old admin_password_hash); NULL = cannot sign in
--   until Admin sends an invite.
-- must_change_password: 1 while the initial password chosen by Admin is in use; such a user signs in
--   only through the invite URL and must pick a new password first.
-- session_epoch: part of every session cookie; raising it signs the user out everywhere (removed,
--   new invite, password changed, Guest URL rotated).
-- failed_logins / locked_until: 10 wrong passwords lock the account for 15 minutes.
-- The built-in Admin row (the shared identity of ADR-0002) is retired: people with the admin role
-- act as themselves. Its old rows in history keep pointing at it.
-- guest_link_token: the secret part of the Guest URL; every signed-in member may copy it (ADR-0005).
-- admin_password_hash and lab_passphrase_hash are no longer read and are removed.

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

CREATE TABLE IF NOT EXISTS invites (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id),
  -- SHA-256 of the token in the URL (hex); the token itself is shown once and never stored.
  token_hash  TEXT NOT NULL UNIQUE,
  created_by  TEXT REFERENCES users (id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_invites_user ON invites (user_id);

UPDATE users SET is_active = 0 WHERE is_builtin = 1 AND role = 'admin';

INSERT OR IGNORE INTO settings (key, value) VALUES ('guest_link_token', lower(hex(randomblob(24))));
DELETE FROM settings WHERE key IN ('admin_password_hash', 'lab_passphrase_hash');
