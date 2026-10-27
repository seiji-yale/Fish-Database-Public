# T-034 — Feeding Schedule page

|                  |                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------ |
| State            | Done                                                                                 |
| Size             | L                                                                                    |
| Phase            | 5 (Feeding Schedule & restricted view)                                               |
| Depends on       | T-033 (and T-032 for the restricted shell; rebase on whichever merges second)        |
| Depends on OQ    | OQ-45 a (bottom tab / top nav entry — default: account menu + Dashboard button only) |
| Branch           | `ticket/T-034-feeding-schedule-page`                                                 |
| Owner acceptance | required on preview URL (phone + laptop)                                             |

## Goal

The monthly calendar the lab uses today, in the app: who feeds on which day at a glance, editable in
two taps by Feeders, Members and Admins, with month totals, history per day and the repeat-week helper.

## Scope

- Route `/feeding` (`App.tsx`), `FeedingSchedulePage`, components `FeedingCalendar`, `FeedingDayCell`,
  `FeedingDayDialog`, `FeedingTotals`, `FeedingNotesBlock` (read side; the setting is edited in T-035),
  `RepeatWeekDialog`; `app/src/feedingApi.ts`.
- Navigation: Dashboard fourth button **Feeding Schedule** (FR-FEED-01 a, by `can('feeding.read')`),
  account menu item (FR-FEED-01 b). Phone: `Grid | List` toggle (`?view=`), `?month=` in the URL.
- Day dialog: feeder select, note (≤ 200, counter), Save/Cancel, `Last changed by …`, `Show history`;
  clearing asks for confirmation; 409 handling with the BR-12 wording and a Reload action.
- Unassigned warning for today … today + 13 (FR-FEED-06); Today marker (FR-FEED-05); focus refresh (FR-FEED-09).
- Repeat this week (FR-FEED-15) — Step 4, may be deferred by the owner without blocking the ticket.
- Strings block `// Feeding Schedule (T-034)`; CSS block in `base.css`; Playwright specs
  (`feeding.spec.ts` read-only at three widths, `feeding.write.spec.ts` for edits; synthetic feeder names).
- Docs: `04-ui-spec.md` new section "Feeding Schedule" (from spec §5.1 – §5.4), §8 component inventory, §9 copy; `user-guide.md` "Feeding Schedule" section with screenshots; `01-requirements.md` FR-GLB-01 and FR-DASH-06 notes.

## Out of scope

- Export menu, CSV, print view, Notes & links editing (T-035). Events UI (T-037): the cell shows event labels if any exist, the dialog's events section arrives in T-037.

## Spec references

`docs/08-feeding-schedule-and-guest-access.md` §3.1 – §3.3 (FR-FEED-01 … 15), §5.1 – §5.4, §5.7, BR-13, BR-14, BR-17 · `docs/04-ui-spec.md` §1 principles, §2 shell · NFR-01.

## Steps

### Step 1 — Page skeleton, month navigation, read-only grid (desktop + tablet)

**Tasks**

- `/feeding` route; `feedingApi.ts` (`getMonth`); header with Previous / Month / Next / Today / month picker; Sunday-first grid from `monthGrid`; names, `—`, Today marker, Unassigned text; totals panel; notes block (read).
- Navigation entries (Dashboard button, account menu) by capability; `NotAvailablePage` for Guests (from T-032).
  **Done when**
- 768 and 1280 px: October 2026 renders with the 1st on Thursday; URL changes with the month; Guest sees Not available.
  **Review focus**
- C: grid is a `<table>` with `scope="col"` headers or an ARIA grid with labelled cells; no colour-only meaning.

### Step 2 — Phone layouts

**Tasks**

- `Grid | List` segmented control; compact grid at 375 px (7 columns, truncated names, `•` event marker); List view grouped by week; totals and notes stack.
  **Done when**
- 375 px: no horizontal scroll; every cell ≥ 44 px tall; List shows all days with full names.
  **Review focus**
- C: tap targets; truncation only on phones; `?view=` kept.

### Step 3 — Day dialog: set, clear, note, history, conflicts

**Tasks**

- `FeedingDayDialog` on `Modal`; assignable list from the month response; `PUT` with `expectedAssignmentId`; optimistic update of cell + totals; toast; `ConfirmDialog` for clearing; 409 → `feeding_conflict` message + Reload; `Show history` list.
- `feeding.write.spec.ts`: set, change, clear, conflict (two contexts).
  **Done when**
- All of FR-FEED-10 … 14 observable; e2e green.
  **Review focus**
- C: focus returns to the cell; labels on every input; error text from `strings.ts`.

### Step 4 — Repeat this week (Should-have)

**Tasks**

- Week-row `⋯` menu (desktop) / week heading action (List) → `RepeatWeekDialog` with dry-run preview, overwrite checkbox, Apply; refresh month after apply.
  **Done when**
- Preview counts equal the server's dry run; assigned days kept unless overwrite.
  **Review focus**
- A: scope — nothing beyond FR-FEED-15.

