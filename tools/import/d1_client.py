"""A thin wrapper around `wrangler d1 execute`, the only way this tool talks to a database.
`--apply` needs to read a target environment's current state (to decide, per OQ-29, whether a line
is new, safe to refresh, or must be skipped) and then run the generated SQL against it; both go
through here so there is exactly one place that shells out to `wrangler`.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class D1Error(RuntimeError):
    """`wrangler d1 execute` exited non-zero; `stderr` is `wrangler`'s own message."""


def _env_args(env: str | None) -> list[str]:
    """`None` -> the local dev database (`--local`); a named environment -> `--remote --env <name>`."""
    return ["--local"] if env is None else ["--remote", "--env", env]


def _run(args: list[str]) -> str:
    result = subprocess.run(
        ["npx", "wrangler", *args], capture_output=True, text=True, cwd=REPO_ROOT, check=False
    )
    if result.returncode != 0:
        raise D1Error(result.stderr.strip() or result.stdout.strip())
    return result.stdout


def query(env: str | None, sql: str) -> list[dict[str, object]]:
    """Runs a read-only `SELECT` and returns its rows as dicts. `env=None` reads the local database."""
    output = _run(["d1", "execute", "DB", "--json", *_env_args(env), "--command", sql])
    data = json.loads(output)
    if not data or not data[0].get("results"):
        return []
    return data[0]["results"]


def execute_file(env: str | None, sql_path: Path) -> None:
    """Runs every statement in `sql_path` against the target database (one `wrangler` call)."""
    _run(["d1", "execute", "DB", *_env_args(env), "--file", str(sql_path)])
