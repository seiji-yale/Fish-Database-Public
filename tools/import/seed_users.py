"""Read user IDs from a SQL seed file for local fixtures and migration checks."""

from __future__ import annotations

import re
from pathlib import Path

_INSERT_RE = re.compile(r"'([0-9A-Z]{26})',\s*'([^']+)'")


def load_user_ids_from_sql(path: Path) -> dict[str, str]:
    """Return `{name: id}` for every user row in a seed file."""
    text = path.read_text(encoding="utf-8")
    ids = {name: user_id for user_id, name in _INSERT_RE.findall(text)}
    if not ids:
        raise ValueError(f"No user rows found in {path}")
    return ids


def load_seeded_user_ids(migrations_dir: Path) -> dict[str, str]:
    return load_user_ids_from_sql(migrations_dir / "0002_seed_users.sql")