### Step 5 — Docs, screenshots, preview

**Tasks**

- UI spec section, component inventory, copy table; user guide section + screenshots (synthetic names); `STATUS.md`.
  **Done when**
- Owner acceptance below; `npm run check` + e2e green at three widths.
  **Review focus**
- D: glossary terms (Feeder, Feeding Schedule, Assignment, Schedule event) used consistently.

## Acceptance criteria (owner verifies on preview)

1. Dashboard shows a **Feeding Schedule** button (Member, Admin, Feeder; not Guest); the account menu has the same item; both open the current month.
2. Phone (375 px): the grid shows seven columns without horizontal scrolling; tapping a day opens the dialog; choosing a name and Save updates the cell and the totals; the List view shows full names.
3. Laptop: Previous / Next / Today / month picker work and update the URL; today is marked `Today`; the next 14 days without a feeder say `Unassigned`.
4. Two browsers: change the same day in both — the second save says the day was changed by the other person and offers Reload; `Show history` lists both values with names and times.
5. Repeat this week fills the remaining empty days of the month with the week's pattern and reports how many it filled and kept.
6. Guest link: `/feeding` shows "Not available in the Guest view".

## Review Log

<!-- Append Step Reports, Step Reviews, Ticket Review, Owner feedback here, newest at the bottom. -->

### Steps 1 to 5 — 2026-10-26 — implementer

- Step 1 and 2: `/feeding` (`FeedingSchedulePage`), `feedingApi.ts`, `feedingView.ts` (URL, unassigned rule, local totals, linker; unit-tested), `FeedingCalendar` with `FeedingDayCell` (a `<table>` with column headers; every day a button with an accessible name; `Today`, `Unassigned` and the note mark are words or marks, not colour), `FeedingTotalsPanel`, `FeedingNotesBlock` (read side). Dashboard fourth button and the account-menu first item appear by `can('feeding.read')`; a Guest gets the standard Not available screen. The calendar takes the full window width (`.content-container:has(.feeding-page)`), otherwise names were cut off on a laptop. Phones: seven compact columns with truncated names and a dot for events; `Grid | List` (`?view=list`); every cell is at least 44 px tall (tested at the three widths).
- Step 3: `FeedingDayDialog` on `Modal`: feeder select, note with counter, `Last changed by`, `Show history` (loaded when opened), clearing through `ConfirmDialog`, 409 with the server's wording and `Reload this day`, 400 mapped to one message. Focus returns to the day (tested).
- Step 4: `RepeatWeekDialog`: a dry run on open and whenever the checkbox changes, Apply disabled until the counts are in, a toast with the result; the week menu is a `⋯` `RowMenu` (desktop, tablet) or a button beside the week heading (List).
- Step 5: `04-ui-spec.md` section 8, glossary (Feeding Schedule, Assignment, Schedule event). The ticket also names `user-guide.md` and `01-requirements.md` notes; the user guide does not exist in this public repository, and the FR-GLB-01 / FR-DASH-06 text lives in `docs/08-feeding-schedule-and-guest-access.md`, which already states both entries.
- Tests: `app/src/feedingView.test.ts`; `tests/e2e/feeding.spec.ts` (navigation, October 2026 layout, URL, Today, Unassigned, List view, Guest) and `feeding.write.spec.ts` (set, change, clear with confirmation, history, conflict between two people, Repeat this week), each at 375 / 768 / 1280 px, in months of their own so the three projects do not meet.
- Deviations: (1) the cell and totals are updated from the server's answer to the save (a few milliseconds) rather than before it, so a refused save never flickers; (2) the event labels show in the cell, but the events section of the dialog arrives with T-037; (3) `Export` and the print view arrive with T-035, so the page head has only `Today`; (4) a person who is no longer active but still holds the day appears in the select as `Name (not active)` so the day does not look empty; saving that person again is refused by the server (BR-14).
- Checks: `npm run check`, `check:public` green; the whole browser suite (`playwright test`) green on the final build.
- For the owner (preview, phone and laptop): acceptance 1 to 6 of this ticket.

### Owner feedback on the first preview — 2026-10-26

Acceptance went as expected; four changes were asked for and made:

1. **Navigation:** a Feeding Schedule link in the header (top navigation, and the phone tab bar) for roles with `feeding.read`. On tablets the header link gap is a little smaller so the long-app-name layout still fits.
2. **Upright screens:** the totals (and Notes & links) sit under the calendar unless the window is at least 1024 px wide **and** landscape, so the calendar keeps the whole width.
3. **Repeat this week:** the week row's `⋯` menu is now a circular-arrow icon button (name and tooltip `Repeat this week… (Week of …)`); the List view keeps its text button.
4. **Month box:** the visible `Month Year` heading next to the month box is gone (it stays for screen readers); the box itself names the month. On a phone Previous, the box and Next share one row.

E2E added: the header link at each width, one month box, totals under the calendar when upright (a 1024 x 1366 window) and beside it when landscape. Full browser suite green (388 tests).
