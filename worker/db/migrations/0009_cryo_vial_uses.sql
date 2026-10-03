-- 0009_cryo_vial_uses.sql
-- Recording that cryo vials were used (owner request 2026-09-30, T-015 feedback). A used vial leaves
-- the line's list (`cryo_records.count` goes down; a record with no vial left is soft-deleted) and
-- stays here for good. A Cryo ID can be used once and is never reused: the partial unique index
-- refuses a second use, and the application refuses new records whose range contains a used ID.
-- Records without IDs (external storage with only a count) are used by quantity (`cryo_id` NULL).

CREATE TABLE IF NOT EXISTS cryo_vial_uses (
  id              TEXT NOT NULL PRIMARY KEY,
  line_id         TEXT NOT NULL REFERENCES lines (id),
  cryo_record_id  TEXT NOT NULL REFERENCES cryo_records (id),
  cryo_id         TEXT,
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  used_at         TEXT NOT NULL,
  note            TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL REFERENCES users (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cryo_vial_uses_cryo_id
  ON cryo_vial_uses (cryo_id) WHERE cryo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cryo_vial_uses_line_id ON cryo_vial_uses (line_id);
CREATE INDEX IF NOT EXISTS idx_cryo_vial_uses_record_id ON cryo_vial_uses (cryo_record_id);
CREATE INDEX IF NOT EXISTS idx_cryo_vial_uses_created_by ON cryo_vial_uses (created_by);
