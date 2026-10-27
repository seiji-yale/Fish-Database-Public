# T-035 — Monthly summary export (CSV + PDF) and Notes & links setting

|                  |                                                                       |
| ---------------- | --------------------------------------------------------------------- |
| State            | Ready                                                                 |
| Size             | S                                                                     |
| Phase            | 5 (Feeding Schedule & restricted view)                                |
| Depends on       | T-034                                                                 |
| Depends on OQ    | OQ-45 b (schedule section in `snapshot.html` — default: not included) |
| Branch           | `ticket/T-035-feeding-summary-export`                                 |
| Owner acceptance | required on preview URL                                               |

## Goal

A month can be handed out as a CSV or printed as a one-page PDF with the calendar, per-person totals
and the lab's notes; an Admin maintains the notes (emergency contact, protocol links) in Settings.

## Scope

- `GET /api/feeding/summary.csv?month=YYYY-MM` (`feeding.export`): FR-FEED-17 layout, BOM, file name;
  built by `domain/feeding.ts` `summaryCsvRows` + `worker/export/csv.ts`.
- Print view `/feeding/print?month=YYYY-MM` (`FeedingPrintView`, outside the shell like `/lines/:id/print`), landscape stylesheet, `window.print()`; refused page for roles without `feeding.export`.
- `Export ▾` menu on the page (CSV download, PDF opens the print view).
- Settings → Preferences: **Feeding Schedule notes & links** textarea (≤ 2 000); `PATCH /api/admin/settings { feedingScheduleNotes }`; `settings_changed` activity; the page's Notes & links block gets an `Edit` link for Admins.
- Export schema: `settings.feeding_schedule_notes` (if not already added in T-033); `snapshot.html` unchanged unless OQ-45 b is decided.
- Tests: CSV route test (31 day rows + total rows, BOM bytes via `arrayBuffer()`), domain tests for `summaryCsvRows`, Playwright `feedingPrint.spec.ts` (print view renders grid + totals), settings write spec extension.
- Docs: `04-ui-spec.md` §5.5 (print) and §7 (Preferences); `01-requirements.md` FR-ADM-03 note; `user-guide.md` export paragraph.

## Out of scope

- Server-side PDF generation (browser print is the project's PDF approach, FR-EXP-01).
- Any yearly or multi-month summary.

## Spec references

`docs/08-feeding-schedule-and-guest-access.md` §3.2 FR-FEED-08, §3.4 (FR-FEED-16 … 19), §3.6 FR-FEED-24, §5.5, BR-16, BR-18 · `docs/01-requirements.md` FR-EXP-01, FR-EXP-02, FR-ADM-03.

## Steps

### Step 1 — CSV endpoint and Export menu

**Tasks**

- Route + tests; `Export ▾` on the page; file name `feeding-schedule_YYYY-MM.csv`.
  **Done when**
- CSV opens in Excel/Numbers with the `Section` column; totals equal the page panel.
  **Review focus**
- B: `feeding.export` enforced; BOM present; `Events` joined with `; `.

### Step 2 — Print view

**Tasks**

- `/feeding/print` route in `App.tsx`; `FeedingPrintView` reusing `.print-view` styles + `@page { size: landscape }`; header, grid, totals, notes, footer `Generated … by …`.
  **Done when**
- Chrome and Safari print preview: grid on one page; no shell chrome.
  **Review focus**
- C: print stylesheet; names not truncated in print.

### Step 3 — Notes & links setting

**Tasks**

- `domain/admin.ts` `settingsSchema.feedingScheduleNotes` (≤ 2 000, trimmed, empty allowed); Preferences textarea; API; activity; page `Edit` link (Admin); linkifier shared with chat.
  **Done when**
- Admin saves the text; Feeder sees it with clickable links; export JSON carries it; Guest never reaches it.
  **Review focus**
- B/D: no personal data in fixtures or docs; setting listed in `03-data-model.md` §2.2.

## Acceptance criteria (owner verifies on preview)

1. `Export ▾ → Export as CSV` for October 2026 downloads a file whose day rows match the calendar and whose total rows match the panel.
2. `Export as PDF` opens a print page; Save as PDF gives one landscape page with grid, totals and notes.
3. Settings → Preferences: the notes block is saved and shown under the calendar with working links; the Recent Activity shows a settings change by the Admin.

## Review Log

<!-- Append Step Reports, Step Reviews, Ticket Review, Owner feedback here, newest at the bottom. -->

### Steps 1 to 3 — 2026-10-26 — implementer

- Step 1: `GET /api/feeding/summary.csv?month=` behind `feeding.export` (400 for a bad month, 403 for Guests), built by `summaryCsvRows` and `csvFile` (byte order mark, CRLF, text that looks like a formula is quoted safe, `Events` joined with `; `). The route test reads the bytes: three BOM bytes, 31 `day` rows, `total` rows equal to the page's totals. `Export` menu on the page (same `.export-menu` as Line Detail; floating on phones).
- Step 2: `/feeding/print` (`FeedingPrintPage`, outside the shell): title, calendar with full names and events, totals, Notes & links, footer `Generated … by <name>`; an `@page { size: landscape }` rule is added while the page is open. Checked by printing it to PDF in Chromium: one page, 792 x 612 pt (Letter landscape). A role without `feeding.export` gets the Not available screen.
- Step 3: `settingsSchema.feedingScheduleNotes` (trimmed, at most 2000, empty allowed; domain tests at 100 %), `PATCH /api/admin/settings` stores it (empty removes the row's value) and writes a `settings_changed` activity that says only `Feeding Schedule notes changed.` (the text can be long and is not personal data worth copying into a log); `GET /api/admin/overview` returns it; Preferences has a `Feeding Schedule notes & links` text area that sends the notes only when they changed (saving the numbers never overwrites someone else's notes); the page's block shows an `Edit` link to Preferences for Admins. The export already carried the setting (T-033).
- Tests: worker (CSV, admin settings), domain, `feedingPrint.spec.ts` (Export menu, the CSV download and its bytes, the print view, Guest) and `feedingNotes.write.spec.ts` (Admin saves, Member sees links, clearing hides the block; one viewport only because the notes are one lab-wide setting). Full browser suite green (400 tests).
- Fixes found on the way: two lists were ordered by ids made in the same second, which can differ run to run: the history of a day now puts the value still in force last, and the events of a day are ordered by title.
- Deviations: (1) acceptance 3 says the settings change shows in Recent Activity; Recent Activity lists line events only (owner decision 2026-09-30), so the entry is in the activity log and the export but not on the Dashboard; (2) `user-guide.md` and the FR-ADM-03 note: no user guide exists in this repository, and FR-ADM-03 lives in `docs/01-requirements.md`, which this ticket leaves as it is (the Settings description is in `04-ui-spec.md`); (3) `snapshot.html` is unchanged (OQ-45 b: not included).
- This branch contains the T-034 commits (T-035 depends on T-034); merge T-034's PR first.
