# UI guide

The client has Dashboard, Lines, Line Detail, New Line, and Settings pages. Forms use labels, visible
focus, text status indicators, and responsive layouts. The browser tests exercise phone, tablet, and
desktop widths.

## 4. Line list

Show searchable lines with status and summary details. Narrow screens use cards; wider screens use
a table. A line opens its detail page.

Restricted roles (Guest, Feeder) see nine columns (Line, Gene, Phenotype(s), DOB, Status, ID Method,
Last ID Date, IDed Number, Reference(s)), the ID Method filter only, an `Age (months)` column toggle,
and no Cryopreserved filter, Breed soon indicator or Export CSV.

## 5. Line detail

### 5.1 Summary

Show name, status, birth date and age, identification count and date, cryopreservation summary,
notes, and other attributes.

### 5.2 Identification

Show protocol cards, fields, image attachments, a Sequence files list (name, size, the note under the name, download; edit note and remove icons
for editors; no preview). Upload, remove, copy, open/download and the History actions are icon buttons
with a name and a tooltip; removing a file asks first and genotyping history.

### 5.3 Cryopreservation

Show each freezer record with date, place, range, count, and unknown-details state.

### 5.4 References

Show linked documents and attachments.

### 5.5 Activity

Show dated events and breeding-cycle actions.

### 5.7 History

Show version snapshots and the actor responsible for each change.

### 5.8 Restricted view

Guests and Feeders get one overview card instead of sections 5.1 to 5.7: name, status and gene, then
DOB, age, IDed number, last ID date, current ID method names and phenotypes, then the references with
`Open`. There is no Edit, Change Activity, Export, section bar or side panel, and one line of hint:
`Guest view: details, records and history are not shown.` (Feeders: `Overview only.`).

The Dashboard shows the greeting, the Active, Closed and Cryopreserved counters and the buttons
`See Active Lines` and `See All Lines`. The header has `Dashboard` and `Lines` only: no New Line, Lab
Chat or Settings. `/settings`, `/lines/new`, `/lines/:id/print` and `/feeding` (for roles without it)
show one "Not available" screen with a `Back to Dashboard` link.

## 6. New line

Collect core fields and optional child records in a responsive form. Validate before saving.

## 7. Settings

Admins manage members, lists, preferences (including the Feeding Schedule notes & links) and exports. Ordinary members do not see administrative actions.

## 8. Feeding Schedule

Page `/feeding` (T-034), for roles with `feeding.read` (Feeders, Members, Admins). Guests see the
standard "Not available" screen. It is reached from the header (top navigation, and the tab bar on phones),
the fourth button of the Dashboard navigation row and the first item of the account menu.

- **Month and URL.** `?month=2026-10` (default: the current month in `America/New_York`) and, on phones,
  `?view=list`. Previous, Next, Today and one month box (which also names the month; there is no second
  "Month Year" heading, only a hidden one for screen readers) move between months without reloading; the
  address follows, so a month can be bookmarked. The page reads the month again when the window regains
  focus (not while a dialog is open).
- **Calendar.** A table, Sunday first, with column headers; days outside the month are blank. Each day is
  one button (at least 44 px tall): the day number, the feeder's name, `—` when nobody is assigned, `Unassigned`
  with a warning mark from today through today + 13 days, `Today` on today's cell (outline and word), a note
  mark, and event labels. Phones (under 640 px) show seven compact columns with truncated names and a dot for
  events, plus a `Grid | List` switch; the List shows every day as `Thu 1 · Feeder One · event`, grouped by week.
  The calendar uses the full window width. The totals and Notes & links sit beside the calendar only on a wide
  window held landscape (1024 px and up); held upright they sit under it, so the calendar keeps the whole width.
- **Day dialog.** Title `Thursday, 2026-10-01`; a `Feeder` select (`— Nobody —`, then the assignable people by
  name), a `Note` field with a counter (200 characters), `Cancel` and `Save`, the line `Last changed by … on …`
  and a `Show history` expander listing every earlier value (who set it, when, and who replaced it). Clearing an
  assigned day asks for confirmation. If someone else changed the day meanwhile the save is refused with
  "This day was changed by … at …" and a `Reload this day` button; the dialog then shows the new value.
  A save updates the cell and the month totals at once and shows a toast. Focus returns to the day.
- **Totals and Notes & links.** The panel lists, for each person, days with weekday and weekend counts, and the
  unassigned days; the numbers come from the same function as the server (BR-16). Notes & links shows the
  setting `feeding_schedule_notes` with web addresses as links; it is edited in Settings (T-035).
- **Repeat this week.** A circular-arrow button at the end of each week row (desktop and tablet) or a text button
  beside the week heading (List view): a dialog
  that previews "Will fill N empty days; M already assigned days are kept", with `Also replace assigned days`
  (off by default), then `Apply`. Only days after that week are filled.

- **Export (T-035).** For roles with `feeding.export`, an `Export` menu next to `Today` (on phones it floats at
  the bottom right, like Line Detail): `Export as CSV` downloads `feeding-schedule_YYYY-MM.csv` (UTF-8 with a
  byte order mark; a `Section` column; one `day` row per calendar day, then `total` rows per person and an
  `Unassigned` row), and `Export as PDF` opens the print page.
- **Print page** `/feeding/print?month=YYYY-MM`, outside the app shell: the title `Feeding Schedule — October
2026`, the calendar with full names and event labels, the totals, Notes & links, and the footer
  `Generated YYYY-MM-DD HH:mm by <name>`. It opens the browser's print dialog, set to landscape; Save as PDF
  gives one page. Roles without `feeding.export` get the Not available screen.
- **Notes & links.** An Admin edits the text in Settings → Preferences (`Feeding Schedule notes & links`, at most
  2000 characters, plain text; empty removes the block). The block on the page shows an `Edit` link to
  Preferences for Admins. Saving writes a `settings_changed` activity that says the notes changed (not the
  text); Recent Activity lists line events only, so it does not appear there.

Component inventory: `FeedingSchedulePage`, `FeedingCalendar` (with `FeedingDayCell`), `FeedingDayDialog`,
`FeedingTotalsPanel`, `FeedingNotesBlock`, `RepeatWeekDialog`, `FeedingPrintPage`. Copy is in `app/src/strings.ts` under
`// Feeding Schedule (T-034)`.
