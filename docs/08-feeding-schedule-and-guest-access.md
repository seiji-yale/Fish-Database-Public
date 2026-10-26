# Fish-Database — Feeding Schedule and Restricted Guest View (Requirements v1.1)

|               |                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version       | 1.1 (owner decisions of 2026-10-09 applied, including OQ-41 … OQ-44; see §0 and the change log)                                                                                                                                                                                                                                                           |
| Date          | 2026-10-09                                                                                                                                                                                                                                                                                                                                                |
| Owner         | Product owner                                                                                                                                                                                                                                                                                                                                             |
| Status        | **APPROVED FOR TICKETING** — tickets T-031 … T-037 are `Draft` until the owner sets them `Ready` (`tickets/README.md`). OQ-41 … OQ-44 decided 2026-10-09. OQ-45 stays open on its defaults.                                                                                                                                                               |
| Scope         | Two extensions of the launched v1 application: (A) a **Feeding Schedule** (monthly calendar: who feeds the fish on which day) with a new **Feeder** role, and (B) a **restricted view** for Guests (and Feeders) that shows a line's name, status and overview but none of its protocols, records, history, chat or activity.                             |
| Precedence    | This document has the same standing as `01-requirements.md` for the requirement IDs it defines (`FR-FEED-*`, `FR-GUEST-*`, `U-4`, `BR-13 … BR-19`). Where it clarifies existing behaviour it names the ID it changes. The implementing tickets fold the stable parts into `01-requirements.md`, `03-data-model.md`, `04-ui-spec.md`, `05-import-spec.md`. |
| Language rule | The application, its data, and every project document are English only (NFR-10).                                                                                                                                                                                                                                                                          |

Requirement IDs are stable and referenced by tickets and tests. Do not renumber; mark obsolete items `(withdrawn)`.

---

## 0. Owner decisions that shaped this document (2026-10-09)

Recorded here so that an implementer never has to guess. Each decision is also folded into the requirement it affects.

| #   | Question                                                            | Decision                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | What does a Guest see of a line ("overview")?                       | Line name, Status, Gene, Phenotype(s), DOB / Age, IDed number, Last ID date, ID Method **name only**, References (links). **Not**: Cryopreserved flag or records, Notes, More attributes, ID protocol details (primers, sequences, images), genotyping timeline, History, Chat, Recent Activity.                                                 |
| D2  | Guest Dashboard                                                     | Greeting + counters (Active lines, Closed lines, Cryopreserved lines) + navigation buttons. No Upcoming / Currently Breeding, no Recent Activity, no Unread messages, no Open requests, no Lab Chat.                                                                                                                                             |
| D3  | Does a Guest see the Feeding Schedule?                              | **No.** Feeder, Member and Admin only (the Guest link is passed around; the schedule names people).                                                                                                                                                                                                                                              |
| D4  | Who edits the schedule?                                             | Admin, Member and Feeder may all set or clear **any** day (swaps must be easy).                                                                                                                                                                                                                                                                  |
| D5  | Import of the current Google Sheet                                  | Import with a one-time developer tool (dry run → apply, as T-004). **Production** gets only the three current Feeders as new users: **Feeder One, Feeder Two, Feeder Three**. Former feeders (Former One, Former Two, Former Three, Former Four, Former Five) may be created on local/preview for development and dry runs, never on production. |
| D6  | Monthly summary content                                             | Calendar table (date, weekday, feeder, note, events) **plus** per-person day counts with weekday / weekend split.                                                                                                                                                                                                                                |
| D7  | Dashboard panel                                                     | Only a **Feeding Schedule** button (no "today's feeder" panel).                                                                                                                                                                                                                                                                                  |
| D8  | Footer of the sheet (emergency contact, protocol links)             | An Admin-editable **Notes & links** block on the schedule page, stored in `settings` (never in the repository).                                                                                                                                                                                                                                  |
| D9  | How do Feeders communicate?                                         | Feeders cannot chat (same as Guest). Each day has an optional short **note** (e.g. "swap with Feeder Two").                                                                                                                                                                                                                                      |
| D10 | `November2026` / `December2026` cells `Member Two ×4, Feeder Three` | Both are template leftovers. **Not imported**; the owner clears them in the sheet before the production import (§7.4).                                                                                                                                                                                                                           |

---

## 1. Purpose and success criteria

### 1.1 Purpose

The lab's fish must be fed every day of the year. Today the roster lives in a Google Sheet (one tab per month, a 7-column calendar with one first name per day, see §7.1). The sheet is hard to read on a phone, lets names sit in cells without a date, and has no record of who changed what. Moving it into Fish-Database gives one URL for everything fish-related, a phone-friendly calendar, change history, monthly summaries, and a Dropbox copy.

Undergraduate feeders join and leave two or three times a year and must not see genotyping protocols, cryopreservation stock or lab discussions. The same restriction applies to the shareable Guest link. Hence the second part of this extension: a **restricted view** enforced by the server, not only hidden by the client.

### 1.2 Success criteria

1. A Feeder signs in on a phone, opens **Feeding Schedule** from the account menu, sees the current month with a name on every day, and can change today's or any other day in two taps (pick a name → Save). The change is visible to everyone within one reload and shows who changed it.
2. The product owner exports **October 2026** as CSV and PDF; the PDF prints the calendar on one page with the per-person totals and the notes block; the CSV opens in Excel with the same numbers.
3. A browser opened with the Guest link can open a line and read its name, status, gene, phenotypes, DOB, IDed number, ID method name and references, but **every** attempt to fetch protocols, cryo records, history, chat, recent activity or an image file — including hand-made API calls — is refused by the server.
4. Settings → Users offers the role **Feeder**; adding a Feeder and sending the invite takes the same steps as adding a Member; removing one deactivates them and keeps their name on past days.
5. The Dropbox mirror (`fish-database.json`, `feeding_assignments.csv`) contains every assignment within 5 minutes of a change, and `restore_from_export.py` restores them.
6. The Google Sheet's visible months (October–December 2026) are imported into production without any unknown name, and the sheet is then retired to read-only.

### 1.3 Out of scope (this extension)

