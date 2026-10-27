#!/usr/bin/env python3
"""Feeding Schedule sheet import (T-036, docs/08 section 7, docs/05-import-spec.md section 8).

    python tools/import/feeding/import_feeding.py <workbook.xlsx> --env local|preview|production
        [--months 2026-10,2026-11] [--actor <Name>] [--create-missing-users]
        [--alias "Sheet name=User name"] [--exclude "November2026!C7:I7"] [--apply] [--yes] [--out import/work]

Default is a **dry run**: it reads the workbook (never writes to it) and the target database (read-only), and
writes `feeding-report.md` and `feeding.sql` to `--out`. `--apply` runs that SQL as one file (all or nothing).
Re-running is safe: an earlier imported value is replaced only when the sheet changed, and a day changed in
the app is never overwritten. A name that is no user's is refused unless `--create-missing-users`, which
creates provisional users: inactive Feeders without a password, for an Admin to reactivate or leave inactive.
`--apply` always asks for the environment's name to be typed; `--yes` skips that for local and preview only.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]

import d1_client  # noqa: E402
from feeding_mapper import ExistingRow, User, cells_in, plan_import  # noqa: E402
from feeding_reader import LayoutError, read_workbook  # noqa: E402
from feeding_report import render_report  # noqa: E402
from feeding_sql import build_statements, join_statements  # noqa: E402
from ulid import new_id  # noqa: E402

ENVS = ("local", "preview", "production")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _env_arg(env: str) -> str | None:
    return None if env == "local" else env


def load_users(env: str) -> tuple[list[User], list[dict[str, object]]]:
    rows = d1_client.query(_env_arg(env), "SELECT id, name, role, is_active FROM users ORDER BY created_at, id")
    users = [User(str(r["id"]), str(r["name"]), bool(r["is_active"])) for r in rows]
    return users, rows


def pick_actor(rows: list[dict[str, object]], name: str | None) -> tuple[str, str]:
    """The author of the written rows: the named user, or the first active Admin by name."""
    if name is not None:
        for row in rows:
            if str(row["name"]).casefold() == name.casefold() and row["is_active"]:
                return str(row["id"]), str(row["name"])
        raise SystemExit(f"--actor {name!r} is not an active user of this environment.")
    admins = sorted((r for r in rows if r["role"] == "admin" and r["is_active"]), key=lambda r: str(r["name"]))
    if not admins:
        raise SystemExit("No active Admin found to author the rows; pass --actor <Name>.")
    return str(admins[0]["id"]), str(admins[0]["name"])


def load_existing(env: str, months: list[str]) -> list[ExistingRow]:
    first, last = f"{months[0]}-01", f"{months[-1]}-31"
    rows = d1_client.query(
        _env_arg(env),
        "SELECT id, date, user_id, imported_from FROM feeding_assignments "
        f"WHERE replaced_at IS NULL AND date BETWEEN '{first}' AND '{last}'",
    )
    return [
        ExistingRow(str(r["id"]), str(r["date"]), str(r["user_id"]), None if r["imported_from"] is None else str(r["imported_from"]))
        for r in rows
    ]


def parse_aliases(values: list[str]) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for value in values:
        sheet, _, target = value.partition("=")
        if not sheet.strip() or not target.strip():
            raise SystemExit(f"--alias {value!r} must look like \"Sheet name=User name\".")
        aliases[sheet.strip()] = target.strip()
    return aliases


def parse_excludes(values: list[str]) -> set[str]:
    cells: set[str] = set()
    for value in values:
        for part in value.split(","):
            if part.strip():
                try:
                    cells |= cells_in(part)
                except ValueError as error:
                    raise SystemExit(str(error)) from error
    return cells


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("workbook", type=Path, help="the feeding sheet downloaded as .xlsx")
    parser.add_argument("--env", required=True, choices=ENVS)
    parser.add_argument("--months", help="comma-separated YYYY-MM list (default: every month tab)")
    parser.add_argument("--actor", help="name of the user the rows are written as (default: first active Admin)")
    parser.add_argument("--create-missing-users", action="store_true", help="create provisional (inactive) Feeders for unknown names")
    parser.add_argument("--alias", action="append", default=[], help='"Sheet name=User name" (repeatable)')
    parser.add_argument("--exclude", action="append", default=[], help="cells to skip, e.g. November2026!C7:I7 (repeatable)")
    parser.add_argument("--apply", action="store_true", help="run the SQL (default: dry run)")
    parser.add_argument("--yes", action="store_true", help="skip the typed confirmation (local and preview only)")
    parser.add_argument("--out", type=Path, default=Path("import/work"))
    return parser.parse_args(argv)


def confirm(env: str, assume_yes: bool) -> None:
    if env != "production" and assume_yes:
        return
    if input(f"Type '{env}' to apply to that environment: ").strip() != env:
        raise SystemExit("Confirmation did not match; aborted, nothing was written.")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    months = None if args.months is None else [m.strip() for m in args.months.split(",") if m.strip()]
    try:
        read = read_workbook(args.workbook, months)
    except LayoutError as error:
        print(f"The sheet cannot be read: {error}", file=sys.stderr)
        return 1
    month_list = [m.month for m in read]
    users, rows = load_users(args.env)
    actor_id, actor_name = pick_actor(rows, args.actor)
    plan = plan_import(
        read,
        users,
        load_existing(args.env, month_list),
        create_missing=args.create_missing_users,
        new_id=new_id,
        aliases=parse_aliases(args.alias),
        exclude=parse_excludes(args.exclude),
    )
    now = _now_iso()
    sql = join_statements(build_statements(plan, actor_id, now, new_id))
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "feeding-report.md").write_text(
        render_report(generated_at=now, source_name=args.workbook.name, env=args.env, months=read, plan=plan, actor=actor_name),
        encoding="utf-8",
    )
    (args.out / "feeding.sql").write_text(sql, encoding="utf-8")
    print(
        f"{len(plan.writes)} to write, {len(plan.unchanged)} unchanged, {len(plan.kept_app_days)} kept (changed in the app), "
        f"{len(plan.new_users)} provisional users, {len(plan.unknown_names)} unknown names."
    )
    print(f"Wrote {args.out / 'feeding-report.md'} and {args.out / 'feeding.sql'}.")
    if plan.unknown_names:
        print("Unknown names: " + ", ".join(plan.unknown_names), file=sys.stderr)
        if args.apply:
            print("Refusing to apply: resolve the unknown names first (see the report).", file=sys.stderr)
            return 1
    if not args.apply:
        print("Dry run: nothing was changed.")
        return 0
    if not sql:
        print("Nothing to write.")
        return 0
    confirm(args.env, args.yes)
    try:
        d1_client.execute_file(_env_arg(args.env), args.out / "feeding.sql")
    except d1_client.D1Error as error:
        print(f"Apply failed (the file is all or nothing, so nothing was written): {error}", file=sys.stderr)
        return 1
    print(f"Applied to {args.env}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
