# Operations

For new deployments and recovery, use [setup and operations](setup.md). Keep production resource
IDs, hostnames, credentials, backups, and account rosters in private operations records.

## 1. Dropbox mirror

The optional mirror writes JSON, CSV, images, logs, and a standalone HTML snapshot into its own app
folder. A scheduled Worker runs it when configured. Configure each environment separately and verify
the target folder before enabling the schedule.

## 2. Backup and recovery

Export D1 and R2 before production migration. Rehearse restoration in preview, verify records and
attachments, and use the documented owner runbook for production. Restore authentication separately.

## 3. Attachments

The app stores attachment metadata in D1 and file bytes in R2. Preserve both in backups.

## 4. Releases

Run `npm run check`, `npm run check:public`, `npm run build`, and the browser suite before release.
Review migrations and deploy to preview before production.

## 7. Cost

This application is designed for a small installation on free tiers. Check current provider limits
before adding services or changing schedules.
