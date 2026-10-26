# Handoff — 2026-10-25

Read `AGENTS.md`, then this file, then `tickets/STATUS.md`. Replace this file when work stops for the day.

## State

PRs #3 to #6 are merged (merge commits) and deployed. Production runs `main` at a31f1ce with migration 0013 applied (version 27a52fba); the preview runs the same `main`. Migration 0013 was rehearsed on a production copy first (T-031 Review Log). Owner accepted T-031, T-039 and T-040 on the preview.

`tickets/STATUS.md` marks T-031, T-039 and T-040 Done.

## Next for the agent

- T-032 (restricted view for Guests and Feeders: hide the edit buttons for them; extend `worker/writeRoutes.test.ts` as the route-coverage test). Today a Feeder still sees the edit buttons; writes are refused with 403. Then T-038 (.ab1 / .fasta / .seq uploads), then T-033 onward (`docs/08-feeding-schedule-and-guest-access.md` section 12). Migration numbers: 0013 is used; Feeding Schedule uses 0014.
- Set a ticket Ready in `tickets/STATUS.md` before starting it; one ticket, one branch, one PR.

## Notes and lessons

- Agents can merge PRs only after the required check `check` passes on the PR head and the branch is up to date with `main`. Update a branch by merging `origin/main` locally with the noreply identity and pushing, not with GitHub's update-branch button (it would use the owner's account identity).
- E2E specs must not use `new Date().toISOString()` for "today": the server's day is America/New_York, so in the New York evening UTC is a day ahead and future-date validation fails. Also keep e2e line names unique across spec files (two specs creating `<viewport>-rf` collided).
- Rehearsal on D1: `wrangler d1 execute --file` with a raw production export fails (cycle `lines` ↔ `id_protocols`, import ignores `defer_foreign_keys`). Create `fish-rehearsal`, apply migrations up to the previous one, clear the seed rows, load data table by table with `lines.current_protocol_id` set last, then run `npm run db:migrate:rehearsal`; delete the database afterwards. The real `wrangler.jsonc` keeps a placeholder id for it.
- Table rebuild with foreign keys on D1: use copy-aside (`users_copy`); see `0013_feeder_role.sql` and `docs/03-data-model.md` section 5.
- Run `npm run test:e2e` (not bare `npx playwright test`): it resets the local database. Known flakes on `main`: `chat.write.spec.ts` "T-023 Part D" and `newLine.write.spec.ts` AC1/AC2. Discard rewritten `tests/e2e/__screenshots__`.
- `.venv` is needed for pytest (`python3 -m venv .venv && . .venv/bin/activate && pip install -r tools/requirements-dev.txt`).
- Stray untracked files `fish-database@0.0.0`, `npm`, `tsx`, `vite` in the checkout come from an old shell mistake; do not add them.
- Reply to the owner in Japanese; code, docs and commits stay English. `.ab` in the owner's request means `.ab1`.
