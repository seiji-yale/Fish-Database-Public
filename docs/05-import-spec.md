# Import specification

The optional importer reads a workbook with the supported master-sheet layout, produces a dry-run
report, and applies data only after a maintainer reviews and resolves the report. It never modifies
the input workbook. See [import instructions](import.md) for commands and required actor selection.

## 2. Columns and dates

`tools/import/reader.py` defines the supported sheets and column names. Imported dates become ISO
dates; timestamps are stored in UTC. Empty and malformed cells are reported.

## 3. Normalization

`tools/import/normalize.py` maps source values into the database vocabulary. Protocols and freezer
records are normalized and checked. Ambiguous values remain unresolved for human review.

## 5. Requests

`tools/import/chat_requests.py` matches requests to known lines and attributes them to an explicit
active account. It reports unmatched or ambiguous rows.

## 6. Dry-run report

The report lists planned writes, normalizations, and unresolved items. Review it before applying.

## 7. Overrides

Provide installation-specific answers in a private overrides file. Do not commit a real workbook,
its report, or overrides containing live line or member information.

## 8. Feeding Schedule sheet (T-036)

`tools/import/feeding/import_feeding.py` reads the lab's feeding Google Sheet, downloaded as `.xlsx`, and
writes the days into `feeding_assignments`. The file is real lab data: keep it outside the repository (for
example in the private Dropbox folder), never commit it, and never commit its report (it names people).

    npm run import:feeding -- <workbook.xlsx> --env local|preview|production [options]

| Option                      | Meaning                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--months 2026-10,...`      | Months to read (default: every `MonthYYYY` tab, whether hidden or visible).                                                        |
| `--create-missing-users`    | A sheet name that is no user's becomes a **provisional user**: an inactive Feeder without a password (see below).                  |
| `--alias "F2=Feeder Two"`   | Treat a sheet name as an existing user's name (repeatable).                                                                        |
| `--exclude "Nov2026!E7:I7"` | Skip cells, for example template leftovers on real dates (repeatable; one row per range).                                          |
| `--actor <Name>`            | The user the rows are written as (default: the first active Admin by name).                                                        |
| `--apply`, `--yes`          | Run the SQL; `--yes` skips the typed confirmation for `local` and `preview` only. Production always asks for its name to be typed. |
| `--out <folder>`            | Where `feeding-report.md` and `feeding.sql` go (default `import/work`, git-ignored).                                               |

Reading. Each tab holds a month in week blocks: the day numbers (formulas, so the file must contain their
cached values), the feeder's first name under each day, and an event text under that. The month comes from the
tab name; the reader checks the weekday headers (`C5:I5`), the year (`D4`), that the day numbers run from 1 to the
month's length in order, and that day 1 sits in the right weekday column. Anything else stops the run with a
message (it never guesses). A name with no day number above it is an **orphan** (days of the neighbouring months)
and is skipped. Events are counted, not imported.

Writing. The default is a dry run: nothing is written, and the report lists every person's days per month, a
calendar per month, orphans, exclusions, unknown names and the provisional users to create. A month with only its
first week filled is flagged: it is usually a template leftover, and the report prints the `--exclude` to use.
`--apply` runs one SQL file (all or nothing). It never deletes: an earlier imported value is closed
(`replaced_at`, `replaced_by`) and the new one inserted; a value already imported and unchanged is left alone, so a
second run changes nothing; a day edited in the app (`imported_from IS NULL`) is never overwritten and is listed.
`imported_from` keeps the source cell (`October2026!G7`).

Provisional users. A name no user has stops the run unless `--create-missing-users` is given. Each such name
becomes an **inactive Feeder without a password**, with a `user_added` activity. Their past days show the name
in the calendar and the totals. Settings → Users marks them `Provisional` and says how many are waiting (Show
removed users): an Admin **reactivates** a person who feeds from now on (then sends an invite) or leaves them
inactive. Nothing else changes for a person left inactive. The mark disappears when the person is reactivated.
