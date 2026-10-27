# Handoff — 2026-10-26 (evening)

Read `AGENTS.md`, then this file, then `tickets/STATUS.md`. Replace this file when work stops for the day.

## State

Work paused on 2026-10-27 after the first Feeding Schedule release. PRs #13 (T-033), #14 (T-034) and #15 (T-035) are merged. Production and the preview run `main` at 5dfea03 (production Worker version 4a82b9a7, migration 0014 applied after a dump; preview c5d2a1da). T-031 to T-035 and T-038 to T-040 are Done. The owner accepted T-034 and T-035 on the preview. No PR or ticket branch is open; T-036 and T-037 have not been started (Draft).

The schedule is live but empty in production: nobody has entered days yet. People start using it, or T-036 imports the Google Sheet (the cut-over).

## Release policy (agreed with the owner, 2026-10-26)

Do not hold finished tickets on branches until Phase 5 ends. One ticket, one branch, one PR; merge to `main` after owner acceptance on the preview and a green `check`. Deploy production at natural boundaries: T-032 and T-038 (both done, each alone), and the Feeding Schedule lane (T-033 to T-037) around T-034 and the T-036 cut-over, with a full rehearsal on a production copy before the cut-over. Merge unfinished user-visible work hidden (no link, role-gated) rather than keeping it on a branch. Deploy the shared preview from `main` or the ticket branch (the preview guard needs `origin/main` inside it), and redeploy it from `main` after the merge. Preview deploys (`npm run deploy:preview`, with `db:migrate:preview`) need no approval (owner, 2026-10-27). Production deploys and production migrations need the owner's confirmation each time, and so does each PR merge.

## Next for the agent

- **T-037** (events UI in the Day dialog: add, edit, remove, weekly repeat with a dry-run preview; the API exists since T-033) can start any time.
- **T-036** (Google Sheet import tool and cut-over) touches production data: before starting, agree with the owner on where the exported .xlsx is, the months (2026-10 to 2026-12), and how sheet names map to app users; the runbook is `docs/08-feeding-schedule-and-guest-access.md` section 7.
- Set a ticket Ready in `tickets/STATUS.md` before starting it; one ticket, one branch, one PR.

## Notes and lessons

- Lists ordered by `created_at` then `id` are not deterministic for rows made in the same second (ULID ids made in one millisecond order randomly): order by something meaningful (see `listAssignmentHistory`, `listEventsInRange`).
- A stacked PR (T-035 on T-034) is merged in order; after the first merge, merge `origin/main` into the second branch locally (noreply identity) and wait for its CI again (about 5 to 12 minutes).
- Recent Activity lists line events only, so a `settings_changed` entry is not shown on the Dashboard.
- `npx playwright test <file>` still runs the whole suite on this machine (the web server step resets the database); it takes about a minute.

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
