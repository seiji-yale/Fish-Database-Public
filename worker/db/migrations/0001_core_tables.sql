-- 0001_core_tables.sql
-- Core tables of docs/03-data-model.md: users, settings, enumerations, lines, line_phenotypes,
-- line_attributes, plus id_protocols (it is created here, not with the other child tables, because
-- lines.current_protocol_id and id_protocols.line_id reference each other and SQLite cannot insert
-- into `lines` while the referenced table is missing). The remaining child tables (records,
-- history, chat ...) are in 0005_child_tables.sql; the seeds (0002-0004) only need this file.
--
-- Conventions: ids are TEXT ULIDs; timestamps are ISO-8601 UTC text; dates are YYYY-MM-DD text;
-- booleans are INTEGER 0/1; rows are soft-deleted through deleted_at, never removed (BR-7).
-- D1 keeps PRAGMA foreign_keys on, so every REFERENCES below is enforced.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT NOT NULL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'member', 'guest')),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_builtin  INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT NOT NULL PRIMARY KEY,
  value  TEXT
);

CREATE TABLE IF NOT EXISTS enumerations (
  id          TEXT NOT NULL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN (
                'id_method_type', 'fluorophore', 'cryo_place', 'request_type', 'attribute_key')),
  value       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (kind, value)
);

CREATE TABLE IF NOT EXISTS lines (
  id                   TEXT NOT NULL PRIMARY KEY,
  -- BR-8: 1-60 characters after trimming; uniqueness is case-insensitive (index below).
  name                 TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  gene                 TEXT,
  status               TEXT NOT NULL CHECK (status IN ('Current', 'Breeding', 'Closed')),
  dob                  TEXT,
  generation_no        INTEGER NOT NULL DEFAULT 1 CHECK (generation_no >= 1),
  ided_number          INTEGER NOT NULL DEFAULT 0 CHECK (ided_number >= 0),
  last_id_date         TEXT,
  breeding_started_at  TEXT,
  closed_at            TEXT,
  closed_reason        TEXT,
  notes                TEXT,
  -- The "Current ID Method". lines and id_protocols reference each other, so this foreign key is
  -- deferred: a line and its first protocol can be inserted in one transaction (D1 batch).
  -- There is deliberately no `source` column: Source is a line_attributes row (OQ-20).
  current_protocol_id  TEXT REFERENCES id_protocols (id) DEFERRABLE INITIALLY DEFERRED,
  legacy_no            INTEGER,
  legacy_check         INTEGER,
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           TEXT NOT NULL,
  created_by           TEXT NOT NULL REFERENCES users (id),
  updated_at           TEXT NOT NULL,
  updated_by           TEXT NOT NULL REFERENCES users (id)
);

-- BR-8: the same name in another case or with stray spaces is a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lines_name_ci ON lines (lower(trim(name)));
CREATE INDEX IF NOT EXISTS idx_lines_status ON lines (status);
CREATE INDEX IF NOT EXISTS idx_lines_dob ON lines (dob);
CREATE INDEX IF NOT EXISTS idx_lines_current_protocol_id ON lines (current_protocol_id);
CREATE INDEX IF NOT EXISTS idx_lines_created_by ON lines (created_by);
CREATE INDEX IF NOT EXISTS idx_lines_updated_by ON lines (updated_by);

CREATE TABLE IF NOT EXISTS line_phenotypes (
  id           TEXT NOT NULL PRIMARY KEY,
  line_id      TEXT NOT NULL REFERENCES lines (id),
  description  TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  -- Not in the v0.1 data model text; added because BR-7 requires child records to be soft-deleted.
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_line_phenotypes_line_id ON line_phenotypes (line_id);

CREATE TABLE IF NOT EXISTS line_attributes (
  id          TEXT NOT NULL PRIMARY KEY,
  line_id     TEXT NOT NULL REFERENCES lines (id),
  key         TEXT NOT NULL,
  value       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT
);

-- One row per (line, key) among the rows that are not soft-deleted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_attributes_line_key
  ON line_attributes (line_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_line_attributes_line_id ON line_attributes (line_id);

CREATE TABLE IF NOT EXISTS id_protocols (
  id             TEXT NOT NULL PRIMARY KEY,
  line_id        TEXT NOT NULL REFERENCES lines (id),
  protocol_type  TEXT NOT NULL CHECK (protocol_type IN (
                   'none', 'tails', 'pcr', 'pcr_sequence', 'fluorescence', 'custom')),
  label          TEXT NOT NULL,
  -- JSON validated against the protocol template in code (domain/protocolTemplates.ts, T-005).
  fields         TEXT NOT NULL CHECK (json_valid(fields)),
  notes          TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  deleted_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_id_protocols_line_id ON id_protocols (line_id);
