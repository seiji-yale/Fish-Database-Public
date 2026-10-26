# ADR-0006 — Feeder role and a capability-based, server-enforced restricted view

- Status: Accepted
- Date: 2026-10-09
- Deciders: Product owner
- Related: `docs/08-feeding-schedule-and-guest-access.md` (U-4, BR-15, FR-GUEST-*), ADR-0005, tickets T-031, T-032

## Context

ADR-0005 gave everyone a personal account and a shareable read-only Guest link. Guests could read
**everything** (protocols with primer sequences, cryopreservation stock, chat, history); only writes
were refused. Two new needs change this:

1. The lab's feeding roster (a Google Sheet, one first name per day) moves into the app. The people
   who feed the fish are often undergraduates who rotate two or three times a year. They need to
   see and edit the schedule and nothing more than a line's name, status and overview.
2. The owner wants the Guest link to show the same overview only — no details, logs or activity.

Role checks today are scattered `role === 'guest'` / `role === 'admin'` comparisons in routes and
components, and the Guest restriction is write-only (`resolveAuthor`). Adding a third
read level by sprinkling more comparisons would be error-prone and untestable as a whole.

## Decision

1. Add the role **`feeder`** to `users.role` (migration 0013 rebuilds `users`, the only way to change
   a SQLite CHECK constraint; `PRAGMA defer_foreign_keys = true` keeps the foreign keys satisfied at
   commit on D1).
2. Express permissions as **capabilities** in one pure module, `domain/permissions.ts`
   (`can(role, capability)`), used by the API to enforce and by the client to render. Roles map to
   capability sets: admin ⊇ member ⊇ (feeder ∩ full-readers = overview + feeding) ⊇ guest (overview only).
3. The restricted view is produced **server-side by allow-list shaping**: when a role lacks
   `lines.read_full`, the API builds the response from an explicit list of permitted fields
   (`domain/lineOverview.ts`), never by removing fields from the full document. Routes that have no
   overview form (chat, activities, exports, image files) answer `403 FORBIDDEN`.
4. A **route-coverage test** classifies every registered `/api` route and runs it as each of the four
   roles; an unclassified route fails the build.

## Alternatives considered

- **A boolean `is_feeder` flag on Members** — rejected: the owner asked for a role in the user form;
  Feeders must not have Member rights; one `role` value keeps the Settings UI and invites unchanged.
- **Client-side hiding only** — rejected: the Guest link is passed around; hand-made API calls would
  still return protocols and sequences (NFR-07).
- **Deny-list filtering (delete sensitive fields from the full document)** — rejected: every new field
  would leak by default; allow-lists fail closed.
- **A second Worker / separate app for feeders** — rejected: cost of two deployments, duplicated
  sign-in, and the owner wants one URL (NFR-08, success criterion 1).
- **Store feeder as `guest` with a per-user "may edit schedule" setting** — rejected: Guests are one
  shared built-in identity; feeders need personal attribution (BR-5).

## Consequences

- Positive: one place to read who may do what; the restriction is testable in one test; adding a
  future role (e.g. a read-only Member) is a row in the capability table.
- Negative: the first table rebuild in this project (users); must be rehearsed on the `rehearsal`
  environment with a production dump before production. Guests lose chat reading (OQ-40 a
  tightened) — accepted by the owner (D1/D2 in `docs/08-…`).
- Follow-up: fold the role table and capability matrix into `01-requirements.md` §2 (T-031), replace
  direct `role === …` comparisons in routes and components with `can()` (T-032; the Admin checks may
  stay on `requireAdmin`, which becomes `can(role, 'admin.*')`).