- Reminders or notifications (e-mail, push) about feeding duty or about a repeated event (OQ-44, decided: none).
- Recording feed amounts (the master sheet's `Feeding Management` tab with feed weights stays out of scope, OQ-7(d)).
- A general recurrence engine (monthly, every N days, exceptions, "repeat forever"). Weekly repeat of one schedule event is in scope (FR-FEED-22, BR-19).
- Importing the sheet's events (`Test Water Quality`, `Inspection`) — owner decision: names only.
- Per-line permissions, or a fourth level between Member and Feeder.
- Changing what **Members** see: Members and Admins keep the full view.

---

## 2. Users and roles

### 2.1 Roles (replaces the table in `01-requirements.md` §2)

| Role       | Who                                                                                  | Can do                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin**  | people an Admin makes Admin                                                          | Everything a Member can do; plus users/invites/roles, enumerations, settings (incl. the schedule's Notes & links block), restore, export, read-only mode.                                                                                                                             |
| **Member** | people an Admin makes Member                                                         | Full view of every line; edit line data; chat; **view, edit and export the Feeding Schedule**.                                                                                                                                                                                        |
| **Feeder** | **new** — Feeder One, Feeder Two, Feeder Three (initially); rotates 2–3 times a year | **View, edit and export the Feeding Schedule.** Otherwise exactly the Guest view: line overview only (§4), no chat, no line edits, no exports of line data. Signs in with a personal account through an invite (ADR-0005), can change their own password. Cannot copy the Guest link. |
| **Guest**  | anyone with the Guest link (built-in `Guest` user)                                   | **Line overview only** (§4). No Feeding Schedule, no chat, no history, no activity, no exports, no image files. Needs no password.                                                                                                                                                    |

U-4 **Feeder role (new).** `users.role` gains the value `feeder`. A Feeder is created, invited, renamed, deactivated and reactivated exactly like a Member (FR-ADM-01, U-2). A deactivated Feeder is signed out at once; their name stays on every past assignment. Changing a person's role between Member, Admin and Feeder is allowed at any time (the "last active Admin" guard still applies); existing assignments are unaffected.

### 2.2 Capability model (BR-15)

Permissions are expressed as **capabilities** decided in one pure module (`domain/permissions.ts`), used by both the API (enforcement) and the client (what to render). A route never tests `role === 'guest'` directly; it asks `can(role, capability)`.

| Capability               | admin | member | feeder | guest | Meaning                                                                                                                                  |
| ------------------------ | :---: | :----: | :----: | :---: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `lines.read_overview`    |  yes  |  yes   |  yes   |  yes  | Line List and Line Detail in overview shape (§4.2).                                                                                      |
| `lines.read_full`        |  yes  |  yes   |   no   |  no   | Protocols, cryo, genotyping records, references with files, notes, attributes, history, versions, last update, full Dashboard.           |
| `lines.write`            |  yes  |  yes   |   no   |  no   | Every line write route (unchanged: `requireAuthor(c, 'data')`).                                                                          |
| `lines.export`           |  yes  |  yes   |   no   |  no   | `GET /api/lines.csv`, `GET /api/lines/:id.csv`, `/lines/:id/print`, Admin ZIP.                                                           |
| `attachments.read_files` |  yes  |  yes   |   no   |  no   | `GET /api/attachments/:id/file` for gel / fluorescence / sequence images and staged uploads.                                             |
| `attachments.read_refs`  |  yes  |  yes   |  yes   |  yes  | `GET /api/attachments/:id/file` for `kind = 'reference_file'` only (References are part of the overview, D1).                            |
| `activity.read`          |  yes  |  yes   |   no   |  no   | `GET /api/activities`, Recent Activity, line History.                                                                                    |
| `chat.read`              |  yes  |  yes   |   no   |  no   | Every `GET /api/chat/*`, unread counts, open requests, Lab Chat header link. _(Changes FR-CHAT-02 / OQ-40: Guests no longer read chat.)_ |
| `chat.write`             |  yes  |  yes   |   no   |  no   | Unchanged (`requireAuthor(c, 'chat')`).                                                                                                  |
| `users.list`             |  yes  |  yes   |  yes   |  no   | `GET /api/users` (pickers). Feeders need it for nothing else than the schedule, which returns its own list; Guests get 403.              |
| `feeding.read`           |  yes  |  yes   |  yes   |  no   | `GET /api/feeding*`, the `/feeding` page.                                                                                                |
| `feeding.write`          |  yes  |  yes   |  yes   |  no   | Set / clear / note any day; repeat-week helper; schedule events.                                                                         |
| `feeding.export`         |  yes  |  yes   |  yes   |  no   | Monthly CSV and print view.                                                                                                              |
| `admin.*`                |  yes  |   no   |   no   |  no   | Unchanged (`requireAdmin`).                                                                                                              |

Rules:

- BR-15 **Server first.** Every capability is enforced in the Worker. The client uses the same table only to hide controls; hiding is never the protection. A refused call answers `403 FORBIDDEN` with the plain-English message _"This is not available in the Guest view."_ (Feeders get the same message; the UI never shows them a path to it).
- **Allow-list shaping.** When a role lacks `lines.read_full`, the API builds the response from an explicit list of allowed fields (`toLineOverview`), never by deleting fields from the full document. A new field added to the full document is therefore hidden from restricted roles by default.
- **Route coverage test.** A test enumerates every registered `/api` route and asserts its classification (`open` · `overview` · `full` · `feeding` · `admin` · `write`), signed in as each of the four roles. An unclassified route fails the test (same idea as T-027's "every write route refuses Guest").

---

## 3. Feeding Schedule — functional requirements

### 3.1 Navigation and access

| ID         | Requirement                                                                                                                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-FEED-01 | Page `/feeding` titled **Feeding Schedule**. Reachable from (a) a **Feeding Schedule** button in the Dashboard navigation row (FR-DASH-06 gains a fourth button) and (b) a **Feeding Schedule** item in the header account menu (FR-GLB-01). Both appear only for roles with `feeding.read`. |
| FR-FEED-02 | Opening `/feeding` without `feeding.read` shows the standard "not available in the Guest view" page (no redirect loop); the API answers 403.                                                                                                                                                 |
| FR-FEED-03 | The URL carries the month: `/feeding?month=2026-10` (default: the current month in `America/New_York`). `?view=grid                                                                                                                                                                          | list` keeps the phone layout choice (§5.3). Bookmarkable. |

### 3.2 Calendar (read)

| ID         | Requirement                                                                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-FEED-04 | **Month calendar** is the main view: 7 columns **Sunday → Saturday** (as the sheet), week rows, leading/trailing cells of other months blank. Header: `‹ Previous` · **Month YYYY** · `Next ›` · `Today` · a month picker (`<input type="month">`).        |
| FR-FEED-05 | Each day cell shows: day number, the **feeder's name** (or `—` when nobody is assigned), a note marker when a note exists, and event labels (FR-FEED-20). Today is marked with an outline **and** the word `Today` (not colour alone, NFR-01).             |
| FR-FEED-06 | **Unassigned warning:** a day from today through today + 13 days with no feeder shows the text `Unassigned` with a warning icon. Past unassigned days show `—` only.                                                                                       |
| FR-FEED-07 | **Month totals** panel beside/below the grid: for each person with at least one day in the month — `Name · N days (W weekdays, E weekend days)` — sorted by total desc then name; plus `Unassigned · N days` when > 0. Same numbers as the export (BR-16). |
| FR-FEED-08 | **Notes & links** block under the calendar: the text of `settings.feeding_schedule_notes` with URLs auto-linked (same linkifier as chat), line breaks preserved. Hidden when empty. Admins see an `Edit` link to Settings → Preferences.                   |
| FR-FEED-09 | The page refreshes its data when the window regains focus (same pattern as the Dashboard), so two people editing see each other's changes without pressing reload.                                                                                         |

### 3.3 Editing a day

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-FEED-10 | Tapping/clicking a day (roles with `feeding.write`) opens the **Day dialog**: date heading (`Thursday, 2026-10-01`), **Feeder** select (`— Nobody —` + assignable people, BR-14, sorted by name, current one preselected), **Note** (optional, ≤ 200 characters), `Save`, `Cancel`. Below: `Last changed by <name> on <YYYY-MM-DD HH:mm>` when a row exists; a `Show history` expander lists every previous value of that day (who, when, name, note).                                             |
| FR-FEED-11 | **One name per day (BR-13).** Saving replaces the day's assignment; choosing `— Nobody —` clears it. The server writes a new row and soft-closes the previous one (`replaced_at`); nothing is deleted (BR-7).                                                                                                                                                                                                                                                                                      |
| FR-FEED-12 | **Concurrency (BR-17).** The dialog carries the id of the assignment row it opened with; if the day changed meanwhile the save is refused with _"This day was changed by {user} at {time}. Reload to see the change, then try again."_ (BR-12 wording).                                                                                                                                                                                                                                            |
| FR-FEED-13 | Past days are editable (to record who actually fed). No confirmation is needed for a change; clearing an assigned day asks `Clear Thursday, 2026-10-01 (Feeder One)?`.                                                                                                                                                                                                                                                                                                                             |
| FR-FEED-14 | Every save shows a toast (FR-GLB-03) and updates the cell and the totals without a page reload.                                                                                                                                                                                                                                                                                                                                                                                                    |
| FR-FEED-15 | **Repeat this week** (Should-have, may ship in a later step): on a week row, an action `Repeat this week…` opens a dialog: `Fill the rest of {Month} with this week's pattern` — preview `Will fill N empty days; M already assigned days are kept`, checkbox `Also replace assigned days` (default off), `Apply`. Applied atomically on the server as ordinary replacements (one row per day, same history, same author). Days whose weekday has no feeder in the source week are left unchanged. |

### 3.4 Monthly summary export

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-FEED-16 | `Export ▾` on the page: **Export as CSV**, **Export as PDF** (roles with `feeding.export`).                                                                                                                                                                                                                                                                                                                                                                                                                       |
| FR-FEED-17 | **CSV** `GET /api/feeding/summary.csv?month=YYYY-MM`: UTF-8 with BOM, file name `feeding-schedule_YYYY-MM.csv`. One file, a `Section` column identifies the row type (as FR-EXP-02): columns `Section, Date, Weekday, Feeder, Note, Events, Weekday days, Weekend days, Total days`. `day` rows (one per calendar day of the month, in date order; `Feeder` empty when unassigned; `Events` joined with `; `) then `total` rows (one per person, then `Unassigned`) filling `Feeder` and the three count columns. |
| FR-FEED-18 | **PDF** = print view `/feeding/print?month=YYYY-MM` (FR-EXP-01 pattern, `window.print()`): title `Feeding Schedule — October 2026`, the calendar grid with full names and event labels (landscape, one Letter/A4 page for the grid), the totals table, the Notes & links block, footer `Generated YYYY-MM-DD HH:mm by <name>`. No navigation chrome.                                                                                                                                                              |
| FR-FEED-19 | The month's numbers in the page panel (FR-FEED-07), the CSV and the PDF are produced by the same domain function (BR-16).                                                                                                                                                                                                                                                                                                                                                                                         |

### 3.5 Other schedule events (future-proofing, owner request)

The sheet carries non-feeding entries (`Test Water Quality` on Mondays, `Inspection` on 2026-01-14). They are **not imported** now, but the model and a minimal UI exist so that such entries can be written from day one.

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-FEED-20 | A day may carry **zero or more events**: `title` (1–60 characters, free text; the input suggests titles used before), optional `note` (≤ 200). Shown as a small label under the feeder's name in the cell and listed in the Day dialog.                                                                                                                                                                                                                                                                                                                                                                             |
| FR-FEED-21 | Roles with `feeding.write` add, edit and remove (soft) events from the Day dialog. Every change records who/when; removed rows keep `deleted_at`. **Remove** asks for confirmation. When the event belongs to a series and a later occurrence still exists, the confirmation offers two actions: **Delete this event** and **Delete this and all following (N)** (N = later occurrences including this one). **Edit** of a series event offers the same two scopes: this event only, or this event and every later occurrence (title and note). A one-off event has a single Delete confirmation and a single edit. |
| FR-FEED-22 | **Weekly repeat (OQ-43, decided 2026-10-09).** Adding an event offers `Repeat weekly` plus a required **Repeat until** date (default: the last day of the month on screen). The server writes one row per occurrence (BR-19) and the dialog previews the count before saving (`Will add 8 events, every Monday until 2026-12-28.`). A one-off event is a row with no series. Events appear in the CSV `Events` column and the PDF grid, one label per day, whether or not they repeat. No notification is sent.                                                                                                     |

### 3.6 Administration

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-FEED-23 | Settings → Users: the role control offers **Member / Admin / Feeder** (add and change). The users table shows `Feeder` in the Role column. _(Extends FR-ADM-01.)_                                                                                                                                                                                                           |
| FR-FEED-24 | Settings → Preferences: **Feeding Schedule notes & links** — a textarea (≤ 2 000 characters, plain text, URLs are linked when displayed) saved as `settings.feeding_schedule_notes`; writes a `settings_changed` activity (existing type). The value is included in the Dropbox export and `snapshot.html`'s settings, never in repository fixtures. _(Extends FR-ADM-03.)_ |
| FR-FEED-25 | Settings → Data & Backup: nothing new to configure; the export/mirror/restore include the schedule (FR-FEED-26 … 28).                                                                                                                                                                                                                                                       |

### 3.7 Mirror, export, restore

| ID         | Requirement                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-FEED-26 | `fish-database.json` gains top-level `feedingAssignments` and `scheduleEvents` arrays (all rows incl. replaced/deleted ones, as `lineVersions` does) and `settings.feeding_schedule_notes`. Older exports without them restore with empty lists (`.default([])`). |
| FR-FEED-27 | New CSVs in the mirror: `feeding_assignments.csv`, `schedule_events.csv` (same `plain()` builder as the other entity CSVs). `users.csv` shows the `feeder` role.                                                                                                  |
| FR-FEED-28 | `tools/import/restore_from_export.py` restores both tables and the setting (count check per table). The mirror's `README.txt` lists the new files. `snapshot.html` **may** include the current and next month (Should-have; OQ-45 b).                             |
| FR-FEED-29 | Every successful `/api/feeding*` write marks the mirror dirty (existing `mirrorDirtyMarker` middleware covers it automatically — verify in a test).                                                                                                               |

---

## 4. Restricted view — functional requirements (Guest and Feeder)

"Restricted role" below = a role without `lines.read_full` (today: `guest`, `feeder`).

### 4.1 Global

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-GUEST-01 | The restricted view is produced by the **server** (BR-15). The client renders what it receives; it also hides controls for capabilities the role lacks, using the same `can()` table.                                                                                                                                                                                                        |
| FR-GUEST-02 | Header for restricted roles: app name, navigation `Dashboard · Lines` (no `New Line`), **no Lab Chat link, no unread badge**, account menu (Guest: `Sign out`; Feeder: `Feeding Schedule`, `Change password`, `Sign out`). The Guest banner `Guest view: read only` stays for Guests; Feeders see no banner. Phone bottom tabs: `Dashboard · Lines · Search` (Feeder: + `Feeding`, OQ-45 a). |
| FR-GUEST-03 | **Search** (FR-GLB-05, T-026) for restricted roles matches line name, gene and phenotype only (not notes).                                                                                                                                                                                                                                                                                   |
| FR-GUEST-04 | A refused page (`/settings`, `/lines/new`, `/lines/:id/print`, `/feeding` for Guests) renders one standard screen: title `Not available in the Guest view`, one sentence, a `Back to Dashboard` link. Direct API calls get 403.                                                                                                                                                              |

### 4.2 Line overview shape

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-GUEST-05 | **Line List** (`GET /api/lines`) for restricted roles returns, per line, exactly: `id, name, gene, phenotypes, dob, ageMonths, status, idMethod` (display name of the primary current method, e.g. `PCR`, `PCR + Sequence`, `Fluorescence`, `None`), `idMethodTypes` (names only), `lastIdDate, idedNumber, references` (`id, title, url, hasAttachment`), `missingDob`. **Not** returned: `isCryopreserved, cryoSummary, needsBreeding, notes, lastUpdateAt, lastUpdateBy, attributes`. The response carries `restricted: true`.                                         |
| FR-GUEST-06 | Line List page for restricted roles: columns `Line · Gene · Phenotype(s) · DOB · Status · ID Method · Last ID Date · IDed Number · Reference(s)`; the `Columns ▾` toggle offers only `Age (months)`; Filters panel shows `ID Method` only (no Cryopreserved, no Breed soon); the segmented `Active                                                                                                                                                                                                                                                                        | All | Closed`control stays; **no`Export CSV`button**; no`Breed soon` indicator. Phone cards drop the Cryopreserved line. |
| FR-GUEST-07 | **Line Detail** (`GET /api/lines/:id`) for restricted roles returns the **overview document**: `id, name, status, gene, phenotypes[], dob, ageMonths, idedNumber, lastIdDate, idMethods[] ({label, typeName})` — label and type name of each current protocol, nothing else of the protocol — and `references[]` (`id, title, url, hasAttachment`). No `version`/`ETag`, no `notes`, `attributes`, `breedingStartedAt`, `closedAt/closedReason`, `createdAt/By`, `updatedAt/By`, `protocols`, `cryoRecords`, `cryoUses`, `genotypingRecords`, `versions`, `chatMessages`. |
| FR-GUEST-08 | Line Detail page for restricted roles: **Summary card only** — title row (name, status badge, gene), grid DOB · Age · IDed number · Last ID date · Current ID method(s) · Phenotypes (chips), then **References** list (title + `Open`; uploaded reference files open through `attachments.read_refs`). No `Edit`, no `Change Activity`, no `Export ▾`, no section jump bar, no side panel. A one-line hint: `Guest view: details, records and history are not shown.` (Feeders see the same page without the word Guest: `Overview only.`)                               |
| FR-GUEST-09 | **Dashboard** (`GET /api/dashboard`) for restricted roles returns `{ today, restricted: true, counters: { active, closed, cryopreserved } }` only. The page shows `Hello, <name>` (+ the Guest hint for Guests), the three counters (linking to the Line List views), and navigation buttons `See Active Lines · See All Lines` (+ `Feeding Schedule` for `feeding.read`; never `Add New Line`). _(Changes FR-DASH-02 … 07 for restricted roles.)_                                                                                                                        |
| FR-GUEST-10 | Refused for restricted roles (403): `GET /api/lines.csv`, `GET /api/lines/:id.csv`, `GET /api/activities`, every `GET /api/chat/*` and chat count endpoint, `GET /api/attachments/:id/file` unless the attachment `kind` is `reference_file` and it is not deleted, `GET /api/enumerations` (not needed), and for Guests `GET /api/users`. Existing write refusals (T-027) are unchanged.                                                                                                                                                                                 |
| FR-GUEST-11 | `GET /api/session` returns the role and the list of capabilities (`capabilities: string[]`) so the shell renders from one source. Guest-link rotation, invites, lockout and session rules are unchanged (ADR-0005).                                                                                                                                                                                                                                                                                                                                                       |

### 4.3 Things that stay as they are

- `snapshot.html` and the Dropbox mirror are lab-internal and keep full content (NFR-04). They are not reachable through the Guest link.
- Members and Admins see exactly what they see today.
- Password hashes never leave the database (NFR-07); `users.csv` and `/api/users` continue to use `publicUser`.

---

## 5. UI specification (extends `04-ui-spec.md`)

### 5.1 App shell additions

- Account menu (ADR-0005 menu): a new first item **Feeding Schedule** (roles with `feeding.read`), then the existing items. Guests: `Sign out` only.
- Header navigation and bottom tabs follow FR-GUEST-02. Admin header tint unchanged.
- Dashboard navigation row (FR-DASH-06): `See Active Lines · See All Lines · Add New Line · Feeding Schedule` for Members/Admins; `See Active Lines · See All Lines · Feeding Schedule` for Feeders; `See Active Lines · See All Lines` for Guests. Four equal buttons wrap to 2 × 2 on phones.

### 5.2 Feeding Schedule page `/feeding` — desktop (≥ 1024 px)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Feeding Schedule                                        [Export ▾] [Today]     │
│ ‹ Previous      October 2026   [2026-10 ▾]      Next ›                         │
├────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────────────┤
│  Sun   │  Mon   │  Tue   │  Wed   │  Thu   │  Fri   │  Sat   │ This month     │
├────────┼────────┼────────┼────────┼────────┼────────┼────────┤ Feeder One  13 d   │
│        │        │        │        │ 1      │ 2      │ 3      │  (9 wk, 4 we)  │
│        │        │        │        │ Feeder One │ Feeder Two   │ Feeder Two   │ Feeder Two    12 d   │
├────────┼────────┼────────┼────────┼────────┼────────┼────────┤ Feeder Three    2 d   │
│ 4      │ 5      │ 6      │ 7      │ 8      │ 9 Today│ 10     │ Unassigned 4 d │
│ Feeder One │ Feeder Three  │ Feeder One │ Feeder Three  │ Feeder One │ Feeder Two ✎ │ Feeder Two   │                │
│        │ Water  │        │        │        │        │        │ [Repeat week…] │
├────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────────────┤
│ Notes & links                                                    (Admin: Edit)│
│ Emergency? Contact … · Feeding Protocol · Water Quality Test                   │
└───────────────────────────────────────────────────────────────────────────────┘
```

- Cell = a button (≥ 44 px tall) with day number top-left, name on the second line, `✎` when a note exists (tooltip + visible in the dialog), event labels in small text. `Unassigned ⚠` text for the next 14 days.
- Week row end (desktop): a `⋯` menu (`RowMenu`) with `Repeat this week…` (FR-FEED-15).
- Status colours: today = outline + `Today`; unassigned-soon = amber-700 outline + text; no colour-only meaning.

### 5.3 Phone (< 640 px)

- Toggle `Grid | List` (segmented control, `?view=`). **Grid**: 7 compact columns (≈ 50 px each at 375 px), day number + name truncated with an ellipsis (full name in the dialog); event marker `•`. **List**: one row per day `Thu 1 · Feeder One · Test Water Quality` grouped by week, with a `Repeat this week…` action per week heading. Default: Grid (the owner asked for "at a glance"); the choice is remembered in the URL.
- Totals panel and Notes & links stack under the calendar. Export menu in the bottom action bar.

### 5.4 Day dialog (all widths)

`Modal` (focus trap, Escape, focus returns to the cell). Title `Thursday, 2026-10-01`. Fields: `Feeder` (native `<select>`: `— Nobody —`, then names), `Note` (text, counter `0/200`). Events section: list with `Edit` / `Remove`, `+ Add event` (Title with `<datalist>` of earlier titles, Note, checkbox `Repeat weekly` with a `Repeat until` date defaulting to the last day of the displayed month and a live preview line). A series event's Edit asks `This event only` / `This and all following` before saving; its Remove confirmation offers `Delete this event` and `Delete this and all following (N)`. Footer: `Cancel` · `Save`. Meta line `Last changed by Feeder Two on 2026-10-08 17:12` · `Show history`. Clearing an assigned day uses `ConfirmDialog`.

### 5.5 Print view `/feeding/print?month=YYYY-MM`

Landscape; header (title, month); grid with full names and events; totals table (`Name | Weekdays | Weekend | Total`); Notes & links; footer. Reuses `.print-view` styles from T-019.

### 5.6 Restricted-view screens

- **Line List** as FR-GUEST-06. **Line Detail** as FR-GUEST-08 (one card, no side panel). **Dashboard** as FR-GUEST-09.
- **Not available** screen (FR-GUEST-04): `EmptyState` with the title, hint and link.

### 5.7 Copy (canonical strings — add to `app/src/strings.ts` under `// Feeding Schedule (T-034)` and `// Restricted view (T-032)`)

| Key                      | Text                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| feeding_schedule         | Feeding Schedule                                                                    |
| feeding_nobody           | — Nobody —                                                                          |
| feeding_unassigned       | Unassigned                                                                          |
| feeding_today            | Today                                                                               |
| feeding_totals           | This month                                                                          |
| feeding_total_line       | {name} · {total} days ({weekdays} weekdays, {weekend} weekend days)                 |
| feeding_clear_confirm    | Clear {weekday}, {date} ({name})?                                                   |
| feeding_changed_by       | Last changed by {user} on {time}                                                    |
| feeding_conflict         | This day was changed by {user} at {time}. Reload to see the change, then try again. |
| feeding_repeat_week      | Repeat this week…                                                                   |
| feeding_repeat_preview   | Will fill {empty} empty days; {kept} already assigned days are kept.                |
| feeding_repeat_overwrite | Also replace assigned days                                                          |
| feeding_event_repeat     | Repeat weekly                                                                       |
| feeding_event_until      | Repeat until                                                                        |
| feeding_event_preview    | Will add {n} events, every {weekday} until {date}.                                  |
| feeding_event_this       | This event only                                                                     |
| feeding_event_following  | This and all following ({n})                                                        |
| feeding_event_delete     | Delete this event                                                                   |
| feeding_notes_title      | Notes & links                                                                       |
| feeding_export_csv       | Export as CSV                                                                       |
| feeding_export_pdf       | Export as PDF                                                                       |
| restricted_hint_guest    | Guest view: details, records and history are not shown.                             |
| restricted_hint_feeder   | Overview only.                                                                      |
| restricted_page_title    | Not available in the Guest view                                                     |
| restricted_page_body     | This page shows lab records that the Guest view does not include.                   |
| restricted_api           | This is not available in the Guest view.                                            |
| role_feeder              | Feeder                                                                              |

Component inventory additions: `FeedingCalendar`, `FeedingDayCell`, `FeedingDayDialog`, `FeedingTotals`, `FeedingNotesBlock`, `RepeatWeekDialog`, `FeedingPrintView`, `NotAvailablePage`, `LineOverviewCard`.

---

## 6. Data model (extends `03-data-model.md`)

Conventions as in `03-data-model.md`: TEXT ULID ids, ISO-8601 UTC timestamps, `YYYY-MM-DD` dates, booleans 0/1, soft delete.

### 6.1 `users.role` — add `feeder` (migration `0013_feeder_role.sql`)

`role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'feeder', 'guest'))`. SQLite cannot alter a CHECK constraint, so the table is **rebuilt** with the documented 12-step procedure (`CREATE TABLE users_new … ; INSERT INTO users_new SELECT … FROM users; DROP TABLE users; ALTER TABLE users_new RENAME TO users;` + recreate indexes). D1 keeps `PRAGMA foreign_keys` on and does not allow switching it off; the migration therefore starts with `PRAGMA defer_foreign_keys = true` so the many `REFERENCES users(id)` columns are checked at commit. The copy-aside order (copy rows to `users_copy`, drop `users`, create `users`, insert the rows back, drop `users_copy`) is required: the usual `users_new` + rename order leaves the deferred violations uncancelled and fails at commit (found in T-031). This is the project's first table rebuild: **rehearse it on the `rehearsal` environment with a production dump before touching production** (`docs/06-operations.md` §2.4, §4). The migration must leave `sqlite_master` with the same indexes on `users` as before (verify in `migrations.test.ts`).

### 6.2 `feeding_assignments` (migration `0014_feeding_schedule.sql`)

| column        | type                   | notes                                                                                                                               |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| id            | TEXT PK                |                                                                                                                                     |
| date          | TEXT NOT NULL          | `YYYY-MM-DD`, lab calendar date (BR-11); CHECK `date BETWEEN '2000-01-01' AND '2100-12-31'` and `date = strftime('%Y-%m-%d', date)` |
| user_id       | TEXT NOT NULL FK users | the feeder                                                                                                                          |
| note          | TEXT                   | ≤ 200 characters (checked in domain + `CHECK (length(note) <= 200)`)                                                                |
| imported_from | TEXT                   | traceability of the one-time import, e.g. `October2026!G7`; NULL for app writes                                                     |
| created_at    | TEXT NOT NULL          |                                                                                                                                     |
| created_by    | TEXT NOT NULL FK users | who set this value                                                                                                                  |
| replaced_at   | TEXT                   | NULL = the current value of the day. Set when a newer row replaces it, or when the day is cleared                                   |
| replaced_by   | TEXT FK users          | who replaced/cleared it                                                                                                             |

Indexes: `UNIQUE INDEX feeding_current_day ON feeding_assignments(date) WHERE replaced_at IS NULL` (BR-13, the lock for concurrent saves, like `UNIQUE(line_id, version_no)` in `withLineWrite`); `INDEX (date)`; `INDEX (user_id)`.

The table is **append-only**: the full history of a day is `SELECT … WHERE date = ? ORDER BY created_at`. No `activities` row is written (Recent Activity lists line-data events only, owner decision 2026-09-30; `activities.type` is CHECK-constrained and is not rebuilt for this).

### 6.3 `schedule_events` (same migration)

`id TEXT PK, date TEXT NOT NULL (same CHECKs), series_id TEXT` (NULL = one-off; the same value on every row of one weekly repeat, BR-19), `title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 60), note TEXT CHECK (length(note) <= 200), created_at, created_by FK users, updated_at, updated_by FK users, deleted_at, deleted_by FK users`. Indexes: `(date)`, `(series_id, date)`. Soft delete only. Edits update title and note in place — no before/after history (OQ-43). A series row keeps its `series_id` when edited, so a later "this and all following" still includes it.

### 6.4 `settings`

New key `feeding_schedule_notes` (plain text ≤ 2 000). Included in `exportSchema.settings` as `feeding_schedule_notes: z.string().nullable().optional()`.

### 6.5 Export shapes (extends `03-data-model.md` §6)

- `fish-database.json`: `feedingAssignments: row[]` (all rows), `scheduleEvents: row[]` (all rows), `settings.feeding_schedule_notes`.
- `feeding_assignments.csv`: `id, date, user_id, user_name, note, imported_from, created_at, created_by, created_by_name, replaced_at, replaced_by, replaced_by_name`.
- `schedule_events.csv`: all columns plus `created_by_name`, `updated_by_name`, `deleted_by_name`.
- Monthly summary CSV: FR-FEED-17 (not part of the mirror; downloaded on demand).

### 6.6 Domain modules (pure, 100 % branch coverage as the rest of `domain/`)

- `domain/permissions.ts`: `type Capability`, `can(role, capability)`, `capabilitiesOf(role)`, `isRestricted(role)` (= lacks `lines.read_full`), `ASSIGNABLE_ROLES = ['admin','member','feeder']`.
- `domain/feeding.ts`: `monthGrid(yearMonth)` → weeks of 7 cells (Sunday first, `null` padding) computed without `Date` timezone pitfalls (pure arithmetic on `YYYY-MM-DD`); `isWeekend(date)`; `weekdayName(date)`; `tally(days)` → per-user `{ weekdays, weekend, total }` + `unassigned`; `validateDayWrite({ userId, note })`, `validateEventWrite`, `validateMonth('YYYY-MM')`; `repeatWeekPlan(weekDays, monthDays, overwrite)` → list of `{ date, userId }` to write and counts for the preview; `repeatEventDates(start, until)` → the weekly dates of BR-19 (or a problem: `untilBeforeStart`, `tooMany`, `outOfRange`); `summaryCsvRows(month, days, users)`.
- `domain/lineOverview.ts`: `toLineListOverview(row)`, `toLineOverview(detailDocument)` — allow-list picks with explicit return types `LineListOverviewRow`, `LineOverviewDocument`.

---

## 7. Import of the Google Sheet (extends `05-import-spec.md`)

### 7.1 Source structure (inspected 2026-10-09)

Workbook `Feeding Schedule` (Google Sheets, link-readable; URL kept out of the repository and passed on the command line or downloaded as `.xlsx` by the owner). Tabs `January2026` … `December2026`; past months are hidden, the **visible tabs are the active months** (`October2026`, `November2026`, `December2026` at inspection time). Each tab:

| Cells                           | Content                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C4` / `D4`                     | Month name (formula from `C49`; cached text e.g. `October`) / year (`2026`)                                                                                                                                                           |
| `C5:I5`                         | `Sun Mon Tue Wed Thu Fri Sat`                                                                                                                                                                                                         |
| week block (5 rows, from row 6) | row _k_: day numbers (formulas, cached) in `C:I`; row _k+1_: **feeder first name** (data-validation list); row _k+2_: event text (`Test Water Quality` in `D`, `Inspection` …); two blank rows. Blocks at rows 6, 11, 16, 21, 26, 32. |
| `C41`                           | Emergency contact sentence (merged `C41:I41`)                                                                                                                                                                                         |
| `C42:D43`                       | `Useful Tips` → `Feeding Protocol` (hyperlink to a wiki page), `Water Quality Test`                                                                                                                                                   |
| `C48:C49` (or `C49:C50`)        | `Month` selector (1–12)                                                                                                                                                                                                               |
| data validation                 | names: `Feeder One, Feeder Two, Feeder Three, Member Two, Former Four, Member Four, Former Three, Member One, Member Three, Former One, Former Two` (earlier tabs: `… Former Five`)                                                   |

Known defects the tool must handle: name cells without a day number in the row above (e.g. `October2026!E7:F7`) and template leftovers on real dates (D10). The tool never writes to the sheet.

### 7.2 Mapping

| Sheet                                 | Database                                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tab `MonthYYYY` → day cell `n` + name | `feeding_assignments(date = YYYY-MM-n, user_id = user named <name> (case-insensitive, trimmed), imported_from = 'MonthYYYY!<cell>', created_by = <actor>, created_at = run time)` |
| name cell with no day number above    | **orphan** → listed in the report, skipped                                                                                                                                        |
| name not found among users            | **unknown name** → listed in the report; `apply` refuses unless `--create-missing-users` (creates them as **inactive** `feeder` users without password; development/preview only) |
| event text rows                       | not imported (owner decision); counted in the report for reference                                                                                                                |
| footer, `Month` selector, validations | not imported; the owner copies the footer text into Settings → Preferences (FR-FEED-24)                                                                                           |

### 7.3 Tool behaviour (FR-IMP-01 … 04 apply by analogy)

`python3 tools/import/feeding/import_feeding.py <workbook.xlsx> --months 2026-10,2026-11,2026-12 --env local|preview|production [--actor <Name>] [--create-missing-users] [--apply] [--yes]`

- Default is **dry run**: writes `import/work/feeding-report.md` (per month: days read, assignments found, orphans, unknown names, events ignored, a calendar rendering of what will be written) and `import/work/feeding.sql`. Nothing touches the database.
- `--apply` executes the SQL through `wrangler d1 execute --file` (same pattern as T-004; the file is atomic). **Idempotent**: rows previously imported for the same dates (`imported_from IS NOT NULL AND replaced_at IS NULL`) are replaced by the new value (soft-closed with `replaced_by = actor`); days changed in the app since the import (`imported_from IS NULL`) are never overwritten and are listed in the report.
- Reader checks the layout (`C5:I5` weekday headers, year in `D4`) and raises on a mismatch instead of guessing (T-004 lesson).
- `pytest` tests use a synthetic workbook built in `conftest.py` (as T-004), including an orphan cell, an unknown name and a leftover on a real date.

### 7.4 Production run (owner + agent runbook; goes into `06-operations.md` §8.2)

1. Deploy the release; `npm run db:migrate:production` (0013, 0014; pre-migration dump saved automatically; 0013 rehearsed before, §6.1).
2. Settings → Users: add **Feeder One, Feeder Two, Feeder Three** with role `Feeder`; send the three invite links through another channel.
3. In the Google Sheet, clear `November2026!E7:I7` and `December2026!E7:I7` (D10); download as `.xlsx`.
4. Dry run for `2026-10,2026-11,2026-12`; the report must show **0 unknown names, 0 leftovers on real dates** (orphans before the 1st are fine). Owner signs off the report.
5. `--apply`; open `/feeding?month=2026-10` and compare with the sheet; run **Export now** (mirror).
6. Settings → Preferences: paste the emergency contact and the two links into Notes & links.
7. Make the sheet view-only and tell the feeders the app URL (user guide §Feeding).

---

## 8. API (extends the route list; all under the session gate)

| Method · path                                                | Capability       | Request / response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/feeding?month=YYYY-MM`                             | `feeding.read`   | `{ month, today, days: [{ date, weekday, assignment: { id, userId, userName, note, createdAt, createdByName } \| null, events: [{ id, seriesId, title, note, followingCount }] }], assignable: [{ id, name, role }], totals: { byUser: [{ userId, name, weekdays, weekend, total }], unassigned }, notes: string }`. `followingCount` counts this occurrence plus every later non-deleted row of the same series. The UI offers "this and all following" only when `seriesId` is set and `followingCount > 1`. A one-off has `seriesId: null`. |
| `GET /api/feeding/days/:date/history`                        | `feeding.read`   | `[{ id, userName, note, createdAt, createdByName, replacedAt, replacedByName }]` oldest first                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `PUT /api/feeding/days/:date`                                | `feeding.write`  | `{ userId: string \| null, note?: string \| null, expectedAssignmentId: string \| null }` → the day's new state (as in GET). 400 `INVALID_INPUT` (bad date, unknown/inactive/guest user, note too long), 409 `DAY_CHANGED` (BR-17), 403 `FORBIDDEN`.                                                                                                                                                                                                                                                                                           |
| `POST /api/feeding/repeat-week`                              | `feeding.write`  | `{ weekStart: 'YYYY-MM-DD', month: 'YYYY-MM', overwrite: boolean, dryRun?: boolean }` → `{ filled, kept, replaced }` (dry run returns the counts for the preview). Atomic `db.batch`.                                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/feeding/events`                                   | `feeding.write`  | `{ date, title, note?, repeatUntil?: 'YYYY-MM-DD', dryRun?: boolean }` → `{ count, dates }` (dry run writes nothing; a repeat shares one new `seriesId`). 400 `INVALID_INPUT` on a BR-19 problem.                                                                                                                                                                                                                                                                                                                                              |
| `PATCH /api/feeding/events/:id`                              | `feeding.write`  | `{ title?, note?, scope?: 'this' \| 'following' }` (default `this`). `following` updates this row and every later non-deleted row of the series; 400 when the event is a one-off. Returns `{ updated }`.                                                                                                                                                                                                                                                                                                                                       |
| `DELETE /api/feeding/events/:id?scope=this\|following`       | `feeding.write`  | soft delete. `scope=following` (default `this`) soft-deletes this row and every later non-deleted row of the series; 400 when asked on a one-off. Returns `{ deleted }`.                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /api/feeding/summary.csv?month=YYYY-MM`                 | `feeding.export` | FR-FEED-17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PATCH /api/admin/settings`                                  | admin            | gains `feedingScheduleNotes?: string` (≤ 2 000)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET /api/session`                                           | open             | gains `capabilities: string[]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET /api/lines`, `GET /api/lines/:id`, `GET /api/dashboard` | overview         | overview shapes for restricted roles (FR-GUEST-05/07/09); unchanged for full readers                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Errors follow `ApiError(status, CODE, message, hint?)`; messages in `worker/lib/messages.ts`.

---

## 9. Business rules (new; continue the BR numbering of `01-requirements.md`)

| ID    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-13 | **One feeder per day.** For any lab calendar date at most one `feeding_assignments` row has `replaced_at IS NULL`. Setting a day inserts a new row and sets `replaced_at/replaced_by` on the previous one; clearing only sets them. Rows are never updated otherwise or deleted.                                                                                                                                                                                                                                                                                                                                                                                   |
| BR-14 | **Assignable people** = users with `is_active = 1` and role in `admin, member, feeder`. The built-in Guest and the retired Admin are never assignable. A deactivated person keeps past assignments; a day cannot be set to a deactivated person (reactivate first).                                                                                                                                                                                                                                                                                                                                                                                                |
| BR-15 | **Capabilities** (§2.2) are the only permission vocabulary; enforced server-side; allow-list shaping for restricted roles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| BR-16 | **Tally.** Weekday = Monday–Friday, weekend = Saturday–Sunday, by the assignment's calendar date. Counts cover the calendar month only. `Unassigned` = days of the month with no current row. The panel, CSV and PDF use one function.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| BR-17 | **Day concurrency.** A save carries `expectedAssignmentId` (the current row's id or `null`). If the day's current row differs, the save is refused (409) with the BR-12 wording. The partial unique index on `(date) WHERE replaced_at IS NULL` makes two simultaneous inserts impossible.                                                                                                                                                                                                                                                                                                                                                                         |
| BR-18 | **Limits.** Note ≤ 200 characters; event title 1–60; notes block ≤ 2 000; dates 2000-01-01 … 2100-12-31; month navigation unlimited within that range.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| BR-19 | **Weekly event repeat (OQ-43).** `repeatUntil` absent → one row, `series_id` NULL. Present → one row per date from `date` inclusive, stepping 7 days, through the last such date on or before `repeatUntil`. Same weekday as `date`. `repeatUntil` must be on or after `date` and inside the BR-18 range, and the series holds 2–104 rows (a one-week span is a one-off; more than two years is refused). Every row of one create shares one new `series_id`. `scope=following` touches non-deleted rows of that `series_id` with `date >=` the chosen row's date, this row included. Editing never clears `series_id`. Soft delete only; nothing is hard-deleted. |

Changed existing rules: **BR-5** unchanged (the signed-in person authors every assignment; Guests author nothing). **FR-CHAT-02 / OQ-40(a)** tightened: Guests no longer read chat (D1, D2). **FR-DASH-01 … 07, FR-LIST-01 … 08, FR-LINE-01 … FR-EXP-02** apply to full readers only; restricted roles follow §4.

---

## 10. Non-functional notes

- **NFR-08 ($0).** One assignment row per day ≈ 365 rows/year plus history; the monthly GET is one query per table. Free-tier impact negligible. The `users` rebuild is a one-off migration.
- **NFR-07 (security, proportionate).** The restricted view is the first server-side content restriction. The route-coverage test (BR-15) is part of `npm run check`. Personal data (the emergency phone number) lives only in `settings` on the database; the public-repository export (T-029) must map the feeder names if they ever appear in fixtures — tests use synthetic names (`Feeder One`, `Feeder Two`).
- **NFR-01 (visibility).** Names in cells at 16 px minimum; truncation only on phones with the full name one tap away.
- **NFR-06 (agents).** All rules in `domain/`, strings in `strings.ts`, docs folded into 01/03/04/05 by the tickets.

---

## 11. Acceptance test outline

1. **Roles.** Settings → Users: add `Feeder One` (role Feeder) → invite link works in a private window → signed in as Feeder: header shows Dashboard · Lines, account menu has Feeding Schedule; `/settings`, `/lines/new`, `/lines/<id>/print` show the Not-available screen; `curl` to `/api/chat/...`, `/api/activities`, `/api/lines.csv`, an image `attachments/:id/file` → 403; a reference PDF → 200.
2. **Guest.** Open the Guest link: Dashboard shows greeting + 3 counters + 2 buttons; Lines shows 9 columns, no Export CSV; a line shows the summary card and references only; `/feeding` → Not available; `/api/feeding?month=…` → 403; `/api/users` → 403.
3. **Member unchanged.** Sign in as a Member: Line Detail still shows protocols, cryo, timeline, chat, history; Dashboard unchanged plus the new button.
4. **Calendar.** `/feeding` opens the current month, Sunday first, today marked; `Next ›` and the month picker change `?month=`; phone 375 px Grid shows seven columns without horizontal scroll; List view lists every day.
5. **Edit.** Tap a day → choose a name → Save → cell and totals update, toast shown; open the same day in a second browser, change it, save in the first → 409 message; clear a day → confirm → `—`; `Show history` lists both values with authors.
6. **Repeat week.** On a week with Feeder One/Feeder Two/Feeder Three pattern → `Repeat this week…` preview counts match → Apply → the remaining empty days follow the pattern, assigned days kept (unless overwrite).
7. **Events.** Add `Test Water Quality` on a Monday with `Repeat weekly` until the end of December → preview says how many Mondays; after saving, every such Monday shows the label, including in the CSV `Events` column. Delete one Monday with **Delete this event**: that Monday loses it, the later Mondays keep it. On an earlier Monday choose **Delete this and all following**: that Monday and every later one are gone (soft-deleted) and the Mondays before it stay. Edit "this and all following" changes the title on the remaining later Mondays only.
8. **Export.** CSV has 31 `day` rows and the `total` rows; numbers equal the panel; PDF prints one landscape page with grid, totals, notes.
9. **Notes & links.** Admin saves the footer text in Preferences → appears on the page with clickable links; Feeder sees it; Guest cannot reach it.
10. **Mirror & restore.** Export now → `feeding_assignments.csv`, `schedule_events.csv`, JSON keys present; `restore_from_export.py --dry-run` counts them.
11. **Import.** Dry run on the downloaded sheet (Oct–Dec 2026) → report shows 0 unknown names after Feeder One/Feeder Two/Feeder Three exist, orphans listed, Nov/Dec leftovers absent after the owner cleared them; apply → October matches the sheet cell by cell.
12. **Migration rehearsal.** 0013 on the rehearsal database restored from a production dump: all FKs intact, same indexes, every user keeps id/role/password; sign-in works.

---

## 12. Ticket plan (summary; details in `tickets/T-031 … T-037`)

| Ticket | Title                                                                                                               | Size | Depends on | Suggested agent |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ---- | ---------- | --------------- |
| T-031  | Feeder role and capability model (migration 0013, `domain/permissions`, session capabilities, Settings role picker) | M    | T-027      | Claude Code     |
| T-032  | Restricted view for Guests and Feeders (overview shaping, refusals, route-coverage test, client screens)            | L    | T-031      | Claude Code     |
| T-033  | Feeding Schedule data and API (migration 0014, `domain/feeding`, routes, export/mirror/restore)                     | M    | T-031      | Codex           |
| T-034  | Feeding Schedule page (calendar, day dialog, navigation entries, phone views, totals, repeat week)                  | L    | T-033      | Codex           |
| T-035  | Monthly summary (CSV + print view) and Notes & links setting                                                        | S    | T-034      | Codex           |
| T-036  | Google Sheet import tool and production cut-over                                                                    | M    | T-033      | Claude Code     |
| T-037  | Schedule events, including weekly repeat and "this and all following"                                               | M    | T-034      | either          |

Parallel lanes after T-031: **A** = T-032, then T-036 (T-036 also needs T-033); **B** = T-033 → T-034 → T-035 → T-037. Expected collisions: `app/src/strings.ts`, `app/src/styles/base.css`, `worker/index.ts`, `AppShell.tsx`, `AccountMenu.tsx`, `DashboardPage.tsx` (both lanes) — follow `tickets/HANDOFF.md` §2 (append-only blocks, keep both sides on conflict). T-026 (header search) touches `AppShell.tsx` too: rebase before opening PRs.

Also: ADR-0006 (role/capability model) accompanies T-031; `docs/00-open-questions.md` OQ-41 … OQ-45.

---

## Change log

- 2026-10-09 — v1.0: written from the owner's brief (2026-10-09), inspection of the Google Sheet (12 month tabs, structure in §7.1), and the current code base (ADR-0005 session gate, route layout, export/mirror/restore tools). Owner decisions D1–D10 applied.
- 2026-10-09 — v1.1: owner confirmed OQ-41, OQ-42, OQ-44. OQ-43 decided: weekly repeat (FR-FEED-22, BR-19) with "this event" / "this and all following" on delete and on edit. No reminders.
