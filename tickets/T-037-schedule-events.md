# T-037 — Schedule events, including weekly repeat

|                  |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| State            | Done                                                                                      |
| Size             | M                                                                                         |
| Phase            | 5 (Feeding Schedule & restricted view)                                                    |
| Depends on       | T-034 (the events API, including repeat and scope, exists since T-033)                    |
| Depends on OQ    | OQ-43 (DECIDED 2026-10-09: weekly repeat; delete/edit "this" or "this and all following") |
| Branch           | `ticket/T-037-schedule-events`                                                            |
| Owner acceptance | required on preview URL                                                                   |

## Goal

Besides the feeder, a day can carry short entries such as `Test Water Quality` or `Inspection`. An entry
can repeat every week on the same weekday until a chosen date, and deleting or editing it can apply to
that day only or to that day and every later repeat. Not imported from the sheet; entered by hand.
No reminder is sent (OQ-44).

## Scope

- Day dialog: events section (list with Edit / Remove, `+ Add event` with Title `<datalist>` of titles used before, Note).
- **Repeat weekly** checkbox and **Repeat until** date (default: last day of the month on screen). The preview line comes from `POST /api/feeding/events` with `dryRun: true` (`Will add N events, every Monday until YYYY-MM-DD.`). Saving without the checkbox creates a one-off.
- **Remove** of a one-off: one confirmation, `Delete this event`. **Remove** of a series event with `followingCount > 1`: two actions, `Delete this event` and `Delete this and all following (N)`, calling `DELETE` with `scope=this` or `scope=following`.
- **Edit** of a series event asks `This event only` / `This and all following` and sends `scope` on `PATCH`. A one-off edits in place.
- Calendar cells: event labels under the name (desktop/tablet), `•` marker on the phone grid, full text in List view. Repeated events look the same as one-offs in the cell.
- CSV `Events` column and print view labels already exist from T-035 — verify a repeated title appears on each of its days.
- `feedingApi.ts` event calls; strings from spec §5.7 (`feeding_event_*`); Playwright write spec.
- Docs: `04-ui-spec.md` day dialog events; `user-guide.md` sentence.

## Out of scope

- Repeats other than weekly on the start weekday (monthly, every N days, "forever") — BR-19 is the whole rule.
- Reminders or notifications for an event (OQ-44).
- Event categories or colours.
- Importing the sheet's event rows (T-036 leaves them out).

## Spec references

`docs/08-feeding-schedule-and-guest-access.md` §3.5 (FR-FEED-20 … 22), §5.4, §5.7, §6.3, §8 events routes, BR-18, BR-19.

## Steps

### Step 1 — One-off events in the dialog and the cells

**Tasks**

- Events UI in `FeedingDayDialog` for a single date; labels/markers in cells; datalist from the month's distinct titles (plus the previous month's).
  **Done when**
- Add, edit and remove (soft) of a one-off are observable; cells update without reload.
  **Review focus**
- C: one confirmation on remove; labels not truncated in List/print.

### Step 2 — Weekly repeat, and "this" / "this and all following"

**Tasks**

- Repeat checkbox, until-date, dry-run preview, save. Remove and Edit offer the two scopes only when `seriesId` is set and `followingCount > 1`. After either action, reload the visible months so later months update too.
  **Done when**
- A Monday-until-December series shows on every Monday; deleting one leaves the others; deleting "following" clears that day and every later Monday and keeps the earlier ones; editing "following" changes the title from that day on.
  **Review focus**
- A: the preview count equals the number of rows created; no notification UI; scope defaults to `this`.

### Step 3 — Tests and docs

**Tasks**

- `feedingEvents.write.spec.ts` covering one-off, repeat across a month boundary, both delete scopes, both edit scopes; CSV/print assertions; docs.
  **Done when**
- `npm run check` + e2e green; owner acceptance.
  **Review focus**
- D: UI spec and user guide updated; glossary "Schedule event" matches BR-19.

## Acceptance criteria (owner verifies on preview)

1. Add `Test Water Quality` on a Monday with Repeat weekly until the end of next month: the preview count matches the Mondays, and each of those days shows the label in the grid, the List view, the CSV and the print view.
2. Delete one of those Mondays with **Delete this event**: that day loses it; the later Mondays keep it. On an earlier Monday, **Delete this and all following** clears that day and every later one, and the Mondays before it stay.
3. Edit with **This and all following** changes the title from that day forward only. A one-off event has a single delete confirmation and no repeat checkbox result.
4. A Guest never sees events (no access to the page or API). Nothing emails or notifies anyone.

## Review Log

<!-- Append Step Reports, Step Reviews, Ticket Review, Owner feedback here, newest at the bottom. -->

### Steps 1 to 3 — 2026-10-27 — implementer

- Step 1 and 2: the Events section of the Day dialog (`FeedingEvents.tsx`): list with `Edit` / `Remove`, `+ Add event` (Title with a `<datalist>` of the titles of the month on screen and the previous month, `Event note`), `Repeat weekly` with `Repeat until` (default: last day of the month on screen) and the live preview from `POST /api/feeding/events` with `dryRun: true` (the count equals the rows created; the Save button waits for a valid preview). Editing a repeating event with later occurrences shows `This event only` / `This and all following (N)` (default this). `Remove` goes through `FeedingEventRemoveDialog`: one confirmation for a one-off, two actions (`Delete this event`, `Delete this and all following (N)`) for a repeating event. Each action is its own request; the month reloads after it and the toast says what happened (a 404 means someone else removed it first: the day reloads with a note). The calendar cell shows event labels (wrapped, not cut off, from 640 px), a dot on the phone grid; the List view and the print view show the full title.
- Step 3: `feedingEvents.write.spec.ts`: a one-off (add, edit, one confirmation), a weekly repeat across a month boundary (preview text equals the number of Mondays, each Monday carries it, the CSV and the print view show it on each day of the month), delete this one, edit this and all following, edit one only, delete this and all following (earlier ones stay), and the title suggestions. Full browser suite green (409 tests). The event label in `feeding.write.spec.ts` locators was disambiguated: the event field is `Event note`.
- Deviations: (1) the edit scope is a pair of radio buttons inside the form instead of a separate question after Save; (2) `user-guide.md` does not exist in this repository (as in T-034); (3) the Day dialog's events section appears for every role with `feeding.read`, but Edit, Remove and `+ Add event` only for roles with `feeding.write` (all current roles that read can write).
- For the owner: acceptance 1 to 4 of this ticket, on the preview.
