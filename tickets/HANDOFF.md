# Handoff — 2026-10-30

Read `AGENTS.md`, then this file, then `tickets/STATUS.md`. Replace this file when work stops for the day.

## State

T-036's production cut-over is done. `main` is at 0f353e2. T-031 to T-040 are all Done.

- **Production** (`fdb-a1470c563d1d11f9b5c84faf`) now runs `main` (T-033 to T-037 included; deployed
  2026-10-30, no migration needed). The Feeding Schedule sheet import was applied the same day (300
  assignments written, 7 provisional users created; counts only — names stay in the owner's private
  sheet folder, never this repo). The owner confirmed the three remaining manual steps are done:
  visual compare + Export now on `/feeding?month=2026-10`, Settings > Users reactivation/invites,
  Settings > Preferences footer and view-only sheet. The Feeding Schedule lane (T-033 to T-037) is
  complete.
- **T-041** (new, from owner feedback the same day): the Feeding Schedule PDF export left the browser
  on a dead `/feeding/print` page with no way back, and the owner wanted Feeding Schedule to be a
  Feeder's home page. Both fixed; see `tickets/T-041-feeder-home-and-print-return.md` for detail. On
  branch `ticket/T-041-feeding-print-return`, **PR #20, not yet merged** — needs the owner's review on
  the preview deploy first. All checks (`typecheck`, `lint`, `test`, `test:e2e` full suite,
  `check:english`, `check:free-tier`, `check:python`, `check:public`) are clean on that branch.
- **Preview** was redeployed from the T-041 branch (not `main`) for the owner to review that PR; its
  database still holds the rehearsal's sheet import from before the cut-over, now stale with respect to
  production. Redeploy preview from `main` (`npm run deploy:preview`) once T-041 merges, if the owner
  wants preview's data to match production again (no migration either way).

## Next for the agent

1. Ask the owner to review PR #20 (T-041) on the preview deploy. On their OK, merge it (PR merges: the
   owner says so in the conversation), then redeploy preview from `main`.
2. There is also an unmerged docs branch `docs/handoff-2026-10-30` (this file) — merge it whenever, it
   only touches `tickets/`.
3. No open ticket after T-041 merges. Ask the owner what comes next.

## Release policy (agreed with the owner, 2026-10-26)

Do not hold finished tickets on branches until Phase 5 ends. One ticket, one branch, one PR; merge to `main` after owner acceptance on the preview and a green `check`. Merge unfinished user-visible work hidden (no link, role-gated) rather than keeping it on a branch. Deploy the shared preview from `main` or the ticket branch (the preview guard needs `origin/main` inside it), and redeploy it from `main` after the merge. Preview deploys (`npm run deploy:preview`, with `db:migrate:preview`) need no approval (owner, 2026-10-27). Production deploys, production migrations and any write to production data need the owner's confirmation each time. PR merges: the owner says so in the conversation (a general "merge and go on" counts for the PRs just discussed).

## Notes and lessons

- **This machine's default `node` is v20 (Anaconda's, on `PATH`), but Wrangler 4 requires Node 22+.**
  `npx wrangler ...`, and anything that shells out to it (`tools/import/feeding/import_feeding.py` via
  `d1_client.py`), fails with "Wrangler requires at least Node.js v22.0.0" otherwise. Node 22 is
  installed via Homebrew but not linked: prepend it for any wrangler/build command —
  `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` — for the rest of the shell session.
- `POST/PATCH/DELETE /api/admin/*` all read the request body as JSON even when no fields are needed
  (`readBody` in `worker/routes/admin.ts`): a bodyless `DELETE /api/admin/users/:id` fails with
  `INVALID_INPUT`; send `{}`.
- **Do not add a real `afterprint`-triggered auto-navigation on a print-only route.** It was tried for
  T-041 (return to the app once the PDF/print dialog closes) but headless Chromium fires `afterprint`
  immediately after `window.print()` rather than after a real dialog closes, so it broke
  `tests/e2e/feedingEvents.write.spec.ts` (silently navigated away before the page could be read) and
  would risk doing the same to a real user under some browser/OS print flow. A plain visible link,
  hidden under `@media print`, is the reliable fix.
- No e2e fixture signs in as a Feeder (only Guest, Admin, and the seeded members). Verifying
  Feeder-only UI (`domain/permissions.hasFeedingHome` and its call sites) still needs a manual check
  against a local `wrangler dev` build: create a temporary Feeder via `POST /api/admin/users`, activate
  it with `POST /api/join/:inviteToken`, sign in, look, then deactivate and `DELETE` it. Adding a
  feeder-role row to `tests/fixtures/users.sql` was considered and rejected: the Day dialog's "Feeder"
  field (who feeds that day) already uses the existing member fixtures for assertions elsewhere, and a
  new fixture user risks rippling into unrelated counts; a real fixture-based Feeder sign-in path is a
  separate, bigger piece of work if it is wanted later.
- Python tool modules under `tools/import/feeding/` are prefixed `feeding_` because `tools/import` has its own `reader.py` and `report.py`; test files must have unique names across `tools/`.
- Stacked PRs (T-036 on main while T-037 was open) conflicted in `tickets/STATUS.md` and the end of `base.css` (both append blocks): merge `origin/main` locally, keep both sides, close the CSS braces, run `npm run build` and push.
- A preview of two unmerged branches is a local, unpushed branch that merges both (the preview guard only needs `origin/main` inside it); delete it afterwards.
- Real names never go into tests, docs or fixtures (the owner's sheet has real first names): use `Feeder One/Two/Three/Four`.
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
