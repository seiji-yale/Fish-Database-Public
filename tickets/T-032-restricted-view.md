# T-032 — Restricted view for Guests and Feeders

|                  |                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------- |
| State            | Done                                                                               |
| Size             | L                                                                                  |
| Phase            | 5 (Feeding Schedule & restricted view)                                             |
| Depends on       | T-031                                                                              |
| Depends on OQ    | OQ-42 (Cryopreserved counter for restricted roles — default: shown, as decided D2) |
| Branch           | `ticket/T-032-restricted-view`                                                     |
| Owner acceptance | required on preview URL                                                            |

## Goal

Guests and Feeders see a line's name, status and overview (Gene, Phenotypes, DOB/Age, IDed number,
Last ID date, ID method names, References) and nothing else — enforced by the server through
allow-list shaping and 403 refusals (ADR-0006, BR-15). Members and Admins see exactly what they see today.

## Scope

- `domain/lineOverview.ts`: `toLineListOverview`, `toLineOverview` with explicit result types (spec FR-GUEST-05/07).
- API: `GET /api/lines` and `GET /api/lines/:id` return overview shapes when `!can(role,'lines.read_full')`
  (`restricted: true`); `GET /api/dashboard` returns the minimal shape (FR-GUEST-09); refusals per
  FR-GUEST-10 (`lines.csv`, `lines/:id.csv`, `activities`, all chat reads and counts, `enumerations`,
  `attachments/:id/file` except `reference_file`, `users` for Guests).
- **Route-coverage test** `worker/routeCoverage.test.ts`: enumerates `app.routes`, requires every route to
  be in a classification table (`open | overview | full | feeding | admin | write`), calls each as
  guest / feeder / member / admin and asserts the expected status class. Unknown route → test fails.
- Client: `NotAvailablePage`; `LineOverviewCard`; Line List restricted columns/filters/no export
  (FR-GUEST-06); Line Detail restricted page (FR-GUEST-08); Dashboard restricted (FR-GUEST-09);
  AppShell: nav `Dashboard · Lines`, no Lab Chat link/badge, no unread polling for restricted roles,
  account menu per FR-GUEST-02; `/settings`, `/lines/new`, `/lines/:id/print` → NotAvailablePage.
- Search (FR-GUEST-03): restricted roles match name/gene/phenotype only (coordinate with T-026 if merged).
- Replace remaining `role === 'guest' | 'admin' | 'member'` comparisons in `app/src` with `can()`.
- Docs: `01-requirements.md` (FR-CHAT-02 note, FR-DASH/FR-LIST/FR-LINE "full readers only" note, §1.3),
  `04-ui-spec.md` §2–§5 restricted variants, `user-guide.md` (Guest section), `00-open-questions.md` OQ-40 note.

## Out of scope

- Feeding Schedule routes and page (T-033/T-034) — the route-coverage table gets its `feeding` rows there.
- Changing `snapshot.html` or the mirror (lab-internal, full content).

## Spec references

`docs/08-feeding-schedule-and-guest-access.md` §2.2, §4 (FR-GUEST-01 … 11), §5.6, §5.7, §6.6 · `docs/01-requirements.md` FR-LIST-01, FR-LINE-01, FR-DASH-02 … 07, FR-CHAT-02, NFR-07.

## Steps

### Step 1 — Overview shaping in the domain and the API

**Tasks**

- `domain/lineOverview.ts` + tests (every allowed field present, every forbidden field absent — assert on `Object.keys`).
- `worker/routes/lines.ts`, `lineDetail.ts`, `dashboard.ts`: branch on `can()`; `restricted: true`; no `ETag` for the overview.
- Route tests for guest and feeder against the fixtures: snapshot the overview JSON keys.
  **Done when**
- `GET /api/lines/:id` as Guest contains no `protocols`, `cryoRecords`, `versions`, `chatMessages`, `notes`, `attributes`; as Member unchanged.
  **Review focus**
- B: allow-list, not delete; soft-deleted references excluded; `idMethods` carries label + type name only.

### Step 2 — Refusals and the route-coverage test

**Tasks**

- Apply `requireCapability` per FR-GUEST-10; attachments route checks `kind === 'reference_file' && deleted_at IS NULL` for restricted roles.
- Write `routeCoverage.test.ts` with the classification table; include every route registered in `worker/index.ts` today.
  **Done when**
- The test lists all routes; adding a route without a row fails CI; guest/feeder get 403 on every `full`/`write`/`admin` route, 200 on `overview`/`open`.
  **Review focus**
- B: nothing left on a deny-list; reference files still open for Guests; `GET /api/session` still open.

### Step 3 — Client: shell, Dashboard, Line List

**Tasks**

- `NotAvailablePage`; AppShell nav/menu/badge by `can()`; Dashboard restricted rendering; Line List restricted columns, filters, no export, no Breed soon; search scope.
  **Done when**
