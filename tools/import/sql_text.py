"""Renders a Python value as a SQLite literal for the generated `import.sql`. Values are never
concatenated from untrusted input in the app (worker/db/queries only binds `?` parameters); this
file exists because `import.sql` is plain SQL text that `wrangler d1 execute --file` runs directly,
so every value that reaches it must be escaped here, in one place, rather than at each call site.
"""

from __future__ import annotations


def sql_literal(value: object) -> str:
    """`None` -> `NULL`; `bool`/`int` -> a bare number (0/1 for booleans, matching the schema's
    INTEGER 0/1 convention); everything else -> a single-quoted string with `'` doubled."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    text = str(value)
    return "'" + text.replace("'", "''") + "'"


def sql_insert(table: str, row: dict[str, object]) -> str:
    """`INSERT INTO <table> (<columns>) VALUES (<literals>);` — column order is the dict's order."""
    columns = ", ".join(row.keys())
    values = ", ".join(sql_literal(value) for value in row.values())
    return f"INSERT INTO {table} ({columns}) VALUES ({values});"
