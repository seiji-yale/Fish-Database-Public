# Fish Database

A small web application for tracking zebrafish lines, genotyping protocols, cryopreservation,
history, and lab messages. It runs as one Cloudflare Worker with a D1 database and an R2 bucket.
An optional Dropbox mirror exports readable JSON, CSV, images, and an offline HTML snapshot.

This repository is a reusable application template. Its migrations create an empty line database;
the demo users and lines in `tests/fixtures/` are used only by local development and tests.
Supply your own accounts, data, and deployment configuration. Do not commit live data, account
identifiers, credentials, or a real `wrangler.jsonc`.

## Local development

Use Node.js 22 and Python 3.9 or later. Run:

```sh
npm ci
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r tools/requirements-dev.txt
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

The app opens at `http://localhost:5173`. The local seed prints the demo account password. Local
data is kept under `.wrangler/` and is separate from every hosted environment.

## Checks

```sh
npm run check
npm run check:public
npm run build
npm run test:e2e
```

`check:public` scans files intended for the repository for account addresses, deployment URLs,
database identifiers, and other common data leaks. Review the full tree manually before making
the repository public. CI also runs a secret scanner.

## Set up your own deployment

Follow [Setup and operations](docs/setup.md). Cloudflare Worker secrets and Dropbox OAuth tokens
must be set in the platform, never in Git. The app starts with no real members: create an Admin
through the documented command, then invite each person from Settings. The Guest link gives
read-only access and can be rotated by an Admin.

The Excel importer in `tools/import/` supports one defined workbook layout. It is optional and
never needed for a new empty installation; see [Importing data](docs/import.md).

All application text and documentation are in English. Changes to stored data should go through
the app or a reviewed local/preview migration. Production restores follow the runbook in
[Setup and operations](docs/setup.md).
