# T-035 — Monthly summary export (CSV + PDF) and Notes & links setting

|                  |                                                                       |
| ---------------- | --------------------------------------------------------------------- |
| State            | Draft                                                                 |
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
