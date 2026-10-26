# Handoff — 2026-10-26 (evening)

Read `AGENTS.md`, then this file, then `tickets/STATUS.md`. Replace this file when work stops for the day.

## State

PRs #3 to #7 and #9 are merged and deployed. `main` is at ab07e37 plus the docs PR that carries this file; production and the preview run `main` at ab07e37 (T-032 shipped, no migration). Migration 0013 is the latest. T-031, T-032, T-039 and T-040 are Done.

T-038 (sequence file uploads) is Ready and was started next on branch `ticket/T-038-sequence-files`; check `git branch -a` and the open PRs for how far it got.

## Release policy (agreed with the owner, 2026-10-26)

Do not hold finished tickets on branches until Phase 5 ends. One ticket, one branch, one PR; merge to `main` after owner acceptance on the preview and a green `check`. Deploy production at natural boundaries: T-032 (done), T-038 alone, and the Feeding Schedule lane (T-033 to T-037) around T-034 and the T-036 cut-over, with a full rehearsal on a production copy before the cut-over. Merge unfinished user-visible work hidden (no link, role-gated) rather than keeping it on a branch. Deploy the shared preview from `main` or the ticket branch (the preview guard needs `origin/main` inside it), and redeploy it from `main` after the merge. The owner approves each preview and production deploy.

## Next for the agent

- T-038 (.ab1 / .fasta / .seq uploads), then T-033 onward (`docs/08-feeding-schedule-and-guest-access.md` section 12). Migration numbers: 0013 is used; Feeding Schedule uses 0014.
- T-032 left two hooks for the Feeding Schedule lane: `worker/routeCoverage.test.ts` needs a `feeding` row for every new route (an unclassified route fails the test), and `app/src/App.tsx` serves a placeholder at `/feeding` behind `feeding.read` until T-034 replaces it. T-034 also adds the account-menu `Feeding Schedule` entry for Feeders (FR-GUEST-02).
- Set a ticket Ready in `tickets/STATUS.md` before starting it; one ticket, one branch, one PR.

## Notes and lessons

- Agents can merge PRs only after the required check `check` passes on the PR head and the branch is up to date with `main`. Update a branch by merging `origin/main` locally with the noreply identity and pushing, not with GitHub's update-branch button (it would use the owner's account identity).
- Restricted roles (Guest, Feeder) get overview shapes from `domain/lineOverview.ts`; tests that read full data must sign in as a Member (`signedInFetch`), not `guestFetch`. E2E specs that mock `/api/session` must include `capabilities`.
- E2E specs must not use `new Date().toISOString()` for "today": the server's day is America/New_York, so in the New York evening UTC is a day ahead and future-date validation fails. Also keep e2e line names unique across spec files.
- Rehearsal on D1: `wrangler d1 execute --file` with a raw production export fails (cycle `lines` ↔ `id_protocols`, import ignores `defer_foreign_keys`). Create `fish-rehearsal`, apply migrations up to the previous one, clear the seed rows, load data table by table with `lines.current_protocol_id` set last, then run `npm run db:migrate:rehearsal`; delete the database afterwards. The real `wrangler.jsonc` keeps a placeholder id for it.
- Table rebuild with foreign keys on D1: use copy-aside (`users_copy`); see `0013_feeder_role.sql` and `docs/03-data-model.md` section 5.
- Run `npm run test:e2e` (not bare `npx playwright test`): it resets the local database. Known flakes: `chat.write.spec.ts` "T-023 Part D", `newLine.write.spec.ts` AC1/AC2, and once `lineDetail.spec.ts` "two PCR protocols" on phone-375 (passed on rerun). The e2e run rewrites nothing under `tests/e2e/__screenshots__` now, but check `git status` before committing.
- `.venv` is needed for pytest (`python3 -m venv .venv && . .venv/bin/activate && pip install -r tools/requirements-dev.txt`); `check:python` was not run for T-032.
- Stray untracked files `fish-database@0.0.0`, `npm`, `tsx`, `vite`, `rangler.jsonc` in the checkout come from old shell mistakes; do not add them.
- Reply to the owner in Japanese; code, docs and commits stay English. `.ab` in the owner's request means `.ab1`.
