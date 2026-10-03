import datetime as dt

import pytest
from tz import local_datetime_to_utc_iso, local_noon_to_utc_iso, to_iso_date


def test_to_iso_date_accepts_date_datetime_and_iso_string():
    assert to_iso_date(dt.date(2026, 1, 8)) == "2026-01-08"
    assert to_iso_date(dt.datetime(2026, 1, 8, 0, 0)) == "2026-01-08"
    assert to_iso_date("2026-01-08") == "2026-01-08"


def test_to_iso_date_none_and_na_are_blank():
    assert to_iso_date(None) is None
    assert to_iso_date("N/A") is None
    assert to_iso_date("n/a") is None
    assert to_iso_date("") is None


def test_to_iso_date_rejects_garbage():
    with pytest.raises(ValueError):
        to_iso_date("not a date")


def test_local_noon_to_utc_handles_daylight_saving():
    # EDT (UTC-4) in summer.
    assert local_noon_to_utc_iso(dt.date(2026, 4, 10)) == "2026-04-10T16:00:00Z"
    # EST (UTC-5) in winter.
    assert local_noon_to_utc_iso(dt.date(2026, 1, 8)) == "2026-01-08T17:00:00Z"


def test_local_noon_to_utc_rejects_blank():
    with pytest.raises(ValueError):
        local_noon_to_utc_iso(None)


def test_local_datetime_to_utc_handles_a_real_time_of_day():
    assert local_datetime_to_utc_iso(dt.datetime(2025, 9, 8, 10, 18, 50)) == "2025-09-08T14:18:50Z"
    assert local_datetime_to_utc_iso("2025-09-08T10:18:50") == "2025-09-08T14:18:50Z"


def test_local_datetime_to_utc_rejects_a_date_only_value():
    with pytest.raises(TypeError):
        local_datetime_to_utc_iso(dt.date(2025, 9, 8))
    with pytest.raises(TypeError):
        local_datetime_to_utc_iso(None)