- Playwright: guest spec at 375/768/1280 — header items, dashboard panels absent, list columns = 9, no Export CSV.
  **Review focus**
- C: no horizontal scroll at 375 px; strings in `strings.ts`; empty states.

### Step 4 — Client: Line Detail overview card, refused pages, docs

**Tasks**

- `LineOverviewCard` (FR-GUEST-08) with the role-specific hint; `/lines/:id/print`, `/lines/new`, `/settings` → NotAvailablePage for restricted roles.
- Docs listed in Scope; user guide screenshots for the Guest view (`tools/docs/take-guide-screenshots.ts`, synthetic data).
  **Done when**
- Owner checks on preview pass (below); `npm run check` + e2e green.
  **Review focus**
- D: requirement notes added where behaviour changed (FR-CHAT-02, FR-DASH-*); glossary "Guest" row updated.

## Acceptance criteria (owner verifies on preview)

1. Guest link: Dashboard shows greeting, Active/Closed/Cryopreserved counters and two buttons only; no Lab Chat link; Lines shows 9 columns and no Export CSV; a line shows one card with Gene, Phenotypes, DOB/Age, IDed number, Last ID date, ID method name(s), References; `Open` on a reference works.
2. Guest: `/settings`, `/lines/new`, `/lines/<id>/print`, `/feeding` show "Not available in the Guest view"; the browser network tab shows 403 for chat, activities, CSV and a gel image URL.
3. Feeder: same as Guest for lines, plus `Change password` and the `Feeder` chip; no Guest banner.
4. Member and Admin: Line Detail, Dashboard, Line List unchanged (compare with production).
5. Phone (375 px): Guest Line List cards and the overview card readable without horizontal scrolling.

## Review Log

<!-- Append Step Reports, Step Reviews, Ticket Review, Owner feedback here, newest at the bottom. -->

### Steps 1 to 4 — 2026-10-26 — implementer

- Step 1: `domain/lineOverview.ts` (allow-list, key-set tests). `GET /api/lines`, `GET /api/lines/:id` and `GET /api/dashboard` return the overview shapes for restricted roles (`restricted: true`, no ETag); the overview loads only the line, phenotypes, protocols and references, never the records a restricted role must not see.
- Step 2: `requireCapability` added to `lines.csv`, `lines/:id.csv`, `activities`, all chat reads and marks, `enumerations`, `users` (Guests), `cryo/next-id`, `lines/check-name`, restore preview. `attachments/:id/file` lets restricted roles open `reference_file` only. `worker/routeCoverage.test.ts` classifies all 69 routes and calls each as Guest, Feeder, Member and Admin; `worker/restrictedView.test.ts` checks the response keys.
- Step 3 and 4: `NotAvailablePage` and `RequireCapability`; `LineOverviewCard`; Dashboard, Line List (9 columns, ID Method filter only, no export) and AppShell (nav, Lab Chat link and unread polling by `can()`); the `role ===` permission checks in `app/src` now use `can()` (the Guest banner, the Guest hint and the admin header tint stay identity-based). `useActingUser` starts from the session the shell already read, so a restricted page does not flash the full layout.
- Docs: `01-requirements.md`, `04-ui-spec.md` (new 5.8), `07-glossary.md`. The ticket also names `user-guide.md`, `00-open-questions.md` and `tools/docs/take-guide-screenshots.ts`; none of them exist in this public repository, so nothing was changed there.
- Deviations: (1) the route-coverage table has an extra `roster` class for `GET /api/users` (Feeders may list users, Guests may not). (2) The overview reference carries `attachmentId` beside `hasAttachment`, because `Open` needs the file id. (3) The Dashboard Cryopreserved counter is a plain figure for restricted roles (the Cryopreserved filter is not offered). (4) The account-menu `Feeding Schedule` entry is not added; it arrives with T-034. (5) `/feeding` is closed to roles without `feeding.read` and shows a placeholder to the others until T-034.
- Existing tests that read full data as a Guest now sign in as a Member; Guest-specific e2e tests were rewritten for the overview (`restrictedView.spec.ts` is new). Two e2e specs that mock `/api/session` now include `capabilities`.
- Checks: `npm run typecheck`, `lint`, `test` (756 passed), `test:domain-coverage`, `check:english`, `check:public`, `check:free-tier` green; `npm run test:e2e` 348 passed, 25 skipped. One full run showed a single failure in `lineDetail.spec.ts` "two PCR protocols" on phone-375 that did not recur (3 repeats alone, then a full rerun green).
- Not done: Feeder in the browser (no Feeder in the e2e seed; Feeder is covered by the route and response tests), owner acceptance on the preview, `check:python`.

### Owner acceptance and release — 2026-10-26

- Owner accepted all five criteria on the preview (branch build). PR #9 merged (merge commit ab07e37) after `check` and `secrets` passed.
- Production deployed from `main` at ab07e37 (no migration); `/api/health` answers. Preview redeployed from `main`.
