"""ULID generation, matching the shape (not the algorithm) of worker/db/ids.ts::newId: a
48-bit millisecond timestamp followed by 80 random bits, encoded as 26 Crockford base-32
characters. Any unique TEXT works as a primary key (the schema has no ULID CHECK), but using
the same shape keeps ids from this tool visually consistent with ones the app creates.
"""

from __future__ import annotations

import os
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_id(now_ms: int | None = None) -> str:
    """A fresh ULID. `now_ms` is exposed for deterministic tests."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    time_part = []
    remaining = now_ms
    for _ in range(10):
        time_part.append(_CROCKFORD[remaining % 32])
        remaining //= 32
    random_part = [_CROCKFORD[byte % 32] for byte in os.urandom(16)]
    return "".join(reversed(time_part)) + "".join(random_part)
