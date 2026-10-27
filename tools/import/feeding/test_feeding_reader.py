import hashlib

import openpyxl
import pytest
from conftest import add_month_tab
from feeding_reader import LayoutError, read_workbook, tab_month


def test_tab_names_are_months():
    assert tab_month("October2026") == "2026-10"
    assert tab_month("January2026") == "2026-01"
    assert tab_month("Sheet1") is None
    assert tab_month("Oct2026") is None


def test_reads_every_assignment_with_its_cell_and_date(workbook_path):
    months = read_workbook(workbook_path, ["2026-10"])
    october = months[0]
    assert october.month == "2026-10" and october.tab == "October2026"
    assert october.days == 31
    assert len(october.assignments) == 31
    first = october.assignments[0]
    assert (first.date, first.name, first.cell) == ("2026-10-01", "Feeder One", "October2026!G7")
    # The 3rd is a Saturday in the second week row of the first block (cell I6).
    third = next(a for a in october.assignments if a.date == "2026-10-03")
    assert (third.name, third.cell) == ("Newcomer", "October2026!I7")
    # Spaces are collapsed, case is kept (matching is done later, case-insensitively).
    assert next(a for a in october.assignments if a.date == "2026-10-10").name == "feeder two"


def test_a_name_without_a_day_number_is_an_orphan_not_an_assignment(workbook_path):
    october = read_workbook(workbook_path, ["2026-10"])[0]
    assert [(o.cell, o.name) for o in october.orphans] == [
        ("October2026!E7", "Feeder One"),
        ("October2026!F7", "Feeder One"),
    ]
    assert all(a.date.startswith("2026-10-") for a in october.assignments)


def test_events_are_counted_not_read(workbook_path):
    assert read_workbook(workbook_path, ["2026-10"])[0].events_ignored == 1


def test_reads_all_month_tabs_in_date_order_without_a_months_list(workbook_path):
    assert [m.month for m in read_workbook(workbook_path)] == ["2026-09", "2026-10", "2026-11"]


def test_a_leftover_on_a_real_date_is_a_normal_assignment_the_report_flags(workbook_path):
    november = read_workbook(workbook_path, ["2026-11"])[0]
    assert [a.date for a in november.assignments] == [f"2026-11-0{d}" for d in range(2, 8)]


def test_a_missing_month_is_refused(workbook_path):
    with pytest.raises(LayoutError, match="No tab for 2027-01"):
        read_workbook(workbook_path, ["2027-01"])


def build(tmp_path, **kwargs):
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    add_month_tab(workbook, 2026, 10, {1: "Feeder One"}, **kwargs)
    path = tmp_path / "bad.xlsx"
    workbook.save(path)
    return path


def test_wrong_weekday_headers_are_refused(tmp_path):
    path = build(tmp_path, headers=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    with pytest.raises(LayoutError, match="C5:I5"):
        read_workbook(path)


def test_a_year_that_does_not_match_the_tab_is_refused(tmp_path):
    with pytest.raises(LayoutError, match="D4 should hold the year 2026"):
        read_workbook(build(tmp_path, year_cell=2025))


def test_a_file_saved_without_the_day_numbers_says_how_to_fix_it(tmp_path):
    with pytest.raises(LayoutError, match="download it again"):
        read_workbook(build(tmp_path, skip_days=True))


def test_a_month_laid_out_for_another_weekday_is_refused(tmp_path):
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    # October 2026 starts on a Thursday; January 2027 (also 31 days) starts on a Friday.
    add_month_tab(workbook, 2026, 10, {}, title="January2027", year_cell=2027)
    path = tmp_path / "shifted.xlsx"
    workbook.save(path)
    with pytest.raises(LayoutError, match="day 1 is in the Thu column but 2027-01-01 is a Fri"):
        read_workbook(path)


def test_day_numbers_out_of_order_are_refused(tmp_path):
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    add_month_tab(workbook, 2026, 10, {})
    workbook["October2026"]["C11"] = 9  # should be 4
    path = tmp_path / "order.xlsx"
    workbook.save(path)
    with pytest.raises(LayoutError, match="not 1 to 31 in order"):
        read_workbook(path)


def test_reading_never_changes_the_file(workbook_path):
    before = hashlib.sha256(workbook_path.read_bytes()).hexdigest()
    read_workbook(workbook_path)
    assert hashlib.sha256(workbook_path.read_bytes()).hexdigest() == before
