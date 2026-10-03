# Data model

## 1. Core records

`lines` holds one current row per line. Status is Current, Breeding, or Closed. Related tables hold
phenotypes, attributes, genotyping protocols and records, cryopreservation records, references,
attachments, chat messages, activities, and version snapshots. `users` holds individual accounts;
`settings` and `enumerations` hold administrative configuration.

## 2. Child records

The SQL migrations in `worker/db/migrations/` define the authoritative columns and constraints.
Child records use their own IDs and line foreign keys. Deleted records are retained with a deletion
timestamp. A cryopreservation range is inclusive; its count is derived from the first and last ID.

## 6. Export

The JSON and CSV export builders live in `worker/export/`. The JSON schema is defined in
`worker/export/schema.ts`. Exports omit authentication secrets.

## 7. Write order

Write paths save the line, its children, a version snapshot, and an activity within the same logical
operation. Insert a line before children that reference it. When a protocol becomes current, insert
the protocol before updating `lines.current_protocol_id` so hosted D1 does not depend on deferred
foreign-key checks. See the corresponding write modules and tests for exact transaction behavior.
