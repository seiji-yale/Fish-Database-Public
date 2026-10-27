# T-033 — Feeding Schedule data and API

|                  |                                                          |
| ---------------- | -------------------------------------------------------- |
| State            | Done                                                     |
| Size             | M                                                        |
| Phase            | 5 (Feeding Schedule & restricted view)                   |
| Depends on       | T-031                                                    |
| Depends on OQ    | —                                                        |
| Branch           | `ticket/T-033-feeding-data-api`                          |
| Owner acceptance | reviewer-only (API; the owner accepts the page in T-034) |

## Goal

The schedule exists in the database and over the API: one feeder per day with full history, day notes,
schedule events, month read model with totals, repeat-week helper, and inclusion in the Dropbox
export, the mirror CSVs and the restore tool. No UI yet.

## Scope

- Migration `0014_feeding_schedule.sql`: `feeding_assignments`, `schedule_events` (including nullable
  `series_id` and the `(series_id, date)` index, BR-19), indexes incl. the partial unique index
  (spec §6.2, §6.3); `settings.feeding_schedule_notes` key documented (no seed).
- `worker/db/types.ts`, `worker/db/queries/feedingAssignments.ts`, `scheduleEvents.ts` (list by month,
  current by date, history by date, insert, close/replace, soft delete); append-only guard: no update/delete helper on assignments.
- `domain/feeding.ts`: `monthGrid`, `isWeekend`, `tally`, `validateMonth`, `validateDayWrite`,
  `validateEventWrite`, `repeatWeekPlan`, `repeatEventDates` (BR-19: weekly dates, 2–104, problems
  `untilBeforeStart` / `tooMany` / `outOfRange`), `summaryCsvRows` (used by T-035), `feedingMessages`; 100 % coverage.
- `worker/lib/feedingWrite.ts`: `setDay(db, { date, userId, note, expectedAssignmentId, author, now })`
  → one `db.batch` [close previous row, insert new row]; 409 `DAY_CHANGED` on mismatch; 400 for an
  unassignable user (BR-14); `repeatWeek`; event writes.
- `worker/routes/feeding.ts`: routes of spec §8 except `summary.csv` (T-035); all behind
  `requireCapability('feeding.read' | 'feeding.write')`; mounted in `worker/index.ts`.
- Route-coverage table (T-032): add the `feeding` rows.
- Export: `worker/export/schema.ts` (`feedingAssignments`, `scheduleEvents`, `settings.feeding_schedule_notes`),
  `build.ts` (JSON + `feeding_assignments.csv`, `schedule_events.csv`), mirror `README.txt`,
  `tools/import/restore_from_export.py` (+ tests), `tools/db/export-fixture.ts` if it enumerates tables.
- Docs: `03-data-model.md` §2.20–2.21, §3, §6; `06-operations.md` §1.2 file list.

## Out of scope

- Page, dialogs, navigation (T-034); CSV/PDF summary endpoint and print view (T-035); import tool (T-036); events UI (T-037). The events API ships here, including weekly repeat and `scope=this|following` on edit and delete (FR-FEED-22, BR-19); T-037 is the UI for it.

## Spec references

`docs/08-feeding-schedule-and-guest-access.md` §3.3 (FR-FEED-11 … 15), §3.5 API side, §3.7 (FR-FEED-26 … 29), §6.2 – §6.6, §8, BR-13, BR-14, BR-16, BR-17, BR-18, BR-19.

## Steps

### Step 1 — Migration and queries

**Tasks**

- 0014 with CHECKs and the partial unique index; `migrations.test.ts`: two current rows for one date are rejected; a replaced row plus a current row are allowed.
- Query helpers with tests on the test database (`worker/db/testing/testDb.ts`).
  **Done when**
- `npm run db:migrate:local` applies; helpers covered; no update/delete helper exists for `feeding_assignments`.
  **Review focus**
- B: soft-close semantics; FK to users; `deleted_at IS NULL` on events reads.

### Step 2 — Domain rules

**Tasks**

- `domain/feeding.ts` as spec §6.6; fixed-date tests (month starting on each weekday, February leap year, 31-day months, DST days in `America/New_York` must not shift dates — pure string arithmetic).
- `tally` weekday/weekend/total + unassigned; `repeatWeekPlan` with/without overwrite; `repeatEventDates` (weekly, same weekday, 2–104, until-before-start refused); validations and messages.
  **Done when**
- 100 % branch coverage; `monthGrid('2026-10')` places the 1st on Thursday and ends on Saturday the 31st.
  **Review focus**
- A: numbers match the sheet for October 2026 (Feeder One/Feeder Two/Feeder Three counts — compute by hand in the report).

### Step 3 — Write path and routes

**Tasks**

- `feedingWrite.ts` and `routes/feeding.ts`; concurrency test (two saves with the same `expectedAssignmentId` → one 200, one 409); unassignable user (guest, inactive, unknown) → 400; feeder/member/admin → allowed; guest → 403.
- Repeat-week: dry run counts, apply atomic, keeps assigned days unless `overwrite`.
- Events: create one-off; create a weekly series (`repeatUntil`, one `series_id`, dry run writes nothing); `PATCH`/`DELETE` with `scope=following` touch this row and later rows only; `scope=following` on a one-off is 400.
- Mirror-dirty: a test that a `PUT` marks `settings.mirror_dirty_at`.
  **Done when**
