"""Restores a Fish-Database environment from an export (`fish-database.json`, T-021, FR-SYNC-04/05).

The file is the one the Dropbox mirror writes to `latest/` and `archive/<date>/`. Ids are kept, so a
restored database is the same database: lines, ID methods, genotyping and cryo records, references,
attachment rows, versions (history), activities, chat messages, users, lists and the three Admin
numbers. Image thumbnails are not copied: restored attachments point at the original image only. Not in the export, so not restored: chat read marks and @mention notifications (everyone's
old messages show as read-state "new"), the lab passphrase, the Admin password and the mirror's own
bookkeeping. Images are files, not rows: `tools/mirror/restore_images.sh` copies them back to R2.

    python tools/import/restore_from_export.py fish-database.json --env local           # empty database
    python tools/import/restore_from_export.py fish-database.json --env preview --wipe --yes
    python tools/import/restore_from_export.py fish-database.json --env rehearsal --yes       # rebuild drill, §2.4
    python tools/import/restore_from_export.py fish-database.json --env local --dry-run --out import/work

Safety: `--env` has no default. A target that already holds lines, activities or chat messages is
refused unless `--wipe` (which deletes all of them first, in the same all-or-nothing file). Anything but
`local` needs `--yes`; `production` is never touched by an agent session (AGENTS.md) -- the maintainer
runs it following docs/06-operations.md section 2.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

from sql_text import sql_insert, sql_literal

# Deleted before a restore with --wipe, children first (foreign keys are immediate).
WIPE_ORDER = (
    "chat_mentions",
    "chat_reads",
    "chat_read_state",
    "chat_messages",
    "activities",
    "line_versions",
    "line_references",  # references an attachment: first
    "attachments",
    "cryo_vial_uses",
    "cryo_records",
    "genotyping_records",
    "id_protocols",
    "line_attributes",
    "line_phenotypes",
    "lines",
    "enumerations",
)

# Per-line lists in the export, in insert order, with the table each belongs to.
LINE_CHILDREN = (
    ("phenotypes", "line_phenotypes"),
    ("attributes", "line_attributes"),
    ("protocols", "id_protocols"),
    ("genotypingRecords", "genotyping_records"),
    ("cryoRecords", "cryo_records"),
    ("cryoVialUses", "cryo_vial_uses"),
    ("attachments", "attachments"),
    ("references", "line_references"),
)

SETTING_KEYS = ("upcoming_breeding_months", "default_annealing_c", "default_cycles")
EMPTY_CHECK = (
    "SELECT (SELECT count(*) FROM lines) AS lines, (SELECT count(*) FROM activities) AS activities, "
    "(SELECT count(*) FROM chat_messages) AS chat_messages"
)


class RestoreError(Exception):
    """The export cannot be restored (or the target refuses it); the message says what to do."""


def _is_row(value: object) -> bool:
    return isinstance(value, dict) and isinstance(value.get("id"), str)


def validate(doc: object) -> dict:
    """Checks the shape of the export; returns it. Raises `RestoreError` listing every problem."""
    problems: list[str] = []
    if not isinstance(doc, dict):
        raise RestoreError("This is not a Fish-Database export (the top level is not an object).")
    for key in ("exported_at", "app_version"):
        if not isinstance(doc.get(key), str):
            problems.append(f"`{key}` is missing")
    for key in ("lines", "users", "enumerations"):
        if not isinstance(doc.get(key), list):
            problems.append(f"`{key}` is missing or not a list")
    for key in ("lineVersions", "activities", "chatMessages"):  # older exports lack these
        if key in doc and not isinstance(doc[key], list):
            problems.append(f"`{key}` is not a list")
    if not isinstance(doc.get("settings"), dict):
        problems.append("`settings` is missing")
    if problems:
        raise RestoreError("This is not a Fish-Database export: " + "; ".join(problems) + ".")
    for index, entry in enumerate(doc["lines"]):
        if not isinstance(entry, dict) or not _is_row(entry.get("line")):
            problems.append(f"lines[{index}] has no `line` with an id")
            continue
        name = entry["line"].get("name", "?")
        for key, _ in LINE_CHILDREN:
            rows = entry.get(key)
            if not isinstance(rows, list) or not all(_is_row(r) for r in rows):
                problems.append(f"line {name}: `{key}` is missing or has a row without an id")
    for key in ("users", "enumerations", "lineVersions", "activities", "chatMessages"):
        if not all(_is_row(r) for r in doc.get(key, [])):
            problems.append(f"`{key}` has a row without an id")
    if problems:
        raise RestoreError("The export is damaged: " + "; ".join(problems[:10]) + ".")
    return doc


def _upsert_user(row: dict) -> str:
    columns = ", ".join(row.keys())
    values = ", ".join(sql_literal(v) for v in row.values())
    updates = ", ".join(f"{k} = excluded.{k}" for k in row if k != "id")
    return f"INSERT INTO users ({columns}) VALUES ({values}) ON CONFLICT (id) DO UPDATE SET {updates};"


def build_statements(doc: dict, wipe: bool) -> list[str]:
    """The SQL, in an order that never relies on deferred foreign keys (docs/03-data-model.md §7):
    a line is written without its current ID method, the methods follow, then one UPDATE points back."""
    statements: list[str] = []
    if wipe:
        statements.append("UPDATE lines SET current_protocol_id = NULL;")
        statements.extend(f"DELETE FROM {table};" for table in WIPE_ORDER)
    statements.extend(_upsert_user(user) for user in doc["users"])
    statements.extend(
        sql_insert("enumerations", row).replace("INSERT INTO", "INSERT OR REPLACE INTO", 1)
        for row in doc["enumerations"]
    )
    pointers: list[tuple[str, str]] = []
    for entry in doc["lines"]:
        line = dict(entry["line"])
        if line.get("current_protocol_id") is not None:
            pointers.append((str(line["id"]), str(line["current_protocol_id"])))
            line["current_protocol_id"] = None
        statements.append(sql_insert("lines", line))
    for key, table in LINE_CHILDREN:
        for entry in doc["lines"]:
            for row in entry[key]:
                # Thumbnails are not in the copy: without the link the app serves the original.
                if table == "attachments" and row.get("thumb_r2_key") is not None:
                    row = {**row, "thumb_r2_key": None}
                statements.append(sql_insert(table, row))
    statements.extend(
        f"UPDATE lines SET current_protocol_id = {sql_literal(protocol)} WHERE id = {sql_literal(line)};"
        for line, protocol in pointers
    )
    for key, table in (
        ("lineVersions", "line_versions"),
        ("activities", "activities"),
        ("chatMessages", "chat_messages"),
    ):
        statements.extend(sql_insert(table, row) for row in doc.get(key, []))
    for key in SETTING_KEYS:
        value = doc["settings"].get(key)
        if value is not None:
            statements.append(
                f"INSERT INTO settings (key, value) VALUES ({sql_literal(key)}, {sql_literal(value)}) "
                "ON CONFLICT (key) DO UPDATE SET value = excluded.value;"
            )
    return statements


def counts(doc: dict) -> dict[str, int]:
    """What the restore will write, per table (also what the drill compares afterwards)."""
    result = {"lines": len(doc["lines"])}
    for key, table in LINE_CHILDREN:
        result[table] = sum(len(entry[key]) for entry in doc["lines"])
    result["line_versions"] = len(doc.get("lineVersions", []))
    result["activities"] = len(doc.get("activities", []))
    result["chat_messages"] = len(doc.get("chatMessages", []))
    result["users"] = len(doc["users"])
    result["enumerations"] = len(doc["enumerations"])
    return result


def check_target(existing: dict[str, int], wipe: bool) -> None:
    if wipe:
        return
    found = [f"{n} {name.replace('_', ' ')}" for name, n in existing.items() if n]
    if found:
        raise RestoreError(
            "The target database is not empty (" + ", ".join(found) + "). "
            "Use --wipe to replace everything with the export."
        )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("export", type=Path, help="fish-database.json")
    parser.add_argument("--env", required=True, choices=("local", "preview", "rehearsal", "production"))
    parser.add_argument("--wipe", action="store_true", help="delete the target's data first")
    parser.add_argument("--yes", action="store_true", help="required for anything but --env local")
    parser.add_argument("--dry-run", action="store_true", help="validate and write the SQL, change nothing")
    parser.add_argument("--out", type=Path, help="folder for restore.sql (default: a temporary folder)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.env != "local" and not args.dry_run and not args.yes:
        print(
            f"This changes the {args.env.upper()} database. Run it again with --yes to confirm.",
            file=sys.stderr,
        )
        return 2
    try:
        doc = validate(json.loads(args.export.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError) as error:
        print(f"Cannot read {args.export}: {error}", file=sys.stderr)
        return 1
    except RestoreError as error:
        print(error, file=sys.stderr)
        return 1
    statements = build_statements(doc, args.wipe)
    folder = args.out or Path(tempfile.mkdtemp(prefix="fish-restore-"))
    folder.mkdir(parents=True, exist_ok=True)
    sql_path = folder / "restore.sql"
    sql_path.write_text("\n".join(statements) + "\n", encoding="utf-8")
    wanted = counts(doc)
    print(f"Export of {doc['exported_at']} (app {doc['app_version']}): " + ", ".join(f"{n} {k}" for k, n in wanted.items()))
    if args.dry_run:
        print(f"Dry run: wrote {sql_path} ({len(statements)} statements); nothing was changed.")
        return 0
    import d1_client  # imported late: a dry run needs no wrangler

    env = None if args.env == "local" else args.env
    try:
        row = d1_client.query(env, EMPTY_CHECK)[0]
        check_target({k: int(v) for k, v in row.items()}, args.wipe)
        d1_client.execute_file(env, sql_path)
        for table, expected in wanted.items():
            actual = int(d1_client.query(env, f"SELECT count(*) AS n FROM {table}")[0]["n"])
            if actual < expected or (actual != expected and table != "users"):
                raise RestoreError(f"{table}: restored {actual} rows, the export has {expected}.")
    except (RestoreError, d1_client.D1Error) as error:
        print(f"Restore failed: {error}", file=sys.stderr)
        return 1
    print(f"Restored into {args.env}: every table matches the export. SQL kept at {sql_path}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
