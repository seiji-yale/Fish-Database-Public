# T-031 — Feeder role and capability model

|                  |                                                                       |
| ---------------- | --------------------------------------------------------------------- |
| State            | Ready                                                                 |
| Size             | M                                                                     |
| Phase            | 5 (Feeding Schedule & restricted view)                                |
| Depends on       | T-027                                                                 |
| Depends on OQ    | — (OQ-41 … OQ-45 have conservative defaults; none blocks this ticket) |
| Branch           | `ticket/T-031-feeder-role`                                            |
| Owner acceptance | required on preview URL                                               |

## Goal

Add the `feeder` role and the single capability table (`domain/permissions.ts`, ADR-0006) that the
API and the client use from now on. After this ticket a Feeder can be created, invited and signed in
through Settings → Users exactly like a Member, `GET /api/session` reports capabilities, and the
existing write refusals (T-027) are expressed through `can()`. Nothing is hidden yet (that is T-032);
a Feeder behaves as a Guest for line data and sees no Feeding Schedule yet (T-033/T-034).

## Scope

- Migration `0013_feeder_role.sql`: rebuild `users` with `role IN ('admin','member','feeder','guest')`
  (12-step procedure, `PRAGMA defer_foreign_keys = true`, same indexes afterwards). Spec §6.1.
- `domain/permissions.ts`: `Capability` union (spec §2.2 table), `can()`, `capabilitiesOf()`,
  `isRestricted()`, `ASSIGNABLE_ROLES`; 100 % branch coverage.
- `domain/types.ts`: `UserRole` gains `'feeder'`; `domain/attribution.ts` `resolveAuthor` uses
  `can(role, 'lines.write' | 'chat.write')` (behaviour for the existing roles unchanged; feeders refused).
- `worker/lib/permissions.ts`: `requireCapability(c, capability)` → 403 `FORBIDDEN` with
  `messages.restrictedApi` ("This is not available in the Guest view."); `requireAdmin` delegates to it.
- `GET /api/session` → `capabilities: string[]`; `app/src/session.ts` types; `useActingUser` exposes
  `can(capability)`.
- Settings → Users: `assignableRole` enum gains `feeder` (`domain/admin.ts`); role select shows
  **Feeder**; users table Role column; `publicUser` unchanged.
- `tools/public/scrub.ts` / mapping: no real feeder names in fixtures (use `Feeder One`, `Feeder Two`).
- Docs: `01-requirements.md` §2 roles table + U-4; `03-data-model.md` §2.1 + §7 (first rebuild, how);
  `04-ui-spec.md` §7 (role picker); `07-glossary.md` (Feeder); ADR-0006 index row; `06-operations.md`
  §4 note: 0013 must be rehearsed (§2.4) before production.

## Out of scope

- Any content restriction for Guests/Feeders (T-032). Feeding tables, routes, UI (T-033 …).
- Bottom-tab / top-nav entries for the schedule (T-034, OQ-45).

## Spec references

`docs/08-feeding-schedule-and-guest-access.md` §2 (U-4, BR-14, BR-15), §6.1, §8 (`GET /api/session`), ADR-0006 · `docs/01-requirements.md` U-1 … U-3, FR-ADM-01, BR-5.

## Steps

### Step 1 — Migration 0013 and rehearsal

**Tasks**

- Write `0013_feeder_role.sql` with comments explaining the rebuild and the deferred FK pragma.
- Extend `worker/db/migrations.test.ts`: apply on a database with data in every table referencing
  `users` (use `fixtures.ts`); assert row counts, ids, roles, password columns unchanged; assert the
  index list on `users` from `sqlite_master` is the same before/after; assert `INSERT … role='feeder'` works
  and `role='other'` fails.
- Run on the **rehearsal** environment with a fresh production dump (`docs/06-operations.md` §2.4 steps
  1–4 as far as the database; owner runs the wrangler commands if credentials are needed) and record the
  result in the Review Log.
  **Done when**
- Local, preview and rehearsal migrated; tests prove data and FKs intact.
  **Review focus**
- Checklist B (migrations additive? — this one rebuilds: justify, show the rehearsal evidence); no data loss paths.

### Step 2 — `domain/permissions.ts` and attribution

**Tasks**

- Implement the capability table exactly as spec §2.2; export `CAPABILITIES` for the route-coverage test (T-032).
- `resolveAuthor` through `can()`; `ForbiddenAuthorError` message unchanged.
- Unit tests: every role × every capability (table-driven), `isRestricted`, `ASSIGNABLE_ROLES`.
  **Done when**
- `npm run test:domain-coverage` stays at 100 %; existing attribution tests pass unchanged.
  **Review focus**
- A: table matches the spec cell by cell (quote it); no route logic in `domain/`.

### Step 3 — API: `requireCapability`, session capabilities, Admin role picker

