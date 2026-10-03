#!/usr/bin/env python3
"""Fish-Database Excel import (T-004, docs/05-import-spec.md).

    python tools/import/import_xlsx.py --file <path-to-xlsx> --actor-id <user-id> --dry-run --out import/work
    python tools/import/import_xlsx.py --file <path-to-xlsx> --actor-id <user-id> --apply --env local --out import/work
    python tools/import/import_xlsx.py --file <path-to-xlsx> --actor-id <user-id> --apply --env preview --out import/work
    python tools/import/import_xlsx.py --file <path-to-xlsx> --actor-id <user-id> --apply --env production --out import/work

`--dry-run` never touches a database: it reads the workbook (read-only) and writes `report.md`,
`lines.json` and `sql/import.sql` (a preview, assuming an empty database) to `--out`. Read
`report.md`, answer anything under "Unresolved items" in `overrides.yaml`, and re-run until clean.

`--apply` re-reads and re-normalises the workbook the same way, then reads the target
environment's current state and applies only what is safe (OQ-29): a line new to that environment
is inserted; a line that is there but untouched since its own last import (still `version_no = 1`,
`change_type = 'imported'`) is refreshed; a line with a later version is left alone and reported.
Every environment asks for a typed confirmation (type its name); `--yes` skips it for `local`
and `preview` only -- `production` always asks.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import d1_client
from chat_requests import build_chat_requests
from loader import (
    ELIGIBILITY_QUERY,
    IMPORTED_CHAT_LINE_IDS_QUERY,
    build_chat_request_statements,
    build_line_statements,
    existing_lines_by_name,
    join_statements,
    lines_with_imported_chat,
    plan_for,
    snapshot_dict,
)
from normalize import normalize_line
from overrides import apply_overrides, load_overrides
from reader import file_fingerprint, read_sheet_inventory, read_task_management_rows, read_ver11_rows
from report import TaskManagementSummary, render_report
from sql_text import sql_insert
from ulid import new_id

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OVERRIDES_PATH = Path(__file__).resolve().parent / "overrides.yaml"
SOURCE_SHEET = "Ver. 1.1"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _valid_actor_id(actor_id: str) -> bool:
    return re.fullmatch(r"[0-9A-HJKMNP-TV-Z]{26}", actor_id) is not None


def load_and_normalize(file: Path, overrides_path: Path):
    """Shared by `--dry-run` and `--apply`: reads the workbook and returns everything downstream
    needs. Never touches a database."""
    sheet_inventory = read_sheet_inventory(file)
    overrides = load_overrides(overrides_path)
    entries = []
    for record in read_ver11_rows(file):
        line, diagnostics = normalize_line(record.values)
        diagnostics = apply_overrides(line, diagnostics, overrides)
        entries.append((line, diagnostics))
    known_names = {line.name for line, _diagnostics in entries}
    task_rows = read_task_management_rows(file)
    requests, unmatched = build_chat_requests(task_rows, known_names)
    task_management = TaskManagementSummary(
        source_rows=len(task_rows), messages_created=len(requests), unmatched=unmatched
    )
    return sheet_inventory, entries, requests, task_management


def _write_outputs(out_dir: Path, report_text: str, entries, extra_sql: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.md").write_text(report_text, encoding="utf-8")
    (out_dir / "lines.json").write_text(
        json.dumps([snapshot_dict(line) for line, _diagnostics in entries], indent=2), encoding="utf-8"
    )
    sql_dir = out_dir / "sql"
    sql_dir.mkdir(exist_ok=True)
    (sql_dir / "import.sql").write_text(extra_sql, encoding="utf-8")


def cmd_dry_run(file: Path, out_dir: Path, overrides_path: Path, actor_id: str) -> None:
    if not _valid_actor_id(actor_id):
        raise ValueError("actor_id must be a 26-character ULID")
    before = file_fingerprint(file)
    sheet_inventory, entries, requests, task_management = load_and_normalize(file, overrides_path)

    # A preview only: every line as a fresh "insert", against no real database. Never executed.
    statements: list[str] = []
    line_ids: dict[str, str] = {}
    for line, _diagnostics in entries:
        line_statements, line_id = build_line_statements(line, "insert", None, actor_id)
        statements += line_statements
        line_ids[line.name] = line_id
    for request in requests:
        statements += build_chat_request_statements(line_ids[request.line_name], request, actor_id)
    preview_sql = join_statements(statements)

    report_text = render_report(
        generated_at=_now_iso(), source_file=file.name, sheet_inventory=sheet_inventory,
        entries=entries, task_management=task_management,
    )
    _write_outputs(out_dir, report_text, entries, preview_sql)

    after = file_fingerprint(file)
    if before != after:
        raise SystemExit(f"{file} changed while reading it; refusing to trust this run's output.")
    print(f"Dry run complete: {len(entries)} lines, {len(requests)} chat messages (preview).")
    print(f"Wrote {out_dir / 'report.md'}, {out_dir / 'lines.json'}, {out_dir / 'sql' / 'import.sql'}.")


def _confirm(env: str, assume_yes: bool) -> None:
    if env != "production" and assume_yes:
        return
    typed = input(f"Type '{env}' to apply to that environment: ")
    if typed.strip() != env:
        raise SystemExit("Confirmation did not match; aborted, nothing was written.")


def cmd_apply(file: Path, env: str, out_dir: Path, overrides_path: Path, assume_yes: bool, actor_id: str) -> None:
    if not _valid_actor_id(actor_id):
        raise ValueError("actor_id must be a 26-character ULID")
    before = file_fingerprint(file)
    sheet_inventory, entries, requests, task_management = load_and_normalize(file, overrides_path)
    db_env = None if env == "local" else env
    actor_rows = d1_client.query(
        db_env,
        f"SELECT id FROM users WHERE id = '{actor_id}' AND is_active = 1 "
        "AND role IN ('admin', 'member') LIMIT 1",
    )
    if len(actor_rows) != 1:
        raise SystemExit("Import actor must be an existing, active Admin or Member in the target environment.")

    existing = existing_lines_by_name(d1_client.query(db_env, ELIGIBILITY_QUERY))
    statements: list[str] = []
    line_ids: dict[str, str] = {}
    inserted, refreshed, skipped = [], [], []
    for line, _diagnostics in entries:
        plan, existing_id = plan_for(line.name, existing)
        if plan == "skip":
            skipped.append(line.name)
            line_ids[line.name] = existing_id
            continue
        line_statements, line_id = build_line_statements(line, plan, existing_id, actor_id)
        statements += line_statements
        line_ids[line.name] = line_id
        (inserted if plan == "insert" else refreshed).append(line.name)

    already_imported = lines_with_imported_chat(d1_client.query(db_env, IMPORTED_CHAT_LINE_IDS_QUERY))
    chat_written, chat_skipped = 0, 0
    for request in requests:
        line_id = line_ids[request.line_name]
        if line_id in already_imported:
            chat_skipped += 1
            continue
        statements += build_chat_request_statements(line_id, request, actor_id)
        chat_written += 1

    started_at = _now_iso()
    report_text = render_report(
        generated_at=started_at, source_file=file.name, sheet_inventory=sheet_inventory,
        entries=entries, task_management=task_management,
    )
    apply_summary = (
        "\n## Apply summary\n\n"
        f"- Environment: `{env}`\n"
        f"- Lines inserted: {len(inserted)}\n"
        f"- Lines refreshed (still at their own imported version 1): {len(refreshed)}\n"
        f"- Lines skipped (edited since import): {len(skipped)}"
        + ("".join(f"\n  - {name}" for name in skipped) if skipped else "") + "\n"
        f"- Chat messages written: {chat_written}\n"
        f"- Chat messages already imported (skipped): {chat_skipped}\n"
    )
    report_text += apply_summary
    statements.append(
        sql_insert(
            "import_runs",
            {
                "id": new_id(),
                "source_file": file.name,
                "source_sheet": SOURCE_SHEET,
                "mode": "apply",
                "started_at": started_at,
                "finished_at": _now_iso(),
                "report_md": report_text,
                "row_count": len(entries),
            },
        )
    )
    full_sql = join_statements(statements)
    _write_outputs(out_dir, report_text, entries, full_sql)

    after = file_fingerprint(file)
    if before != after:
        raise SystemExit(f"{file} changed while reading it; refusing to apply.")

    print(f"About to apply to '{env}': {len(inserted)} insert, {len(refreshed)} refresh, "
          f"{len(skipped)} skip; {chat_written} chat message(s).")
    _confirm(env, assume_yes)
    d1_client.execute_file(db_env, out_dir / "sql" / "import.sql")
    print(f"Applied to '{env}'.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True, type=Path, help="path to Example-Master.xlsx")
    parser.add_argument("--actor-id", required=True, help="ULID of the existing member account credited for imports")
    parser.add_argument("--out", required=True, type=Path, help="output directory (never committed)")
    parser.add_argument(
        "--overrides", type=Path, default=DEFAULT_OVERRIDES_PATH, help="path to overrides.yaml"
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    parser.add_argument("--env", choices=["local", "preview", "production"], help="required with --apply")
    parser.add_argument(
        "--yes", action="store_true", help="skip the confirmation prompt (never for production)"
    )
    args = parser.parse_args(argv)

    if args.apply and not args.env:
        parser.error("--apply requires --env")
    if not _valid_actor_id(args.actor_id):
        parser.error("--actor-id must be a 26-character ULID")
    if not args.file.exists():
        parser.error(f"file not found: {args.file}")

    if args.dry_run:
        cmd_dry_run(args.file, args.out, args.overrides, args.actor_id)
    else:
        cmd_apply(args.file, args.env, args.out, args.overrides, args.yes, args.actor_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
