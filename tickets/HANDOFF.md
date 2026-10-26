# Handoff — 2026-10-23

Read `AGENTS.md`, then this file, then `tickets/STATUS.md`. Replace this file when work stops for the day.

## State

| PR  | Branch                         | What                                                                     | State                                                          |
| --- | ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| #3  | `docs/phase5-spec`             | Phase 5 spec, ADR-0006, tickets T-031 to T-040, this handoff             | open, **merge first** (merge commit, not squash)               |
| #4  | `ticket/T-031-feeder-role`     | Feeder role, capabilities, migration 0013                                | open, waiting for the migration rehearsal and owner acceptance |
| #5  | `ticket/T-040-restore-button`  | Restore dialog explains status-only differences, retry on failed preview | open, owner acceptance                                         |
| #6  | `ticket/T-039-cancel-breeding` | Cancel Breeding (Breeding to Current)                                    | open, owner acceptance                                         |

All four pass `npm run check` and `npm run check:public`. Commit identities are noreply only.

## Shared preview

The shared preview currently runs the local, unpushed integration branch `preview/phase5` (origin/main plus the four branches above, merged cleanly). Migration 0013 is applied to the **preview** database. Production is untouched. The preview URL is in the owner's wrangler output (`fish-database-preview`); it is not recorded in the repository.
After a PR merges, redeploy the preview from the updated `main` (`npm run deploy:preview`); the guard refuses a branch without the latest `origin/main`.

## Owner to do

1. Rehearse migration 0013 on a production copy (`docs/06-operations.md` section 4) and record the result in the T-031 Review Log. It is required before production.
2. Try the preview on a phone and a laptop against each PR's checklist: add a Feeder and sign in with the invite (T-031); restore dialog with a status-only version and with a content change (T-040); Cancel Breeding (T-039). Question for T-039: a line that started breeding from Closed returns to Current, not Closed (previous status is not stored). Acceptable?
3. Merge the PRs on the web with "Create a merge commit": #3 first, then #4, #5, #6 (agents cannot merge protected `main`). Then deploy production manually: `npm run db:migrate:production`, then `npm run build && npx wrangler deploy --config wrangler.jsonc --env production`.

## Next for the agent

- After #5 and #6 merge: edit the T-040 text (`restoreNoDifference` in `app/src/strings.ts`) to name Cancel Breeding explicitly.
- Then T-032 (restricted view for Guests and Feeders; includes the route-coverage test, extend `worker/writeRoutes.test.ts`), then T-038 (.ab1 / .fasta / .seq uploads), then T-033 onward (see `docs/08-feeding-schedule-and-guest-access.md` section 12 for lanes). Migration numbers: 0013 is used; Feeding Schedule uses 0014.
- Set a ticket Ready in `tickets/STATUS.md` before starting it; one ticket, one branch, one PR.

## Notes and lessons

- Table rebuild with foreign keys on D1: use copy-aside (`users_copy`), not `users_new` plus rename; see `0013_feeder_role.sql` and `docs/03-data-model.md` section 5.
- Run `npm run test:e2e` (not bare `npx playwright test`): it resets the local database. Known flakes on `main` too: `chat.write.spec.ts` "T-023 Part D" and `newLine.write.spec.ts` AC1/AC2. Discard rewritten `tests/e2e/__screenshots__`.
- `.venv` is needed for pytest (`python3 -m venv .venv && . .venv/bin/activate && pip install -r tools/requirements-dev.txt`).
- Stray untracked files `fish-database@0.0.0`, `npm`, `tsx`, `vite` in the checkout come from an old shell mistake; do not add them.
- Reply to the owner in Japanese; code, docs and commits stay English. `.ab` in the owner's request means `.ab1`.
