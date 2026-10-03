-- 0006_protocol_is_current.sql
-- A line can have several current ID methods (owner decision 2026-09-30, T-014 feedback).
-- `id_protocols.is_current` marks each current method. `lines.current_protocol_id` stays as the
-- "primary" current method (the one the Line List sorts and filters by); the application keeps it
-- equal to one of the flagged protocols. Lines written before this migration have only the pointer,
-- so it is copied into the flag here; code that reads the current set also honours the pointer.

ALTER TABLE id_protocols ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1));

UPDATE id_protocols
   SET is_current = 1
 WHERE id IN (SELECT current_protocol_id FROM lines WHERE current_protocol_id IS NOT NULL);
