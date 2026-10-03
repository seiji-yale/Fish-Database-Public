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
