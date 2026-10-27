-- 0014_feeding_schedule.sql
-- Feeding Schedule (T-033, docs/08-feeding-schedule-and-guest-access.md section 6). Additive: two new tables.
-- `feeding_assignments` is append-only: a day's current value is the row with `replaced_at IS NULL`
-- (BR-13); a change inserts a new row and closes the old one, so every earlier value stays (BR-7).
-- `schedule_events` are other entries of the schedule (a one-off, or one row per occurrence of a weekly
-- series sharing `series_id`, BR-19); they are soft-deleted only.

CREATE TABLE IF NOT EXISTS feeding_assignments (
  id             TEXT NOT NULL PRIMARY KEY,
  date           TEXT NOT NULL
                 CHECK (date BETWEEN '2000-01-01' AND '2100-12-31' AND date IS strftime('%Y-%m-%d', date)),
  user_id        TEXT NOT NULL REFERENCES users (id),
  note           TEXT CHECK (note IS NULL OR length(note) <= 200),
  imported_from  TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL REFERENCES users (id),
  replaced_at    TEXT,
  replaced_by    TEXT REFERENCES users (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS feeding_current_day
  ON feeding_assignments (date) WHERE replaced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_feeding_assignments_date ON feeding_assignments (date);
CREATE INDEX IF NOT EXISTS idx_feeding_assignments_user_id ON feeding_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_feeding_assignments_created_by ON feeding_assignments (created_by);
CREATE INDEX IF NOT EXISTS idx_feeding_assignments_replaced_by ON feeding_assignments (replaced_by);

CREATE TABLE IF NOT EXISTS schedule_events (
  id          TEXT NOT NULL PRIMARY KEY,
  date        TEXT NOT NULL
              CHECK (date BETWEEN '2000-01-01' AND '2100-12-31' AND date IS strftime('%Y-%m-%d', date)),
  series_id   TEXT,
  title       TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 60),
  note        TEXT CHECK (note IS NULL OR length(note) <= 200),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users (id),
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL REFERENCES users (id),
  deleted_at  TEXT,
  deleted_by  TEXT REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_events_date ON schedule_events (date);
CREATE INDEX IF NOT EXISTS idx_schedule_events_series ON schedule_events (series_id, date);
CREATE INDEX IF NOT EXISTS idx_schedule_events_created_by ON schedule_events (created_by);
CREATE INDEX IF NOT EXISTS idx_schedule_events_updated_by ON schedule_events (updated_by);
CREATE INDEX IF NOT EXISTS idx_schedule_events_deleted_by ON schedule_events (deleted_by);
