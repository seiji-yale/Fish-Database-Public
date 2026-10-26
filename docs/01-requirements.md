# Requirements

This reusable application tracks zebrafish lines for a small team. It provides a dashboard, line
list and detail pages, line creation and editing, genotyping and cryopreservation records, activity
history, images, references, and per-line messages. Members have individual accounts. Admins manage
invites and settings; a Guest link provides read-only access.

Roles: **Admin** (everything, plus users, settings and restore), **Member** (full view, edits, chat),
**Feeder** (line overview and the Feeding Schedule, no edits or chat; ADR-0006) and **Guest**
(read-only through the shared link). Permissions are capabilities decided in `domain/permissions.ts`
and enforced by the API; the table is in `docs/08-feeding-schedule-and-guest-access.md` §2.2.
A Feeder is created, invited, renamed, deactivated and reactivated like a Member (U-4); an Admin can
change a person between Member, Admin and Feeder at any time, and the last active Admin cannot be demoted.

The application records revisions and uses soft deletion for line-related data. An optional Dropbox
mirror exports a readable copy. The Excel importer is optional and requires a reviewed dry run before
applying any data. Installation-specific requirements and live data belong in private documentation.

The domain and API tests are the executable description of detailed validation and business rules.
