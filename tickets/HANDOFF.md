# Handoff — 2026-10-27 (night)

Read `AGENTS.md`, then this file, then `tickets/STATUS.md`. Replace this file when work stops for the day.

## State

Work paused on 2026-10-27. PRs #13 to #18 are merged (T-033 API, T-034 page, T-035 export and notes, T-036 sheet import tool, T-037 events UI, and the handoffs). `main` is at e6336df. T-031 to T-040 are Done except **T-036 (Review)**: its Step 4, the production cut-over, has not happened.

- **Production** still runs the first release (Worker 4a82b9a7, migration 0014, T-033 to T-035). It does **not** have T-037 (events UI) or T-036 (the `Provisional` mark in Settings > Users). Neither needs a migration: a deploy of `main` is enough, after the owner's confirmation.
- **Preview** runs a local combined branch of T-036 and T-037 (d8f24c15), equal in content to `main`. The preview database holds the real sheet's days (297 days imported, 6 provisional users) from the rehearsal; redeploy it from `main` with `npm run deploy:preview`.
- The owner accepted T-033 to T-035 on the preview. T-036 and T-037 were merged on the owner's word; the preview review of the provisional users and of the imported days was offered but not reported back.

## The feeding sheet (private data)

- The latest workbook (all 12 tabs of 2026 visible; downloaded 2026-10-27) is in the owner's private folder `~/Dropbox/Seiji/fish-database-private/feeding-sheet/2026-10-27/sheet.xlsx` (a copy is in `~/scratch/fish-feeding-sheet/2026-10-27/`). The preview rehearsal's report is next to it (`preview-report.md`). It holds real first names and a personal contact in the footer: never commit it, its reports or real names; tests use `Feeder One/Two/Three`.
- If the owner changes the sheet again, download it again (`https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx`; the id is in the owner's link, not recorded here) into a new dated folder.
- Owner decisions: names in the sheet that are no users become **provisional users** (inactive Feeders without a password), on production too; an Admin decides in Settings > Users whether to reactivate or leave each one. The first-week template leftovers in **November and December 2026 are excluded and stay empty** (`--exclude "November2026!E7:I7" --exclude "December2026!E7:I7"`).

## Next for the agent

1. **Production cut-over (T-036 Step 4)**, only with the owner's confirmation at each production step (runbook: `docs/06-operations.md` section 5, tool: `docs/05-import-spec.md` section 8):
   1. Deploy `main` to production (no migration): `npm run build && npx wrangler deploy --config wrangler.jsonc --env production`.
   2. Dry run against production (read only): `npm run import:feeding -- <sheet.xlsx> --env production --create-missing-users --exclude "November2026!E7:I7" --exclude "December2026!E7:I7" --out <private folder>`. Show the owner the counts (per person and month, orphans, the provisional users that would be created, any production user whose name does not match: use `--alias`).
   3. After the owner signs off the report: the same command with `--apply` (the owner types `production`), then open `/feeding?month=2026-10` and compare with the sheet, run **Export now**.
   4. Owner: Settings > Users: reactivate the people who feed from now on and invite them; Settings > Preferences: paste the sheet's footer into Feeding Schedule notes and links (the emergency contact and links); make the sheet view-only.
   5. Mark T-036 Done in `tickets/STATUS.md` (a docs PR).
2. Phase 5 has no other open ticket. Ask the owner what comes next (the Feeding Schedule lane is complete once the cut-over is done).

## Release policy (agreed with the owner, 2026-10-26)

Do not hold finished tickets on branches until Phase 5 ends. One ticket, one branch, one PR; merge to `main` after owner acceptance on the preview and a green `check`. Deploy production at natural boundaries: T-032 and T-038 (both done, each alone), and the Feeding Schedule lane (T-033 to T-037) around T-034 and the T-036 cut-over, with a full rehearsal on a production copy before the cut-over. Merge unfinished user-visible work hidden (no link, role-gated) rather than keeping it on a branch. Deploy the shared preview from `main` or the ticket branch (the preview guard needs `origin/main` inside it), and redeploy it from `main` after the merge. Preview deploys (`npm run deploy:preview`, with `db:migrate:preview`) need no approval (owner, 2026-10-27). Production deploys, production migrations and any write to production data need the owner's confirmation each time. PR merges: the owner says so in the conversation (a general "merge and go on" counts for the PRs just discussed).

## Next for the agent

- **T-037** (events UI in the Day dialog: add, edit, remove, weekly repeat with a dry-run preview; the API exists since T-033) can start any time.
- **T-036** (Google Sheet import tool and cut-over) touches production data: before starting, agree with the owner on where the exported .xlsx is, the months (2026-10 to 2026-12), and how sheet names map to app users; the runbook is `docs/08-feeding-schedule-and-guest-access.md` section 7.
- Set a ticket Ready in `tickets/STATUS.md` before starting it; one ticket, one branch, one PR.

## Notes and lessons

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
