-- 0012_cryo_use_undo.sql
-- Undoing a recorded vial use (T-028, OQ-38). The use row is kept for good (BR-7) and marked undone:
-- who undid it and when. Everything that counts "used" vials ignores undone rows, and the vial's Cryo ID
-- may be used again later, so the unique index only covers uses that stand.

ALTER TABLE cryo_vial_uses ADD COLUMN undone_at TEXT;
ALTER TABLE cryo_vial_uses ADD COLUMN undone_by TEXT REFERENCES users (id);

DROP INDEX IF EXISTS idx_cryo_vial_uses_cryo_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cryo_vial_uses_cryo_id
  ON cryo_vial_uses (cryo_id) WHERE cryo_id IS NOT NULL AND undone_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cryo_vial_uses_undone_by ON cryo_vial_uses (undone_by);
