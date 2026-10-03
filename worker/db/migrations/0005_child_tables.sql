-- 0005_child_tables.sql
-- Remaining tables of docs/03-data-model.md: genotyping_records, cryo_records, attachments,
-- line_references, line_versions, activities, chat_messages, chat_reads, mirror_runs, import_runs.
-- (id_protocols is in 0001 because of its cycle with lines.)
--
-- Soft delete (BR-7): tables with deleted_at are hidden, never removed. The history tables
-- (genotyping_records, line_versions, activities, chat_reads, mirror_runs, import_runs) are
-- append-only records and have no delete column.
-- Closed vocabularies are CHECK constraints; the values match the data model text exactly.

CREATE TABLE IF NOT EXISTS genotyping_records (
  id                 TEXT NOT NULL PRIMARY KEY,
  line_id            TEXT NOT NULL REFERENCES lines (id),
  -- The generation the record belongs to, after applying BR-2.
  generation_no      INTEGER NOT NULL CHECK (generation_no >= 1),
  record_date        TEXT NOT NULL,
  protocol_id        TEXT REFERENCES id_protocols (id),
  positive_count     INTEGER NOT NULL CHECK (positive_count >= 0),
  screened_count     INTEGER CHECK (screened_count IS NULL OR screened_count >= 0),
  is_new_generation  INTEGER NOT NULL CHECK (is_new_generation IN (0, 1)),
  new_dob            TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_genotyping_records_line_id ON genotyping_records (line_id, generation_no);
CREATE INDEX IF NOT EXISTS idx_genotyping_records_protocol_id ON genotyping_records (protocol_id);
CREATE INDEX IF NOT EXISTS idx_genotyping_records_created_by ON genotyping_records (created_by);

CREATE TABLE IF NOT EXISTS cryo_records (
  id               TEXT NOT NULL PRIMARY KEY,
  line_id          TEXT NOT NULL REFERENCES lines (id),
  cryo_date        TEXT,
  place            TEXT,
  box_name         TEXT,
  cryo_id_start    TEXT,
  cryo_id_end      TEXT,
  count            INTEGER CHECK (count IS NULL OR count >= 0),
  details_unknown  INTEGER NOT NULL DEFAULT 0 CHECK (details_unknown IN (0, 1)),
  notes            TEXT,
  deleted_at       TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT NOT NULL REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_cryo_records_line_id ON cryo_records (line_id);
CREATE INDEX IF NOT EXISTS idx_cryo_records_created_by ON cryo_records (created_by);

-- owner_type / owner_id point at a row of another table, so there is no foreign key on owner_id.
CREATE TABLE IF NOT EXISTS attachments (
  id            TEXT NOT NULL PRIMARY KEY,
  owner_type    TEXT NOT NULL CHECK (owner_type IN (
                  'id_protocol', 'genotyping_record', 'line_reference', 'chat_message', 'line')),
  owner_id      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'gel_image', 'fluorescence_image', 'sequence_result', 'reference_file', 'other')),
  file_name     TEXT,
  mime_type     TEXT,
  size_bytes    INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  -- lines/<line_id>/<attachment_id>-<safe_file_name>
  r2_key        TEXT NOT NULL,
  thumb_r2_key  TEXT,
  caption       TEXT,
  -- "Latest gel image": a new upload sets the previous one to 0 (done in application code).
  is_latest     INTEGER NOT NULL DEFAULT 1 CHECK (is_latest IN (0, 1)),
  deleted_at    TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments (owner_type, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_r2_key ON attachments (r2_key);
CREATE INDEX IF NOT EXISTS idx_attachments_created_by ON attachments (created_by);

-- Exactly one of url / attachment_id is set once a link exists; imported references have only a
-- title until Bob attaches a link (docs/03-data-model.md 2.9), so neither column is required.
CREATE TABLE IF NOT EXISTS line_references (
  id             TEXT NOT NULL PRIMARY KEY,
  line_id        TEXT NOT NULL REFERENCES lines (id),
  title          TEXT NOT NULL,
  url            TEXT,
  attachment_id  TEXT REFERENCES attachments (id),
  note           TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  deleted_at     TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_line_references_line_id ON line_references (line_id);
CREATE INDEX IF NOT EXISTS idx_line_references_attachment_id ON line_references (attachment_id);
CREATE INDEX IF NOT EXISTS idx_line_references_created_by ON line_references (created_by);

CREATE TABLE IF NOT EXISTS line_versions (
  id           TEXT NOT NULL PRIMARY KEY,
  line_id      TEXT NOT NULL REFERENCES lines (id),
  version_no   INTEGER NOT NULL CHECK (version_no >= 1),
  -- Full line document as JSON (line + phenotypes + protocols + cryo + references + attributes).
  snapshot     TEXT NOT NULL CHECK (json_valid(snapshot)),
  -- [{path, before, after}] against the previous snapshot; NULL for the first version.
  diff         TEXT CHECK (diff IS NULL OR json_valid(diff)),
  change_type  TEXT NOT NULL CHECK (change_type IN (
                 'created', 'edited', 'breeding_started', 'genotyping_same_gen',
                 'genotyping_new_gen', 'closed', 'reopened', 'protocol_changed', 'cryo_changed',
                 'reference_changed', 'restored', 'imported')),
  summary      TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES users (id),
  -- 1 when the change was attributed through the Admin dialog (BR-5).
  via_admin    INTEGER NOT NULL DEFAULT 0 CHECK (via_admin IN (0, 1)),
  UNIQUE (line_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_line_versions_created_by ON line_versions (created_by);

CREATE TABLE IF NOT EXISTS activities (
  id         TEXT NOT NULL PRIMARY KEY,
  -- NULL for events that belong to no line (user_added, settings_changed, mirror_failed ...).
  line_id    TEXT REFERENCES lines (id),
  user_id    TEXT NOT NULL REFERENCES users (id),
  via_admin  INTEGER NOT NULL DEFAULT 0 CHECK (via_admin IN (0, 1)),
  -- The version change types plus the chat / request / admin / mirror events.
  type       TEXT NOT NULL CHECK (type IN (
               'created', 'edited', 'breeding_started', 'genotyping_same_gen',
               'genotyping_new_gen', 'closed', 'reopened', 'protocol_changed', 'cryo_changed',
               'reference_changed', 'restored', 'imported',
               'chat_posted', 'request_opened', 'request_done', 'user_added', 'user_deactivated',
               'settings_changed', 'mirror_failed')),
  summary    TEXT NOT NULL,
  ref_type   TEXT,
  ref_id     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_line_id ON activities (line_id);
CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities (user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id               TEXT NOT NULL PRIMARY KEY,
  -- NULL = lab-wide chat.
  line_id          TEXT REFERENCES lines (id),
  -- Never the Admin user (BR-5); enforced by the query layer (worker/db/queries/chatMessages.ts).
  user_id          TEXT NOT NULL REFERENCES users (id),
  via_admin        INTEGER NOT NULL DEFAULT 0 CHECK (via_admin IN (0, 1)),
  body             TEXT NOT NULL,
  request_type     TEXT,
  request_status   TEXT CHECK (request_status IS NULL OR request_status IN ('open', 'done')),
  request_done_by  TEXT REFERENCES users (id),
  request_done_at  TEXT,
  edited_at        TEXT,
  deleted_at       TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_line_created ON chat_messages (line_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_request_done_by ON chat_messages (request_done_by);

CREATE TABLE IF NOT EXISTS chat_reads (
  message_id  TEXT NOT NULL REFERENCES chat_messages (id),
  user_id     TEXT NOT NULL REFERENCES users (id),
  read_at     TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_reads_user_id ON chat_reads (user_id);

CREATE TABLE IF NOT EXISTS mirror_runs (
  id             TEXT NOT NULL PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('on_change', 'nightly', 'manual')),
  status         TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  files_written  INTEGER NOT NULL DEFAULT 0 CHECK (files_written >= 0),
  error          TEXT
);

CREATE TABLE IF NOT EXISTS import_runs (
  id            TEXT NOT NULL PRIMARY KEY,
  source_file   TEXT,
  source_sheet  TEXT,
  mode          TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  report_md     TEXT,
  row_count     INTEGER
);
