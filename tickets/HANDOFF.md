# Handoff — 2026-10-26 (evening)

Read `AGENTS.md`, then this file, then `tickets/STATUS.md`. Replace this file when work stops for the day.

## State

PRs #3 to #7, #9, #10 and #11 are merged and deployed. `main` is at c97f9e8 plus the docs PR that carries this file; production and the preview run `main` at c97f9e8 (T-032 and T-038 shipped, no migration). Migration 0013 is the latest. T-031, T-032, T-038, T-039 and T-040 are Done. No ticket branch is open; T-033 has not been started (Draft in STATUS.md).

## Release policy (agreed with the owner, 2026-10-26)

Do not hold finished tickets on branches until Phase 5 ends. One ticket, one branch, one PR; merge to `main` after owner acceptance on the preview and a green `check`. Deploy production at natural boundaries: T-032 and T-038 (both done, each alone), and the Feeding Schedule lane (T-033 to T-037) around T-034 and the T-036 cut-over, with a full rehearsal on a production copy before the cut-over. Merge unfinished user-visible work hidden (no link, role-gated) rather than keeping it on a branch. Deploy the shared preview from `main` or the ticket branch (the preview guard needs `origin/main` inside it), and redeploy it from `main` after the merge. The owner approves each preview and production deploy, and a merge only when they said so for that PR; ask again for each new deploy, an earlier approval does not carry over.

## Next for the agent

- The Feeding Schedule lane: T-033 first (data and API; migration 0014), then T-034 onward (`docs/08-feeding-schedule-and-guest-access.md` section 12). Set the ticket Ready in `tickets/STATUS.md` first; one ticket, one branch, one PR. Ask the owner before the first step.
- T-032 left two hooks for the lane: `worker/routeCoverage.test.ts` needs a `feeding` row for every new route (an unclassified route fails the test), and `app/src/App.tsx` serves a placeholder at `/feeding` behind `feeding.read` until T-034 replaces it. T-034 also adds the account-menu `Feeding Schedule` entry for Feeders (FR-GUEST-02).
- The next production deploy of the lane happens around T-034 and the T-036 cut-over, after a full rehearsal on a production copy (release policy below).

## Notes and lessons

- Agents can merge PRs only after the required check `check` passes on the PR head and the branch is up to date with `main`. Update a branch by merging `origin/main` locally with the noreply identity and pushing, not with GitHub's update-branch button (it would use the owner's account identity).
- UI conventions from T-038: actions that look the same everywhere (upload, remove, copy, open, download, History) are icon buttons (`components/Icons.tsx`, an accessible name and a tooltip); removing a file asks first; a list of rows that carry a note sets each row off with a divider.
- A full e2e run on the shared preview-less local server is parallel: after an upload the page reloads the line, so a spec that uploads twice in a row must wait for the first file to show before the second (a stale version gives 409).
- Restricted roles (Guest, Feeder) get overview shapes from `domain/lineOverview.ts`; tests that read full data must sign in as a Member (`signedInFetch`), not `guestFetch`. E2E specs that mock `/api/session` must include `capabilities`.
- E2E specs must not use `new Date().toISOString()` for "today": the server's day is America/New_York, so in the New York evening UTC is a day ahead and future-date validation fails. Also keep e2e line names unique across spec files.
- Rehearsal on D1: `wrangler d1 execute --file` with a raw production export fails (cycle `lines` ↔ `id_protocols`, import ignores `defer_foreign_keys`). Create `fish-rehearsal`, apply migrations up to the previous one, clear the seed rows, load data table by table with `lines.current_protocol_id` set last, then run `npm run db:migrate:rehearsal`; delete the database afterwards. The real `wrangler.jsonc` keeps a placeholder id for it.
- Table rebuild with foreign keys on D1: use copy-aside (`users_copy`); see `0013_feeder_role.sql` and `docs/03-data-model.md` section 5.
- Run `npm run test:e2e` (not bare `npx playwright test`): it resets the local database. Known flakes: `chat.write.spec.ts` "T-023 Part D", `newLine.write.spec.ts` AC1/AC2, and once `lineDetail.spec.ts` "two PCR protocols" on phone-375 (passed on rerun). The e2e run rewrites nothing under `tests/e2e/__screenshots__` now, but check `git status` before committing.
- `.venv` is needed for pytest (`python3 -m venv .venv && . .venv/bin/activate && pip install -r tools/requirements-dev.txt`); `check:python` was not run for T-032.
- Stray untracked files `fish-database@0.0.0`, `npm`, `tsx`, `vite`, `rangler.jsonc` in the checkout come from old shell mistakes; do not add them.
- Reply to the owner in Japanese; code, docs and commits stay English. `.ab` in the owner's request means `.ab1`.
