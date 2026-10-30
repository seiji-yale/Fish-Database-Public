# T-041 — Feeding Schedule PDF export: a way back; Feeder's home page

|                  |                                        |
| ---------------- | -------------------------------------- |
| State            | Done                                   |
| Size             | S                                      |
| Phase            | Fixes                                  |
| Depends on       | T-034, T-035                           |
| Branch           | `ticket/T-041-feeding-print-return`    |
| Owner acceptance | required on preview URL                |

## Problem (reported by the owner)

1. Export as PDF opens the browser's print dialog on `/feeding/print`. Saving (or cancelling) the
   dialog leaves the browser on that print-only page, which has no app shell and no link back; the
   only way back is the browser's Back button, and that path is not obvious.
2. Separately: Feeder's actual job in the app is the Feeding Schedule, but signing in as a Feeder
   lands on the general Dashboard (an overview with a link to Feeding Schedule, among other things
   a Feeder cannot use). The owner wants Feeding Schedule to be a Feeder's home page, or at least
   given the most prominent spot.

## Scope

- `/feeding/print`: a visible "Back to Feeding Schedule" link in the print header, hidden from the
  printed/saved output (`@media print`). (An automatic return once the print dialog closes was tried
  first via the `afterprint` event, but headless/automated printing can fire that event immediately
  rather than after a real dialog closes, which would send a real user back before they could act;
  dropped in favour of the always-visible link.)
- Feeder is the only restricted role with `feeding.read` (`domain/permissions.ts`): added
  `hasFeedingHome(role)` for that composition. `DashboardPage` renders `FeedingSchedulePage` directly
  for that role instead of the Dashboard. The header nav and the account menu drop their now-redundant
  `/feeding` entry for the same role, since `/` already is the Feeding Schedule.

## Out of scope

- The Dashboard/account menu wording and layout for Member/Admin (unchanged).
- Guest: still restricted, still has no `feeding.read`, unaffected.

## Acceptance criteria

1. Exporting a month as PDF shows a visible link back to the Feeding Schedule in the print header; it
   does not appear in the printed or saved PDF.
2. Signing in as a Feeder and visiting `/` shows the Feeding Schedule, not the Dashboard.
3. The header nav and account menu show exactly one "Feeding Schedule" entry (pointing at `/`) for a
   Feeder, not two.
4. No regression for Member, Admin or Guest.

## Review Log

### Step 1 report — 2026-10-30 — implementer

- Added the visible return link (`FeedingPrintPage.tsx`, `.print-return` in `base.css`) and
  `hasFeedingHome` (`domain/permissions.ts`, unit-tested). `DashboardPage.tsx` now renders
  `FeedingSchedulePage` for that role; `AppShell.tsx`'s nav and `AccountMenu.tsx` hide the redundant
  `/feeding` entry for it.
- First attempt used `window.addEventListener('afterprint', ...)` to navigate back automatically.
  This broke `tests/e2e/feedingEvents.write.spec.ts` ("a weekly repeat across a month boundary..."),
  which visits `/feeding/print` without mocking `window.print`: in headless Chromium, `afterprint`
  fired immediately, navigating away before the page could be read. Reverted to the link-only
  approach, which is reliable in both real and headless browsers and does not depend on browser- or
  OS-specific print-dialog timing.
- Verified the Feeder home change by hand against a local `wrangler dev` build (no fixture changes):
  created a temporary Feeder account through the Admin API, signed in as it, and confirmed `/` renders
  the Feeding Schedule heading and that the header nav and account menu show the link only once
  (pointing at `/`); removed the account afterwards. No e2e fixture exists for signing in as a Feeder
  yet, so this path has manual verification only, not an automated regression test.
- Checks: `npm run typecheck`, `npm run lint`, `npm run test` (866 passed), `npm run test:e2e` (412
  passed, 0 failed) all clean; `npm run check:english`, `check:free-tier`, `check:python`,
  `check:public` all clean.
