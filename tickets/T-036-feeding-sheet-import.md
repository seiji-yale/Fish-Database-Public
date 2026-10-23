# T-036 — Google Sheet import tool and production cut-over

|                  |                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------ |
| State            | Draft                                                                                      |
| Size             | M                                                                                          |
| Phase            | 5 (Feeding Schedule & restricted view)                                                     |
| Depends on       | T-033 (data + API); production run also needs T-034 merged (to verify in the UI)           |
| Depends on OQ    | OQ-41 (production import range — default: the sheet's visible tabs, October–December 2026) |
| Branch           | `ticket/T-036-feeding-sheet-import`                                                        |
| Owner acceptance | required: owner signs off the dry-run report and runs/witnesses the production steps       |

## Goal

A one-time developer tool (dry run → report → apply, as T-004) that reads the lab's feeding Google
Sheet (downloaded as `.xlsx`) and writes the feeder assignments into the database, plus the runbook
that moves production from the sheet to the app with only the three current Feeders created.

## Scope

- `tools/import/feeding/` (Python, `openpyxl`, pytest): `reader.py` (tab → month, day grid, name cells,
  event cells counted, orphans), `mapper.py` (name → user, unknown names, idempotency rules),
  `report.py` (Markdown with a calendar rendering per month), `sql.py` (one atomic SQL file),
  `import_feeding.py` CLI per spec §7.3; `conftest.py` synthetic workbook (12 tabs shape, orphan cell,
  unknown name, leftover on a real date, formulas with cached values).
- Flags: `--months`, `--env`, `--actor` (default: first active Admin by name), `--create-missing-users`
  (inactive `feeder` users, **refused when `--env production`**), `--apply`, `--yes`.
- Idempotency: re-run replaces earlier imported rows for the same dates; app-edited days are never overwritten (listed).
- `npm run import:feeding -- …` script alias; `tools/requirements-dev.txt` unchanged (openpyxl present).
- Docs: `05-import-spec.md` new §8 "Feeding Schedule sheet" (from spec §7.1 – §7.3); `06-operations.md`
  §8.2 production cut-over (spec §7.4); README commands table; `user-guide.md` note for feeders.
- The sheet URL/ID is **not** committed; the owner passes the downloaded file path.

## Out of scope

- Importing events (`Test Water Quality`, `Inspection`) or the footer — owner decision (D8, D10); the footer text is pasted by the owner into Settings (T-035).
- Any writes to the Google Sheet.

## Spec references

`docs/08-feeding-schedule-and-guest-access.md` §7 (7.1 – 7.4), §6.2 (`imported_from`), BR-13, BR-14 · `docs/01-requirements.md` FR-IMP-02 … 04 (by analogy) · `tickets/T-004-excel-import-tool.md` (patterns, lessons).

## Steps

### Step 1 — Reader and tests

**Tasks**

- Layout check (`C5:I5`, `D4` year, month from `C4` cached text or the tab name); walk week blocks; collect `(date, name, cell)`; orphans; events counted; never write to the file (fingerprint test as T-004).
  **Done when**
- Synthetic workbook: all assignments found, orphan reported, leftover on a real date reported as a normal assignment (the owner clears it in the sheet; the report makes it visible).
  **Review focus**
- B: no dependency on hidden/visible tab state; raises on layout mismatch.

### Step 2 — Mapping, SQL, idempotency, report

**Tasks**

- Users by case-insensitive name from the target database (`wrangler d1 execute … --json` as T-004); unknown names; `--create-missing-users` (inactive feeders, never production); SQL: close imported current rows for the dates, insert new ones with `imported_from`; skip app-edited days.
- Report sections per month + totals; CLI dry run writes `import/work/feeding-report.md` and `feeding.sql`.
  **Done when**
- pytest covers unknown name refusal, create-missing on local, production refusal, re-run idempotency, app-edited skip.
  **Review focus**
- B: atomic file; no `DELETE`; actor is a real user id.

### Step 3 — Local and preview runs with the real sheet

**Tasks**

- Owner downloads the sheet as `.xlsx`; agent runs the dry run for all 12 months on **local/preview** with `--create-missing-users`; owner reviews the report (counts per person per month vs the sheet); apply on preview; open `/feeding?month=2026-10` on preview and compare.
  **Done when**
- Preview shows the sheet's months; report archived in the Review Log (counts only, no personal data beyond first names).
  **Review focus**
- A: report readable by the owner; discrepancies explained (orphans, leftovers).

### Step 4 — Production cut-over runbook and execution

**Tasks**

- Write `06-operations.md` §8.2 (spec §7.4); the owner creates Feeder One, Feeder Two, Feeder Three (Feeder) and clears the Nov/Dec leftovers in the sheet; dry run for `2026-10,2026-11,2026-12` must show 0 unknown names; owner signs off; apply; Export now; sheet set to view-only.
  **Done when**
- Production `/feeding?month=2026-10` equals the sheet; mirror contains `feeding_assignments.csv`.
  **Review focus**
- A/E: production written only through the documented runbook with the owner present (AGENTS.md §3).

## Acceptance criteria (owner verifies)

1. The dry-run report for October–December 2026 lists every assignment per day, 0 unknown names, and the orphan cells before the 1st as skipped.
2. After apply, the production calendar for October 2026 matches the sheet cell by cell; Feeder One, Feeder Two and Feeder Three are the only new users.
3. Re-running the apply makes no change (idempotent); a day edited in the app beforehand is listed as kept.
4. The tool refuses `--create-missing-users` on production.

## Review Log

<!-- Append Step Reports, Step Reviews, Ticket Review, Owner feedback here, newest at the bottom. -->
