"""Tests for the restore tool (T-021). The export is a real one: `tools/db/export-fixture.ts` runs the
app's own exporter on the test fixture, so a change to the export shows up here."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
import restore_from_export as restore
from testing_db import fresh_db, rows, run_statements

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def export(tmp_path_factory) -> dict:
    path = tmp_path_factory.mktemp("export") / "fish-database.json"
    subprocess.run(
        ["node", "--import", "tsx", "tools/db/export-fixture.ts", str(path)],
        cwd=REPO, check=True, capture_output=True,
    )
    return json.loads(path.read_text(encoding="utf-8"))


def table_count(db, table: str) -> int:
    return rows(db, f"SELECT count(*) AS n FROM {table}")[0]["n"]


def test_export_to_empty_database_keeps_counts_ids_and_the_demo_c3_document(export):
    db = fresh_db()
    run_statements(db, restore.build_statements(export, wipe=False))
    for table, expected in restore.counts(export).items():
        assert table_count(db, table) >= expected, table
    assert rows(db, "PRAGMA foreign_key_check") == []
    demo_c3 = next(e for e in export["lines"] if e["line"]["name"] == "demo_c3")
    line_id = demo_c3["line"]["id"]
    assert rows(db, "SELECT * FROM lines WHERE id = ?", (line_id,)) == [demo_c3["line"]]
    assert demo_c3["line"]["current_protocol_id"] is not None
    for key, table in restore.LINE_CHILDREN:
        ids = [r["id"] for r in demo_c3[key]]
        marks = ", ".join("?" for _ in ids)
        got = rows(db, f"SELECT * FROM {table} WHERE id IN ({marks}) ORDER BY id", tuple(ids))
        assert got == sorted(demo_c3[key], key=lambda r: r["id"]), table
    versions = rows(db, "SELECT * FROM line_versions WHERE line_id = ? ORDER BY version_no", (line_id,))
    assert versions == [v for v in export["lineVersions"] if v["line_id"] == line_id]
    assert versions, "history must be restored"
    assert {r["key"]: r["value"] for r in rows(db, "SELECT * FROM settings")}["default_cycles"] == "35"


def test_wipe_replaces_what_was_there_and_is_repeatable(export):
    db = fresh_db()
    run_statements(db, restore.build_statements(export, wipe=False))
    db.execute("UPDATE lines SET notes = 'changed after the export'")
    db.execute("DELETE FROM line_phenotypes")
    run_statements(db, restore.build_statements(export, wipe=True))
    run_statements(db, restore.build_statements(export, wipe=True))
    assert table_count(db, "lines") == len(export["lines"])
    assert rows(db, "SELECT count(*) AS n FROM lines WHERE notes = 'changed after the export'")[0]["n"] == 0
    assert table_count(db, "line_phenotypes") == restore.counts(export)["line_phenotypes"]
    assert rows(db, "PRAGMA foreign_key_check") == []


def test_chat_and_vial_uses_survive(export):
    doc = json.loads(json.dumps(export))
    line = doc["lines"][0]["line"]
    user = doc["users"][0]["id"]
    doc["chatMessages"] = [{
        "id": "m1", "line_id": line["id"], "user_id": user, "via_admin": 0, "body": "it's here",
        "request_type": None, "request_status": None, "request_done_by": None,
        "request_done_at": None, "edited_at": None, "deleted_at": None, "created_at": "2026-10-01T00:00:00Z",
    }]
    db = fresh_db()
    run_statements(db, restore.build_statements(doc, wipe=False))
    assert rows(db, "SELECT body FROM chat_messages") == [{"body": "it's here"}]


def test_an_older_export_without_history_still_restores(export):
    old = {k: v for k, v in export.items() if k not in ("lineVersions", "activities", "chatMessages")}
    db = fresh_db()
    run_statements(db, restore.build_statements(restore.validate(old), wipe=False))
    assert table_count(db, "lines") == len(export["lines"])
    assert table_count(db, "line_versions") == 0


def test_validate_names_every_problem(export):
    with pytest.raises(restore.RestoreError, match="not a Fish-Database export"):
        restore.validate([])
    with pytest.raises(restore.RestoreError, match="`exported_at` is missing.*`lines` is missing"):
        restore.validate({"app_version": "1", "users": [], "enumerations": [], "settings": {}})
    with pytest.raises(restore.RestoreError, match="`settings` is missing"):
        restore.validate({k: v for k, v in export.items() if k != "settings"})
    bad = json.loads(json.dumps(export))
    bad["lines"][0]["protocols"] = [{"no_id": 1}]
    bad["lines"][1] = {"line": {}}
    bad["users"] = [{"x": 1}]
    bad["activities"] = "no"
    with pytest.raises(restore.RestoreError) as error:
        restore.validate(bad)
    text = str(error.value)
    assert "`activities` is not a list" in text
    bad["activities"] = []
    with pytest.raises(restore.RestoreError) as error:
        restore.validate(bad)
    text = str(error.value)
    assert "`protocols` is missing or has a row without an id" in text
    assert "lines[1] has no `line` with an id" in text
    assert "`users` has a row without an id" in text


def test_a_target_with_data_is_refused_unless_wipe():
    restore.check_target({"lines": 0, "activities": 0, "chat_messages": 0}, wipe=False)
    with pytest.raises(restore.RestoreError, match="not empty \\(3 lines, 2 activities\\).*--wipe"):
        restore.check_target({"lines": 3, "activities": 2, "chat_messages": 0}, wipe=False)
    restore.check_target({"lines": 3, "activities": 2, "chat_messages": 0}, wipe=True)


class FakeD1:
    """Stands in for d1_client: the same calls, a real SQLite behind them."""

    def __init__(self, db):
        self.db, self.calls = db, []

    class D1Error(RuntimeError):
        pass

    def query(self, env, sql):
        self.calls.append(("query", env))
        return rows(self.db, sql)

    def execute_file(self, env, path):
        self.calls.append(("execute", env))
        run_statements(self.db, Path(path).read_text(encoding="utf-8").splitlines())


@pytest.fixture
def export_file(export, tmp_path):
    path = tmp_path / "fish-database.json"
    path.write_text(json.dumps(export), encoding="utf-8")
    return path


def install(monkeypatch, db):
    import d1_client

    fake = FakeD1(db)
    monkeypatch.setattr(d1_client, "query", fake.query)
    monkeypatch.setattr(d1_client, "execute_file", fake.execute_file)
    return fake


def test_main_restores_locally_then_refuses_a_second_run_without_wipe(export_file, monkeypatch, capsys):
    fake = install(monkeypatch, fresh_db())
    assert restore.main([str(export_file), "--env", "local"]) == 0
    assert "every table matches the export" in capsys.readouterr().out
    assert ("execute", None) in fake.calls
    assert restore.main([str(export_file), "--env", "local"]) == 1
    assert "not empty" in capsys.readouterr().err
    assert restore.main([str(export_file), "--env", "local", "--wipe"]) == 0


def test_anything_but_local_needs_yes_and_dry_run_changes_nothing(export_file, monkeypatch, capsys, tmp_path):
    fake = install(monkeypatch, fresh_db())
    assert restore.main([str(export_file), "--env", "production"]) == 2
    assert "PRODUCTION" in capsys.readouterr().err
    assert restore.main([str(export_file), "--env", "preview", "--dry-run", "--out", str(tmp_path / "o")]) == 0
    assert (tmp_path / "o" / "restore.sql").read_text().count("INSERT INTO lines") == 5
    assert fake.calls == []
    assert restore.main([str(export_file), "--env", "preview", "--yes"]) == 0
    assert ("execute", "preview") in fake.calls


def test_main_reports_unreadable_and_damaged_files(tmp_path, capsys):
    assert restore.main([str(tmp_path / "missing.json"), "--env", "local"]) == 1
    assert "Cannot read" in capsys.readouterr().err
    broken = tmp_path / "b.json"
    broken.write_text("{nope", encoding="utf-8")
    assert restore.main([str(broken), "--env", "local"]) == 1
    broken.write_text("[]", encoding="utf-8")
    assert restore.main([str(broken), "--env", "local"]) == 1
    assert "not a Fish-Database export" in capsys.readouterr().err


def test_main_reports_a_database_error_and_a_count_mismatch(export_file, monkeypatch, capsys):
    import d1_client

    fake = install(monkeypatch, fresh_db())
    monkeypatch.setattr(d1_client, "D1Error", FakeD1.D1Error)

    def refuse(env, path):
        raise FakeD1.D1Error("FOREIGN KEY constraint failed")

    monkeypatch.setattr(d1_client, "execute_file", refuse)
    assert restore.main([str(export_file), "--env", "local"]) == 1
    assert "FOREIGN KEY constraint failed" in capsys.readouterr().err
    monkeypatch.setattr(d1_client, "execute_file", lambda env, path: None)  # applies nothing
    assert restore.main([str(export_file), "--env", "local"]) == 1
    assert "restored 0 rows" in capsys.readouterr().err
    assert fake.calls


def test_thumbnail_links_are_dropped_because_thumbnails_are_not_in_the_copy(export):
    doc = json.loads(json.dumps(export))
    line = doc["lines"][0]
    line["attachments"] = [{
        "id": "att1", "owner_type": "line", "owner_id": line["line"]["id"], "kind": "gel_image",
        "file_name": "g.png", "mime_type": "image/png", "size_bytes": 3, "caption": None,
        "r2_key": f"lines/{line['line']['id']}/att1-g.png", "thumb_r2_key": f"lines/{line['line']['id']}/att1-thumb.jpg",
        "is_latest": 1, "deleted_at": None, "created_at": "2026-10-01T00:00:00Z", "created_by": doc["users"][0]["id"],
    }]
    db = fresh_db()
    run_statements(db, restore.build_statements(doc, wipe=False))
    assert rows(db, "SELECT r2_key, thumb_r2_key FROM attachments")[0]["thumb_r2_key"] is None


def test_wipe_removes_references_before_the_attachments_they_point_at(export):
    """Found by the preview drill: a reference with a file made the real D1 refuse the wipe."""
    doc = json.loads(json.dumps(export))
    line = doc["lines"][0]
    user = doc["users"][0]["id"]
    line["attachments"] = [{
        "id": "att1", "owner_type": "line_reference", "owner_id": "ref1", "kind": "reference_file",
        "file_name": "m.pdf", "mime_type": "application/pdf", "size_bytes": 3, "caption": None,
        "r2_key": f"lines/{line['line']['id']}/att1-m.pdf", "thumb_r2_key": None,
        "is_latest": 1, "deleted_at": None, "created_at": "2026-10-01T00:00:00Z", "created_by": user,
    }]
    line["references"] = [{
        "id": "ref1", "line_id": line["line"]["id"], "title": "Paper", "url": None, "attachment_id": "att1",
        "note": None, "sort_order": 0, "deleted_at": None, "created_at": "2026-10-01T00:00:00Z", "created_by": user,
    }]
    db = fresh_db()
    run_statements(db, restore.build_statements(doc, wipe=False))
    run_statements(db, restore.build_statements(doc, wipe=True))
    wanted = restore.counts(doc)
    assert table_count(db, "line_references") == wanted["line_references"]
    assert table_count(db, "attachments") == wanted["attachments"] == 1
    assert rows(db, "PRAGMA foreign_key_check") == []
