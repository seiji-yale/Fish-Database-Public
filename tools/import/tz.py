"""Date/timestamp conversions shared by the normaliser: dates are stored as `YYYY-MM-DD` text;
the one place a time-of-day is invented (docs/05-import-spec.md section 2, column `AE Last Update`)
is turned into an ISO-8601 UTC timestamp assuming noon in the lab's timezone, matching how the app
displays timestamps (`AGENTS.md` section 4: store UTC, display `America/New_York`).
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

LAB_TZ = ZoneInfo("America/New_York")


def to_iso_date(value: object) -> str | None:
    """A cell value to `YYYY-MM-DD`, or `None` for a blank cell or the literal `N/A`."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if text == "" or text.upper() == "N/A":
            return None
        dt.date.fromisoformat(text)  # validates; raises ValueError if malformed
        return text
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    raise TypeError(f"Cannot read a date from {value!r}")


def local_noon_to_utc_iso(value: object) -> str:
    """A date-only cell value to an ISO-8601 UTC timestamp at local noon (`AE Last Update`,
    `Posted`, `Due` -- Excel dates with no meaningful time-of-day)."""
    iso_date = to_iso_date(value)
    if iso_date is None:
        raise ValueError("Date must not be blank")
    local_noon = dt.datetime.fromisoformat(iso_date + "T12:00:00").replace(tzinfo=LAB_TZ)
    return local_noon.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local_datetime_to_utc_iso(value: object) -> str:
    """A cell value that already carries a real time-of-day (Task Management `Last Updated`) to an
    ISO-8601 UTC timestamp, treating the naive value as local `America/New_York` time."""
    if isinstance(value, str):
        value = dt.datetime.fromisoformat(value)
    if not isinstance(value, dt.datetime):
        raise TypeError(f"Expected a datetime, got {value!r}")
    localized = value.replace(tzinfo=LAB_TZ)
    return localized.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
