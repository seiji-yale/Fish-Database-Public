# Data model

## 1. Core records

`lines` holds one current row per line. Status is Current, Breeding, or Closed. Related tables hold
phenotypes, attributes, genotyping protocols and records, cryopreservation records, references,
attachments, chat messages, activities, and version snapshots. `users` holds individual accounts;
`settings` and `enumerations` hold administrative configuration.

## 2. Child records

The SQL migrations in `worker/db/migrations/` define the authoritative columns and constraints.
Child records use their own IDs and line foreign keys. Deleted records are retained with a deletion
timestamp. A cryopreservation range is inclusive; its count is derived from the first and last ID.

Attachments (`attachments`) keep the file name, MIME type, size and R2 key
(`lines/<line_id>/<attachment_id>-<safe_name>`). `kind` is `gel_image`, `fluorescence_image`,
`sequence_result`, `reference_file` or `other`. Sequence files (T-038) need no migration: on an ID
protocol they are `sequence_result`, on a reference they are `reference_file`. Their stored MIME types
are our own names (`application/x-abif`, `text/x-fasta`, `text/x-sequence`) because browsers report
no usable type; they are always served as downloads.

## 3. Feeding Schedule

Migration `0014_feeding_schedule.sql` (T-033) adds two tables. Dates are lab calendar dates
(`YYYY-MM-DD`, `America/New_York`), checked to be real dates from 2000-01-01 to 2100-12-31.

`feeding_assignments` holds who feeds on a day, and is append-only (BR-13, BR-7):

| column        | notes                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| id            | TEXT primary key                                                                               |
| date          | the day                                                                                        |
| user_id       | the feeder (FK `users`)                                                                        |
| note          | optional, at most 200 characters                                                               |
| imported_from | where the one-time Google Sheet import found it (T-036); NULL for app writes                   |
| created_at    | when this value was set                                                                        |
| created_by    | who set it (FK `users`)                                                                        |
| replaced_at   | NULL for the current value of the day; set when a newer row replaces it, or the day is cleared |
| replaced_by   | who replaced or cleared it (FK `users`)                                                        |

`UNIQUE INDEX feeding_current_day ON feeding_assignments (date) WHERE replaced_at IS NULL` allows one
current row per date; it is also the lock that makes two simultaneous saves of one day impossible (the
second insert fails and the API answers 409 `DAY_CHANGED`). A change closes the current row and inserts
the new one in one `db.batch`; clearing a day only closes it. The full history of a day is
`SELECT … WHERE date = ? ORDER BY created_at`. No `activities` row is written.

`schedule_events` holds other entries of the schedule (BR-19): `id`, `date`, `series_id` (NULL for a
one-off; the same value on every row of one weekly repeat), `title` (1 to 60 characters), `note` (at most
200), `created_at/by`, `updated_at/by`, `deleted_at/by`. A weekly repeat is one row per occurrence.
Edits change title and note in place (no before/after history) and never clear `series_id`; deleting is
soft. Indexes: `(date)` and `(series_id, date)`.

The setting `feeding_schedule_notes` (plain text, at most 2000 characters) has no seed row.

People who can be assigned (BR-14) are active users whose role is `admin`, `member` or `feeder`.

## 5. Users and roles

`users.role` is one of `admin`, `member`, `feeder`, `guest` (CHECK). Migration `0013_feeder_role.sql`
added `feeder` by rebuilding the table. D1 cannot switch foreign keys off, so the migration uses
`PRAGMA defer_foreign_keys`; with it the usual "create `users_new`, drop `users`, rename" order fails at
commit (the children reference the name `users`). The migration instead copies the rows to `users_copy`,
drops `users`, creates `users` again and inserts the rows back, which cancels each child's pending
violation. A missing row makes the commit fail. `worker/db/migrations.test.ts` proves ids, passwords
and indexes are unchanged. Rehearse any future rebuild on a copy of production first.

## 6. Export

The JSON and CSV export builders live in `worker/export/`. The JSON schema is defined in
`worker/export/schema.ts`. Exports omit authentication secrets.

The Feeding Schedule is exported whole: `feedingAssignments` and `scheduleEvents` in the JSON (every row,
replaced and deleted ones included, like `lineVersions`) and `settings.feeding_schedule_notes`. Older
exports without them restore with empty lists. The mirror and the ZIP also carry `feeding_assignments.csv`
(`id, date, user_id, user_name, note, imported_from, created_at, created_by, created_by_name,
replaced_at, replaced_by, replaced_by_name`) and `schedule_events.csv` (all columns plus
`created_by_name`, `updated_by_name`, `deleted_by_name`). `tools/import/restore_from_export.py` restores
both tables and the setting.

## 7. Write order

Write paths save the line, its children, a version snapshot, and an activity within the same logical
operation. Insert a line before children that reference it. When a protocol becomes current, insert
the protocol before updating `lines.current_protocol_id` so hosted D1 does not depend on deferred
foreign-key checks. See the corresponding write modules and tests for exact transaction behavior.
