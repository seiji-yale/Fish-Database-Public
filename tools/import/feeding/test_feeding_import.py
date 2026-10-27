"""The SQL, the report and the command line, against a real SQLite database built from the migrations."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import d1_client
import feeding_report
import import_feeding
import pytest
from feeding_mapper import ExistingRow, User, plan_import
from feeding_reader import read_workbook
from feeding_sql import build_statements, join_statements
from testing_db import fresh_db, rows

ADMIN = "01H00000000000000000000001"
BOB = "01H00000000000000000000003"
ALICE = "01H00000000000000000000002"
NOW = "2026-10-27T12:00:00Z"


def ids():
    state = {"n": 0}

    def new_id() -> str:
        state["n"] += 1
        return f"01TEST{state['n']:020d}"

    return new_id


def run(db: sqlite3.Connection, sql: str) -> None:
    db.executescript("BEGIN;\n" + sql + "COMMIT;")


def users_of(db):
    return [User(r["id"], r["name"], bool(r["is_active"])) for r in rows(db, "SELECT * FROM users")]


def existing_of(db):
    return [
        ExistingRow(r["id"], r["date"], r["user_id"], r["imported_from"])
        for r in rows(db, "SELECT * FROM feeding_assignments WHERE replaced_at IS NULL")
    ]


def apply(db, workbook_path, **kwargs):
    months = read_workbook(workbook_path, ["2026-10"])
    plan = plan_import(
        months, users_of(db), existing_of(db), new_id=ids_with_offset(db), **kwargs
    )
    sql = join_statements(build_statements(plan, BOB, NOW, ids_with_offset(db)))
    run(db, sql)
    return plan, sql


_counter = {"n": 0}


def ids_with_offset(db):
    def new_id() -> str:
        _counter["n"] += 1
        return f"01SQL{_counter['n']:021d}"

    return new_id


@pytest.fixture
def db():
    connection = fresh_db()
    # October's names, as users (Newcomer is the unknown one).
    connection.execute("UPDATE users SET name = 'Feeder One' WHERE id = ?", (ALICE,))
    connection.execute("UPDATE users SET name = 'Feeder Two' WHERE id = ?", (BOB,))
    connection.execute("UPDATE users SET role = 'admin' WHERE id = ?", (BOB,))
    return connection


def test_writes_the_assignments_with_their_source_cell(db, workbook_path):
    plan, _ = apply(db, workbook_path, create_missing=True, aliases={})
    got = rows(db, "SELECT date, user_id, imported_from, created_by, replaced_at FROM feeding_assignments ORDER BY date")
    assert len(got) == 31
    assert got[0] == {
        "date": "2026-10-01", "user_id": ALICE, "imported_from": "October2026!G7",
        "created_by": BOB, "replaced_at": None,
    }
    assert {r["user_id"] for r in got if r["date"] == "2026-10-10"} == {BOB}  # "  feeder two  "
    assert rows(db, "PRAGMA foreign_key_check") == []
    assert len(plan.writes) == 31


def test_a_missing_name_becomes_an_inactive_feeder_without_a_password_and_is_logged(db, workbook_path):
    apply(db, workbook_path, create_missing=True)
    newcomer = rows(db, "SELECT * FROM users WHERE name = 'Newcomer'")[0]
    assert (newcomer["role"], newcomer["is_active"], newcomer["is_builtin"], newcomer["password_hash"], newcomer["must_change_password"]) == (
        "feeder", 0, 0, None, 0,
    )
    assert rows(db, "SELECT user_id FROM feeding_assignments WHERE date = '2026-10-03'")[0]["user_id"] == newcomer["id"]
    log = rows(db, "SELECT type, summary, user_id, ref_type, ref_id FROM activities WHERE type = 'user_added'")
    assert log == [
        {
            "type": "user_added",
            "summary": "User Newcomer added as feeder (provisional, from the Feeding Schedule sheet import).",
            "user_id": BOB, "ref_type": "user", "ref_id": newcomer["id"],
        }
    ]


def test_running_it_again_changes_nothing(db, workbook_path):
    apply(db, workbook_path, create_missing=True)
    before = rows(db, "SELECT * FROM feeding_assignments ORDER BY id")
    users_before = rows(db, "SELECT * FROM users ORDER BY id")
    plan, sql = apply(db, workbook_path, create_missing=True)
    assert sql == "" and plan.writes == [] and len(plan.unchanged) == 31
    assert rows(db, "SELECT * FROM feeding_assignments ORDER BY id") == before
    assert rows(db, "SELECT * FROM users ORDER BY id") == users_before


def test_a_changed_cell_closes_the_old_value_and_an_app_day_is_kept(db, workbook_path):
    apply(db, workbook_path, create_missing=True)
    # Someone changes the 5th in the app; the sheet's 6th is edited later.
    current = rows(db, "SELECT id FROM feeding_assignments WHERE date = '2026-10-05'")[0]["id"]
    db.execute("UPDATE feeding_assignments SET replaced_at = ?, replaced_by = ? WHERE id = ?", (NOW, ALICE, current))
    db.execute(
        "INSERT INTO feeding_assignments (id, date, user_id, note, imported_from, created_at, created_by) "
        "VALUES ('APPROW', '2026-10-05', ?, NULL, NULL, ?, ?)", (BOB, NOW, ALICE),
    )
    db.execute("UPDATE feeding_assignments SET user_id = ? WHERE date = '2026-10-06'", (ALICE,))  # simulate an old import value
    plan, sql = apply(db, workbook_path, create_missing=True)
    assert plan.kept_app_days == [("2026-10-05", "Feeder Two")]
    assert [w.date for w in plan.writes] == ["2026-10-06"]
    history = rows(db, "SELECT user_id, replaced_at, replaced_by FROM feeding_assignments WHERE date = '2026-10-06' ORDER BY created_at, replaced_at IS NULL")
    assert len(history) == 2 and history[0]["replaced_by"] == BOB and history[1]["replaced_at"] is None
    assert "DELETE" not in sql.upper()
    assert rows(db, "SELECT user_id FROM feeding_assignments WHERE date = '2026-10-05' AND replaced_at IS NULL")[0]["user_id"] == BOB


def test_the_sql_never_deletes():
    plan = plan_import([], [User("U", "A")], [], new_id=ids(), create_missing=False)
    assert build_statements(plan, ADMIN, NOW, ids()) == []


def test_the_report_lists_everything_the_owner_must_see(db, workbook_path):
    months = read_workbook(workbook_path)
    plan = plan_import(months, users_of(db), [], new_id=ids(), create_missing=True, exclude={"November2026!C7"})
    text = feeding_report.render_report(
        generated_at=NOW, source_name="feeding.xlsx", env="preview", months=months, plan=plan, actor="Feeder Two"
    )
    assert "## Provisional users to create" in text and "- Newcomer" in text
    assert "inactive Feeder without a password" in text
    assert "Name cells without a day number (orphans, skipped): 2" in text
    assert "October2026!E7 (Feeder One), October2026!F7 (Feeder One)" in text
    assert "only the first week is filled (6 of 30 days)" in text
    assert '`--exclude "November2026!D7:I7"`' in text
    assert "## October 2026" in text and "## November 2026" in text and "## September 2026" in text
    assert "| Sun | Mon | Tue | Wed | Thu | Fri | Sat |" in text
    assert "events not imported: 1" in text
    assert "Feeder One" in text and "| Feeder Two | " in text


def test_the_report_names_unknown_names_when_nothing_may_be_created(db, workbook_path):
    months = read_workbook(workbook_path, ["2026-10"])
    plan = plan_import(months, users_of(db), [], new_id=ids(), create_missing=False)
    text = feeding_report.render_report(
        generated_at=NOW, source_name="f.xlsx", env="local", months=months, plan=plan, actor="Feeder Two"
    )
    assert "## Unknown names (stop)" in text and "- Newcomer" in text


# -- the command line, with the database calls replaced by the SQLite one ---------------------


class FakeD1:
    def __init__(self, db: sqlite3.Connection):
        self.db = db
        self.executed: list[Path] = []

    def query(self, env, sql):
        return rows(self.db, sql)

    def execute_file(self, env, path):
        self.executed.append(path)
        run(self.db, path.read_text(encoding="utf-8"))


@pytest.fixture
def fake(db, monkeypatch):
    client = FakeD1(db)
    monkeypatch.setattr(d1_client, "query", client.query)
    monkeypatch.setattr(d1_client, "execute_file", client.execute_file)
    return client


def test_a_dry_run_writes_the_report_and_the_sql_but_not_the_database(fake, workbook_path, tmp_path, capsys):
    out = tmp_path / "out"
    code = import_feeding.main([str(workbook_path), "--env", "preview", "--months", "2026-10", "--create-missing-users", "--out", str(out)])
    assert code == 0 and fake.executed == []
    assert (out / "feeding-report.md").exists() and "INSERT INTO feeding_assignments" in (out / "feeding.sql").read_text()
    assert rows(fake.db, "SELECT count(*) AS n FROM feeding_assignments")[0]["n"] == 0
    assert "Dry run: nothing was changed." in capsys.readouterr().out


def test_unknown_names_stop_an_apply(fake, workbook_path, tmp_path, capsys):
    code = import_feeding.main([str(workbook_path), "--env", "preview", "--months", "2026-10", "--apply", "--yes", "--out", str(tmp_path)])
    assert code == 1 and fake.executed == []
    assert "Refusing to apply" in capsys.readouterr().err
    assert rows(fake.db, "SELECT count(*) AS n FROM feeding_assignments")[0]["n"] == 0


def test_apply_on_preview_with_yes_writes_everything_once(fake, workbook_path, tmp_path):
    args = [str(workbook_path), "--env", "preview", "--months", "2026-10", "--create-missing-users", "--apply", "--yes", "--out", str(tmp_path)]
    assert import_feeding.main(args) == 0 and len(fake.executed) == 1
    assert rows(fake.db, "SELECT count(*) AS n FROM feeding_assignments")[0]["n"] == 31
    assert import_feeding.main(args) == 0 and len(fake.executed) == 1  # the second run has nothing to write


def test_production_always_asks_to_type_the_name_even_with_yes(fake, workbook_path, tmp_path, monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _prompt: "yes")
    args = [str(workbook_path), "--env", "production", "--months", "2026-10", "--create-missing-users", "--apply", "--yes", "--out", str(tmp_path)]
    with pytest.raises(SystemExit, match="Confirmation did not match"):
        import_feeding.main(args)
    assert fake.executed == []
    monkeypatch.setattr("builtins.input", lambda _prompt: "production")
    assert import_feeding.main(args) == 0 and len(fake.executed) == 1


def test_exclude_and_alias_and_actor_options(fake, workbook_path, tmp_path):
    out = tmp_path / "o"
    args = [
        str(workbook_path), "--env", "local", "--months", "2026-10,2026-11", "--alias", "Newcomer=Feeder Two", "--alias", "Feeder Three=Feeder One",
        "--exclude", "November2026!C7:I7", "--exclude", "October2026!H6", "--actor", "Feeder One", "--out", str(out),
    ]
    assert import_feeding.main(args) == 0
    sql = (out / "feeding.sql").read_text()
    assert "'November2026" not in sql
    assert f"'{ALICE}'" in sql  # the actor is Feeder One
    with pytest.raises(SystemExit):
        import_feeding.main([str(workbook_path), "--env", "local", "--actor", "Nobody", "--out", str(out)])
    with pytest.raises(SystemExit):
        import_feeding.main([str(workbook_path), "--env", "local", "--alias", "broken", "--out", str(out)])
    with pytest.raises(SystemExit):
        import_feeding.main([str(workbook_path), "--env", "local", "--exclude", "C7", "--out", str(out)])


def test_a_workbook_with_a_changed_layout_is_refused_with_a_message(fake, tmp_path, capsys):
    import openpyxl

    workbook = openpyxl.Workbook()
    workbook.active.title = "October2026"
    path = tmp_path / "bad.xlsx"
    workbook.save(path)
    assert import_feeding.main([str(path), "--env", "local", "--out", str(tmp_path)]) == 1
    assert "The sheet cannot be read" in capsys.readouterr().err


def test_the_actor_defaults_to_the_first_active_admin(fake, workbook_path, tmp_path):
    out = tmp_path / "o"
    assert import_feeding.main([str(workbook_path), "--env", "local", "--months", "2026-10", "--create-missing-users", "--out", str(out)]) == 0
    assert "Actor (author of the written rows): Feeder Two" in (out / "feeding-report.md").read_text()
    fake.db.execute("UPDATE users SET role = 'member' WHERE id = ?", (BOB,))
    with pytest.raises(SystemExit, match="No active Admin"):
        import_feeding.main([str(workbook_path), "--env", "local", "--months", "2026-10", "--out", str(out)])
