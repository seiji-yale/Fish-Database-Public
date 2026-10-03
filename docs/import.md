# Optional Excel import

`tools/import/import_xlsx.py` maps a specific workbook layout into this application. It is an
example importer, not a general Excel-to-database converter. New installations can start with an
empty database and add lines through the app.

The importer reads an existing workbook without modifying it. Keep your workbook and any manual
`overrides.yaml` outside the public repository. Run a dry run and review `report.md` before using
`--apply`; the latter requires a typed environment confirmation for production. The import tool
does not replace existing lines that have been edited in the app since their import.

All imported activity needs an existing, active member account as its author. Supply that user's
ID through `--actor-id`; obtain it from your own database after inviting the person. Run the
import on a local or preview copy first. The app becomes the source of truth after launch.
