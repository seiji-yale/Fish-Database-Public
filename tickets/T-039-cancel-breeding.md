# T-039 — Undo Start Breeding (Breeding → Current)

|                  |                                |
| ---------------- | ------------------------------ |
| State            | Draft                          |
| Size             | S                              |
| Phase            | Fixes                          |
| Depends on       | —                              |
| Branch           | `ticket/T-039-cancel-breeding` |
| Owner acceptance | required on preview URL        |

## Problem

A line set to **Breeding** (by mistake, wrong cross date, or a cross that was abandoned) cannot go back to
**Current**. `domain/breeding.ts` has `startBreeding`, `closeLine`, `reopenLine` (Closed → Current) and the new-generation
genotyping path (Breeding → Current with a new DOB), but no Breeding → Current transition without a new generation.
The only ways out today are closing and reopening the line, which writes misleading history.

## Proposed behaviour

- Change Activity gets **Cancel Breeding** (visible only while the status is Breeding, same roles as the other activities).
- Dialog: confirmation text, optional note, shows the cross date that will be discarded.
- Result: status `Current`, `breedingStartedAt = null`; DOB, IDed number, generation and genotyping records are untouched.
  Genotyping records already saved during that breeding stay (they are records, not part of the status).
- History and the Activity timeline show `Breeding cancelled`.

## Scope

- `domain/breeding.ts`: `cancelBreeding(line)` — only Breeding → Current; other statuses throw `InvalidTransitionError`. 100 % branch coverage; update BR-1 in `docs/01-requirements.md`.
- `worker/routes/lineActivity.ts` + `worker/lib/lineActivity.ts`: action `cancel-breeding`, written through `withLineWrite`.
- **No migration.** `line_versions.change_type` and `activities.type` are CHECK-constrained and have no value for this; a new value would force a rebuild of two large tables. Use `edited` with a fixed summary `Breeding cancelled (cross date YYYY-MM-DD)` and render it specially from the summary/snapshot diff. Record this decision in the Review Log; revisit only if a later ticket rebuilds those tables anyway.
- `app/src/components/ChangeActivityMenu.tsx`, `ActivityDialogs.tsx`, `activityEvents.ts`, `strings.ts`.
- Dashboard: a cancelled line leaves "Currently Breeding" immediately.

## Out of scope

- Making Status editable in the Edit dialog. Reverting Closed → Breeding.

## Steps

1. Domain function and tests. 2. API action + route tests (refused for Current/Closed, Guest, Feeder, stale version → 409). 3. UI + e2e (375/768/1280 px) + docs.

## Acceptance criteria

1. A Breeding line shows Cancel Breeding; after confirming it is Current, the cross date is gone, the DOB and counts are unchanged.
2. The button is absent on Current and Closed lines; a hand-made request on those is refused.
3. History shows who cancelled and when; Restore of an older version still works.
4. The line leaves Currently Breeding on the Dashboard.

## Review Log

### Report — 2026-10-23 — implementer

- Done: `cancelBreeding` in `domain/breeding.ts` (Breeding → Current, drops only `breedingStartedAt`); `validateCancelBreeding`; `POST /api/lines/:id/cancel-breeding` recorded as an `edited` version with the summary `Breeding cancelled (cross date YYYY-MM-DD).` (no migration, as decided); Change Activity item **Cancel Breeding** (disabled with a reason unless Breeding), dialog with an optional note, Activity timeline entry `Breeding cancelled`.
- Decision: a line that started breeding from Closed returns to Current, not Closed (the previous status is not stored). The dialog says what is kept.
- Checks: domain tests and coverage 100 %; API tests (success, DOB/generation/counts unchanged, refusals on Current/Closed, stale version, Guest); e2e `changeActivity.write.spec.ts` at 375 / 768 / 1280 px ✅.
- Follow-up when T-040 is merged: its "Nothing to restore" text names Change Activity generally; mention Cancel Breeding explicitly.
