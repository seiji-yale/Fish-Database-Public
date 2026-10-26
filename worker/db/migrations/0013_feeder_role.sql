-- 0013_feeder_role.sql
-- Adds the `feeder` role to users.role (ADR-0006, T-031).
-- SQLite cannot change a CHECK constraint, so `users` is rebuilt. This is the project's first table
-- rebuild; rehearse it on a copy of production before migrating production (docs/06-operations.md).
--
-- Many tables reference users (id), and D1 keeps foreign keys enforced and does not let a migration
-- switch them off. `PRAGMA defer_foreign_keys` postpones the check to the end of the transaction
-- (D1 runs one migration file as one transaction). The usual "create users_new, copy, drop users,
-- rename" order does NOT work with it: dropping `users` counts every child row as a violation, and
-- rows inserted into `users_new` do not cancel them because the children reference the name `users`.
-- So the order here is: copy the rows aside, drop `users`, create `users` again under its own name,
-- and insert the rows back. Each re-inserted parent row cancels its children's violations, and the
-- commit succeeds only when every id is back (a missing row makes the commit fail).
-- users has no indexes besides its primary key and the UNIQUE (name) constraint, both part of the
-- definition below; the columns are those of 0001 plus the ones added in 0010.

PRAGMA defer_foreign_keys = true;

CREATE TABLE users_copy AS
SELECT
  id, name, role, is_active, is_builtin, created_at, updated_at,
  password_hash, must_change_password, session_epoch, failed_logins, locked_until
FROM users;

DROP TABLE users;

CREATE TABLE users (
  id                    TEXT NOT NULL PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  role                  TEXT NOT NULL CHECK (role IN ('admin', 'member', 'feeder', 'guest')),
  is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_builtin            INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  password_hash         TEXT,
  must_change_password  INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  session_epoch         INTEGER NOT NULL DEFAULT 0,
  failed_logins         INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT
);

INSERT INTO users (
  id, name, role, is_active, is_builtin, created_at, updated_at,
  password_hash, must_change_password, session_epoch, failed_logins, locked_until
)
SELECT
  id, name, role, is_active, is_builtin, created_at, updated_at,
  password_hash, must_change_password, session_epoch, failed_logins, locked_until
FROM users_copy;

DROP TABLE users_copy;
