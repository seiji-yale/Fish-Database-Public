-- A new database starts with built-in identities only. Invite people through the app.
INSERT OR IGNORE INTO users (id, name, role, is_active, is_builtin, created_at, updated_at) VALUES
  ('01H00000000000000000000001', 'Admin', 'admin', 1, 1, '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z'),
  ('01H00000000000000000000006', 'Guest', 'guest', 1, 1, '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z');