**Tasks**

- `worker/lib/permissions.ts`; `requireAdmin` → `requireCapability(c, 'admin.*')`.
- `GET /api/session` adds `capabilities`; `worker/accounts.test.ts` covers all four roles.
- `domain/admin.ts`: `assignableRole = z.enum(['member','admin','feeder'])`, message
  "Choose Member, Admin or Feeder."; admin route tests: add Feeder, change Member ↔ Feeder, last-Admin guard still holds.
  **Done when**
- A Feeder can be added, invited (`/join/<token>`), signed in; every write route refuses them (reuse T-027's write-route test, add the feeder row).
  **Review focus**
- B: no `role === 'guest'` comparisons remain in `worker/` (grep); error text in `messages.ts`.

### Step 4 — Client and docs

**Tasks**

- `session.ts` / `useActingUser.ts` (`can`), Settings → Users role select + table, `strings.roleFeeder`.
- Account menu chip for Feeders (`Feeder`), as Admin/Guest have.
- Docs listed in Scope; `tickets/STATUS.md`.
  **Done when**
- Preview: owner adds `Feeder One`, invite works on a phone, Settings shows the role; `npm run check` and e2e green.
  **Review focus**
- C: strings centralised; D: docs folded (requirements roles table, data model, glossary, ADR index).

## Acceptance criteria (owner verifies on preview)

1. Settings → Users → Add user offers Member / Admin / Feeder; a Feeder is created and invited; the invite link signs them in; their menu shows the `Feeder` chip.
2. Signed in as the Feeder, every edit button is absent and a hand-made write request is refused (403).
3. Changing the Feeder to Member and back works; the last active Admin cannot be demoted to Feeder.
4. `GET /api/session` lists capabilities for the signed-in role (visible in the browser's network tab).
5. Migration 0013 rehearsal on a production copy is recorded as passed in the Review Log.

## Review Log

<!-- Append Step Reports, Step Reviews, Ticket Review, Owner feedback here, newest at the bottom. -->

### Step 1 report — 2026-10-23 — implementer

- What was done: `0013_feeder_role.sql` rebuilds `users` with the `feeder` role. Migration number is 0013 because 0012 (`cryo_use_undo`) already exists in the public repository.
- Deviation (spec §6.1 corrected): the documented "create `users_new`, drop `users`, rename" order fails at COMMIT even with `PRAGMA defer_foreign_keys`, because rows inserted into `users_new` do not cancel the violations created by `DROP TABLE users`. Reproduced with a minimal script; a negative control (a row left out) also fails, so the deferred check stays effective. The migration copies rows to `users_copy`, drops `users`, recreates `users` and inserts the rows back.
- Checks: `worker/db/migrations.test.ts` (ids, passwords, session columns, index list, `PRAGMA foreign_key_check`, feeder accepted, other role refused) ✅
- Rehearsal on a production copy: NOT DONE. The owner runs the commands in `docs/06-operations.md` §4 (restore a fresh dump into the rehearsal database, `npm run db:migrate:rehearsal`, sign in, compare users). Record the result here before production.

### Step 2 report — 2026-10-23 — implementer

- What was done: `domain/permissions.ts` (`CAPABILITIES`, `can`, `capabilitiesOf`, `isRestricted`, `ASSIGNABLE_ROLES`); `resolveAuthor` uses `can()` (the `guestsMayChat` rule is kept for Guests).
- Checks: table-driven test of every role × capability against spec §2.2; domain coverage 100 % ✅

### Step 3 report — 2026-10-23 — implementer

- What was done: `worker/lib/permissions.ts` `requireCapability` (`admin.*` keeps `403 ADMIN_ONLY`, others `403 FORBIDDEN` with `restrictedApi`); admin, restore and protocol-admin routes use it; `GET /api/session` returns `capabilities`; role enum accepts Feeder; Feeders cannot copy the Guest link but can change their own password.
- Found by the new `worker/writeRoutes.test.ts` (every data-changing route refuses Guest and Feeder): chat edit/delete/request returned 404 and message post and attachment upload returned 400 before the permission check. Each now checks the permission first.
- Checks: `accounts.test.ts` Feeder tests (invite, capabilities for the roles, refusals, Member ↔ Feeder, last Admin guard) ✅ `npm run check` ✅ (pytest 143 after creating `.venv`).

### Step 4 report — 2026-10-23 — implementer

- What was done: session types and `useActingUser().can()`, Settings → Users role select and "Make Member / Admin / Feeder" menu from `ASSIGNABLE_ROLES`, `Feeder` chip in the account menu, no Guest-link item for restricted roles; docs (requirements roles, data model §5, glossary, operations §4, spec §6.1).
- Open: browser suite result and the owner's preview check; rehearsal (Step 1).
