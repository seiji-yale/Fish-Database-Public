# Operations

For new deployments and recovery, use [setup and operations](setup.md). Keep production resource
IDs, hostnames, credentials, backups, and account rosters in private operations records.

## 1. Dropbox mirror

The optional mirror writes JSON, CSV, images, logs, and a standalone HTML snapshot into its own app
folder. A scheduled Worker runs it when configured. Configure each environment separately and verify
the target folder before enabling the schedule.

`latest/` holds `fish-database.json` (everything, including history and removed items) and one CSV per
table: `lines.csv`, `id_protocols.csv`, `genotyping_records.csv`, `cryo_records.csv`, `cryo_vial_uses.csv`,
`line_references.csv`, `attachments.csv`, `chat_messages.csv`, `line_versions.csv`, `users.csv`,
`feeding_assignments.csv` and `schedule_events.csv` (the Feeding Schedule with every earlier value of a
day). `tools/import/restore_from_export.py` restores all of it from `fish-database.json`.

## 2. Backup and recovery

Export D1 and R2 before production migration. Rehearse restoration in preview, verify records and
attachments, and use the documented owner runbook for production. Restore authentication separately.

## 3. Attachments

The app stores attachment metadata in D1 and file bytes in R2. Preserve both in backups.

## 4. Releases

Run `npm run check`, `npm run check:public`, `npm run build`, and the browser suite before release.
Review migrations and deploy to preview before production.

Migration `0013_feeder_role.sql` rebuilds the `users` table. Rehearse it on a copy of production
(restore a fresh export or dump into a rehearsal database, run `npm run db:migrate:rehearsal`, sign in,
and compare user ids, roles and password columns) before running `npm run db:migrate:production`.

## 5. Moving the feeding schedule from the Google Sheet

One-time cut-over, with the owner present (the production steps write production data; AGENTS.md section 3).
Details of the tool are in [the import spec](05-import-spec.md) section 8.

1. Release: `npm run db:migrate:production` (the dump is saved first), then deploy.
2. Download the sheet as `.xlsx` (File > Download > Microsoft Excel) into a private folder outside the repository.
   Show every tab first; the tool reads hidden and visible tabs alike.
3. Dry run on the target, for example
   `npm run import:feeding -- <file> --env production --create-missing-users --out <private folder>`. The owner reads
   `feeding-report.md`: the counts per person and month against the sheet, **0 unknown names** (or the provisional
   users listed), the orphans (names before the 1st of a month: skipped) and any month flagged as "only the first
   week is filled". Template leftovers on real dates are excluded with the `--exclude` the report suggests, or
   cleared in the sheet.
4. The owner signs off the report. `--apply` (type `production`). Open `/feeding?month=...` and compare.
5. Run **Export now** (the mirror then carries `feeding_assignments.csv`).
6. Settings > Users: the people named by the sheet are `Provisional`. Reactivate those who feed from now on and
   send them an invite; leave the others inactive.
7. Settings > Preferences: paste the sheet's footer (the emergency contact and the links) into Feeding Schedule
   notes and links. Make the sheet view-only and tell the feeders the app address.

Running the import again is safe (it changes only what the sheet changed since, and never a day edited in the
app). To undo an import, restore the dump taken before the migration or correct the days in the app.

## 7. Cost

This application is designed for a small installation on free tiers. Check current provider limits
before adding services or changing schedules.
