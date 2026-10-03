# Requirements

This reusable application tracks zebrafish lines for a small team. It provides a dashboard, line
list and detail pages, line creation and editing, genotyping and cryopreservation records, activity
history, images, references, and per-line messages. Members have individual accounts. Admins manage
invites and settings; a Guest link provides read-only access.

The application records revisions and uses soft deletion for line-related data. An optional Dropbox
mirror exports a readable copy. The Excel importer is optional and requires a reviewed dry run before
applying any data. Installation-specific requirements and live data belong in private documentation.

The domain and API tests are the executable description of detailed validation and business rules.
