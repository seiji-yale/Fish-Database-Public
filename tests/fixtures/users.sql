-- Demo accounts used only by tests and the local seed script. No password is stored here.
INSERT OR IGNORE INTO users (id, name, role, is_active, is_builtin, created_at, updated_at) VALUES
  ('01H00000000000000000000002', 'Alice', 'member', 1, 0, '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z'),
  ('01H00000000000000000000003', 'Bob', 'member', 1, 0, '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z'),
  ('01H00000000000000000000004', 'Carol', 'member', 1, 0, '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z'),
  ('01H00000000000000000000005', 'Dan', 'member', 1, 0, '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z'),
  ('01H00000000000000000000007', 'Erin', 'member', 0, 0, '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z');
