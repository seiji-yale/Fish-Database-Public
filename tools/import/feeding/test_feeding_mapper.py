import pytest
from feeding_mapper import ExistingRow, User, cells_in, plan_import
from feeding_reader import Assignment, MonthRead

ALICE, BOB = User("U-A", "Feeder One"), User("U-B", "Feeder Two")


def month(*items: tuple[str, str, str]) -> MonthRead:
    read = MonthRead(month=items[0][0][:7], tab="October2026")
    read.assignments = [Assignment(date, name, cell) for date, name, cell in items]
    return read


def counter():
    state = {"n": 0}

    def new_id() -> str:
        state["n"] += 1
        return f"NEW{state['n']}"

    return new_id


def plan(items, users=(ALICE, BOB), existing=(), **kwargs):
    kwargs.setdefault("create_missing", False)
    return plan_import([month(*items)], list(users), list(existing), new_id=counter(), **kwargs)


def test_matches_names_ignoring_case_and_spaces_and_writes_new_days():
    result = plan([("2026-10-01", "feeder one", "O!G7"), ("2026-10-02", "Feeder Two", "O!H7")])
    assert [(w.date, w.user_id, w.imported_from, w.replaces) for w in result.writes] == [
        ("2026-10-01", "U-A", "O!G7", None),
        ("2026-10-02", "U-B", "O!H7", None),
    ]
    assert not result.unknown_names and not result.new_users


def test_an_unknown_name_is_listed_and_not_written():
    result = plan([("2026-10-01", "Newcomer", "O!G7"), ("2026-10-02", "Newcomer", "O!H7")])
    assert result.unknown_names == ["Newcomer"]
    assert result.writes == []


def test_create_missing_makes_one_provisional_user_per_name_and_uses_it_for_every_day():
    result = plan(
        [("2026-10-01", "Newcomer", "O!G7"), ("2026-10-02", "newcomer", "O!H7"), ("2026-10-03", "Feeder One", "O!I7")],
        create_missing=True,
    )
    assert [(u.id, u.name) for u in result.new_users] == [("NEW1", "Newcomer")]
    assert [w.user_id for w in result.writes] == ["NEW1", "NEW1", "U-A"]
    assert result.unknown_names == []


def test_an_alias_maps_a_sheet_name_to_an_existing_user():
    result = plan([("2026-10-01", "F2", "O!G7")], aliases={"f2": "Feeder Two"})
    assert result.writes[0].user_id == "U-B" and not result.new_users


def test_an_earlier_import_with_the_same_value_is_left_alone_and_a_changed_one_is_replaced():
    existing = [
        ExistingRow("R1", "2026-10-01", "U-A", "O!G7"),
        ExistingRow("R2", "2026-10-02", "U-A", "O!H7"),
    ]
    result = plan([("2026-10-01", "Feeder One", "O!G7"), ("2026-10-02", "Feeder Two", "O!H7")], existing=existing)
    assert result.unchanged == ["2026-10-01"]
    assert [(w.date, w.user_id, w.replaces) for w in result.writes] == [("2026-10-02", "U-B", "R2")]


def test_a_day_changed_in_the_app_is_never_overwritten():
    existing = [ExistingRow("R1", "2026-10-01", "U-B", None)]
    result = plan([("2026-10-01", "Feeder One", "O!G7")], existing=existing)
    assert result.writes == [] and result.kept_app_days == [("2026-10-01", "Feeder Two")]


def test_an_app_day_of_a_user_who_is_not_in_the_list_still_shows_something():
    existing = [ExistingRow("R1", "2026-10-01", "U-X", None)]
    assert plan([("2026-10-01", "Feeder One", "O!G7")], existing=existing).kept_app_days == [("2026-10-01", "U-X")]


def test_excluded_cells_are_skipped_and_reported():
    result = plan(
        [("2026-10-01", "Feeder One", "O!G7"), ("2026-10-02", "Feeder Two", "O!H7")], exclude={"O!H7"}
    )
    assert [w.date for w in result.writes] == ["2026-10-01"]
    assert [a.cell for a in result.excluded] == ["O!H7"]


def test_imported_days_whose_cell_is_now_empty_are_reported_not_deleted():
    existing = [ExistingRow("R1", "2026-10-09", "U-A", "O!G9")]
    result = plan([("2026-10-01", "Feeder One", "O!G7")], existing=existing)
    assert result.stale_imports == ["2026-10-09"]
    assert [w.date for w in result.writes] == ["2026-10-01"]


def test_cell_ranges():
    assert cells_in("October2026!E7") == {"October2026!E7"}
    assert cells_in("November2026!C7:E7") == {"November2026!C7", "November2026!D7", "November2026!E7"}
    assert len(cells_in("November2026!C7:I7")) == 7
    for bad in ("E7", "November2026!C7:C9", "November2026!E7:C7", "Sheet!A1"):
        with pytest.raises(ValueError):
            cells_in(bad)
    assert cells_in("May2026!Z9:AB9") == {"May2026!Z9", "May2026!AA9", "May2026!AB9"}