- Route tests cover every path of spec §8 (except `summary.csv`); route-coverage table updated.
  **Review focus**
- B: `db.batch` atomicity; 409 wording from `messages.ts`; author = signed-in user (BR-5).

### Step 4 — Export, mirror, restore, docs

**Tasks**

- Schema/build/CSV additions; restore script + pytest; snapshot unaffected (optional section is T-035/OQ-45 b).
- Data-model and operations docs; `STATUS.md`.
  **Done when**
- `GET /api/admin/export.zip` contains the two new CSVs and the JSON keys; `restore_from_export.py --dry-run` counts them; old export fixtures still validate.
  **Review focus**
- D: `03-data-model.md` tables documented with the same column names as the migration.

## Acceptance criteria (reviewer verifies locally / on preview)

1. `PUT /api/feeding/days/2026-10-09 {userId, expectedAssignmentId: null}` creates the day; a second `PUT` with the stale id → 409; history shows both rows.
2. `GET /api/feeding?month=2026-10` returns 31 days, assignable people (no Guest, no inactive), totals equal to a hand count.
3. Guest → 403 on every `/api/feeding*`; Feeder → 200 on read and write.
4. Export ZIP and JSON contain the schedule; restore dry run lists the counts.

## Review Log

<!-- Append Step Reports, Step Reviews, Ticket Review, Owner feedback here, newest at the bottom. -->

### Steps 1 to 4 — 2026-10-26 — implementer

- Step 1: migration `0014_feeding_schedule.sql` (additive: two tables). The date CHECK is `date IS strftime('%Y-%m-%d', date)`, not `=`: for `2026-13-01` the `strftime` is NULL and `=` would let the row through. Query helpers `feedingAssignments.ts` (no update or delete helper; `closeAssignmentStatement` only sets `replaced_at/by`) and `scheduleEvents.ts` (live reads, in-place edit, soft delete). `feedingQueries.test.ts` covers: two current rows for one date rejected, a replaced row plus a current row allowed, bad dates, long notes, unknown users, series reads.
- Step 2: `domain/feeding.ts` (100 % branches). Calendar arithmetic is on day numbers, never a local-time `Date`. `monthGrid('2026-10')` starts with the 1st on Thursday and ends on Saturday the 31st; a table-driven test covers a month starting on each weekday, 28/29/30/31-day months and the daylight-saving weekends. Hand count for the tally test: October 2026 has 22 weekdays and 9 weekend days; with the days dealt out One, Two, Three in turn, One has 11 days and Two and Three 10 each.
- Step 3: `worker/lib/feedingRead.ts` (one query per table, joined in memory; `followingCount` from one extra query), `worker/lib/feedingWrite.ts` (`setDay`, `repeatWeek`, event writes; each write is one `db.batch`) and `worker/routes/feeding.ts` for every route of spec section 8 except `summary.csv` (T-035). `worker/feeding.test.ts`: the stale save gives 409 `DAY_CHANGED` with the BR-12 wording; two simultaneous saves give one 200 and one 409; a clear whose close changes nothing is a 409 and writes nothing; Guest gets 403 on all seven routes; Feeder reads and writes; unassignable people (Guest, deactivated Member, unknown id) get 400; the Dropbox copy is marked dirty. The route-coverage table has a `feeding` row for each new route and calls it as Guest, Feeder, Member and Admin.
- Step 4: export JSON gains `feedingAssignments`, `scheduleEvents` and `settings.feeding_schedule_notes` (`.default([])` for older files); `feeding_assignments.csv` and `schedule_events.csv` with the people's names; the mirror README lists them; `restore_from_export.py` restores both tables and the setting (pytest: history kept, `--wipe`, an export from before the schedule, damaged lists refused). Docs: `03-data-model.md` (new section 3, export), `06-operations.md` section 1. `tools/db/export-fixture.ts` needed no change (it calls the exporter).
- Deviations: (1) `repeatEventDates` has a fourth problem, `tooFew` (the last date is less than a week after the first: BR-19 says a series has at least 2 rows and a one-week span is a one-off), and a fifth, `invalidDate`, for text that is not a date. (2) Saving the value a day already has writes no row and answers 200 (no history clutter). (3) `repeat-week` treats a source-week person who can no longer be assigned as "no feeder" (BR-14) and fills only days after the source week; `weekStart` may be any date whose week overlaps the month. (4) `GET /api/feeding/days/:date/history` returns `replacedByName: null` for the current row. (5) `summaryCsvRows` takes the day list and returns the `Unassigned` row only when a day has no feeder, like the page panel. (6) `PATCH /api/admin/settings` (`feedingScheduleNotes`) is not part of this ticket's scope list and arrives with T-035 (Notes & links); the setting is read by `GET /api/feeding` and exported already.
- Checks: `npm run check` green (typecheck, lint, 779+ unit tests, domain coverage 100 % of 1000 statements and 838 branches, english, free-tier, 149 pytest); `check:public` 0 issues; `db:migrate:local` applies 0014. The browser suite is not affected (no UI change) and runs in CI.
- Open for the owner at acceptance (reviewer-only ticket): nothing to click; production needs migration 0014 (additive, no rebuild) when the lane is released.
