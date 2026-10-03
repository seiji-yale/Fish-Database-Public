"""A real SQLite database for the loader's tests, built from the exact same migration files D1
runs (`worker/db/migrations/*.sql`). No mock of the schema: if a migration changes, these tests
see it immediately. Never used outside tests -- the real tool always goes through `d1_client.py`.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "worker" / "db" / "migrations"
TEST_USERS = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "users.sql"


def fresh_db() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.row_factory = sqlite3.Row
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        connection.executescript(path.read_text(encoding="utf-8"))
    connection.executescript(TEST_USERS.read_text(encoding="utf-8"))
    return connection


def rows(connection: sqlite3.Connection, sql: str, params: tuple[object, ...] = ()) -> list[dict[str, object]]:
    cursor = connection.execute(sql, params)
    return [dict(row) for row in cursor.fetchall()]


def run_statements(connection: sqlite3.Connection, statements: list[str]) -> None:
    """Runs `statements` (as `loader.join_statements` would write them to `import.sql`) as one
    all-or-nothing transaction, which is what `wrangler d1 execute --file` gives the real tool (it
    refuses a file with its own `BEGIN`, see `loader.join_statements`). Plain SQLite's
    `executescript` would otherwise commit statement by statement."""
    connection.executescript("\n".join(["BEGIN;", *statements, "COMMIT;", ""]))
