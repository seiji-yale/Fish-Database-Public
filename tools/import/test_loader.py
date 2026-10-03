import json
from pathlib import Path

import pytest
from chat_requests import ChatRequest, build_chat_requests
from loader import (
    ELIGIBILITY_QUERY,
    IMPORTED_CHAT_LINE_IDS_QUERY,
    build_chat_request_statements,
    build_line_statements,
    existing_lines_by_name,
    join_statements,
    lines_with_imported_chat,
    plan_for,
    snapshot_dict,
)
from normalize import normalize_line
from reader import read_task_management_rows, read_ver11_rows
from seed_users import load_user_ids_from_sql
from testing_db import TEST_USERS, fresh_db, rows, run_statements


@pytest.fixture
def db():
    return fresh_db()


@pytest.fixture
def bob_id():
    return next(iter(load_user_ids_from_sql(TEST_USERS).values()))


def line_by_name(workbook_path: Path, name: str):
    raw = next(r for r in read_ver11_rows(workbook_path) if r.values["line"] == name).values
    line, _diagnostics = normalize_line(raw)
    return line


def existing(db) -> dict:
    return existing_lines_by_name(rows(db, ELIGIBILITY_QUERY))


def test_plan_for_insert_when_the_name_is_unknown(db, bob_id):
    assert plan_for("demo_c3", existing(db)) == ("insert", None)


def test_plan_for_refresh_when_still_at_version_1(db, bob_id, workbook_path: Path):
    line = line_by_name(workbook_path, "demo_c3")
    statements, line_id = build_line_statements(line, "insert", None, bob_id)
    run_statements(db, statements)
    plan, existing_id = plan_for("demo_c3", existing(db))
    assert plan == "refresh"
    assert existing_id == line_id


def test_plan_for_skip_when_a_later_version_exists(db, bob_id, workbook_path: Path):
    line = line_by_name(workbook_path, "demo_c3")
    statements, line_id = build_line_statements(line, "insert", None, bob_id)
    run_statements(db, statements)
    db.execute(
        "INSERT INTO line_versions (id, line_id, version_no, snapshot, change_type, summary, created_at, created_by) "
        "VALUES ('v2', ?, 2, '{}', 'edited', 'a user edit', 't', ?)",
        (line_id, bob_id),
    )
    db.commit()
    plan, existing_id = plan_for("demo_c3", existing(db))
    assert plan == "skip"
    assert existing_id == line_id


def test_build_line_statements_rejects_a_skip_plan(bob_id, workbook_path: Path):
    line = line_by_name(workbook_path, "demo_c3")
    with pytest.raises(ValueError, match="skipped"):
        build_line_statements(line, "skip", "some-id", bob_id)


def test_insert_demo_c3_end_to_end(db, bob_id, workbook_path: Path):
    line = line_by_name(workbook_path, "demo_c3")
    statements, line_id = build_line_statements(line, "insert", None, bob_id)
    run_statements(db, statements)

    [stored] = rows(db, "SELECT * FROM lines WHERE id = ?", (line_id,))
    assert stored["name"] == "demo_c3"
    assert stored["status"] == "Current"
    assert stored["ided_number"] == line.ided_number
    assert stored["version"] == 1
    assert stored["generation_no"] == 1
    assert stored["created_by"] == bob_id

    [protocol] = rows(db, "SELECT * FROM id_protocols WHERE line_id = ?", (line_id,))
    assert stored["current_protocol_id"] == protocol["id"]
    assert protocol["protocol_type"] == "pcr"
    assert json.loads(protocol["fields"])["primer_f_name"] == "Primer-1"

    [attribute] = rows(db, "SELECT * FROM line_attributes WHERE line_id = ?", (line_id,))
    assert (attribute["key"], attribute["value"]) == ("Source", "REPOSITORY A")

    [cryo] = rows(db, "SELECT * FROM cryo_records WHERE line_id = ?", (line_id,))
    assert cryo["details_unknown"] == 1

    [genotyping] = rows(db, "SELECT * FROM genotyping_records WHERE line_id = ?", (line_id,))
    assert genotyping["positive_count"] == line.genotyping_record.positive_count
    assert genotyping["protocol_id"] == protocol["id"]

    [reference] = rows(db, "SELECT * FROM line_references WHERE line_id = ?", (line_id,))
    assert reference["title"] == "Example primers.docx"
    assert reference["url"] is None

    [version] = rows(db, "SELECT * FROM line_versions WHERE line_id = ?", (line_id,))
    assert version["version_no"] == 1
    assert version["change_type"] == "imported"
    assert json.loads(version["snapshot"])["name"] == "demo_c3"

    [activity] = rows(db, "SELECT * FROM activities WHERE line_id = ?", (line_id,))
    assert activity["type"] == "imported"
    assert activity["user_id"] == bob_id


def test_refresh_replaces_children_and_keeps_the_line_id(db, bob_id, workbook_path: Path):
    line = line_by_name(workbook_path, "demo_c3")
    statements, line_id = build_line_statements(line, "insert", None, bob_id)
    run_statements(db, statements)
    [old_protocol] = rows(db, "SELECT id FROM id_protocols WHERE line_id = ?", (line_id,))

    # Re-derive the plan from the database, as the CLI would on a second --apply.
    plan, existing_id = plan_for("demo_c3", existing(db))
    assert plan == "refresh"
    statements2, line_id2 = build_line_statements(line, plan, existing_id, bob_id)
    run_statements(db, statements2)

    assert line_id2 == line_id  # the line's own id never changes
    assert len(rows(db, "SELECT id FROM lines WHERE id = ?", (line_id,))) == 1
    assert len(rows(db, "SELECT id FROM line_versions WHERE line_id = ?", (line_id,))) == 1
    [new_protocol] = rows(db, "SELECT id FROM id_protocols WHERE line_id = ?", (line_id,))
    assert new_protocol["id"] != old_protocol["id"]  # the old protocol row is gone, not reused
    assert len(rows(db, "SELECT id FROM cryo_records WHERE line_id = ?", (line_id,))) == 1


def test_refresh_does_not_delete_a_chat_posted_activity_for_this_line(db, bob_id, workbook_path: Path):
    # Regression: an earlier version cleared *every* activity for the line on refresh, which
    # silently deleted the chat_posted activity of an untouched, already-imported chat message.
    line = line_by_name(workbook_path, "demo_c3")
    statements, line_id = build_line_statements(line, "insert", None, bob_id)
    run_statements(db, statements)
    request = ChatRequest(
        line_name="demo_c3", request_type="Set up cross", body="[Imported task] x",
        created_at="2025-09-08T16:00:00Z", request_done_at="2025-09-25T19:35:25Z",
    )
    run_statements(db, build_chat_request_statements(line_id, request, bob_id))
    assert len(rows(db, "SELECT id FROM chat_messages WHERE line_id = ?", (line_id,))) == 1
    assert len(rows(db, "SELECT id FROM activities WHERE line_id = ? AND type = 'chat_posted'", (line_id,))) == 1

    plan, existing_id = plan_for("demo_c3", existing(db))
    assert plan == "refresh"
    statements2, _line_id2 = build_line_statements(line, plan, existing_id, bob_id)
    run_statements(db, statements2)

    assert len(rows(db, "SELECT id FROM chat_messages WHERE line_id = ?", (line_id,))) == 1
    assert len(rows(db, "SELECT id FROM activities WHERE line_id = ? AND type = 'chat_posted'", (line_id,))) == 1
    assert len(rows(db, "SELECT id FROM activities WHERE line_id = ? AND type = 'imported'", (line_id,))) == 1


def test_applying_the_same_line_twice_yields_identical_row_counts(db, bob_id, workbook_path: Path):
    line = line_by_name(workbook_path, "demo_c3")

    def apply_once():
        plan, existing_id = plan_for("demo_c3", existing(db))
        assert plan in ("insert", "refresh")
        statements, _line_id = build_line_statements(line, plan, existing_id, bob_id)
        run_statements(db, statements)

    apply_once()
    counts_after_first = {
        table: len(rows(db, f"SELECT id FROM {table}"))
        for table in ("lines", "id_protocols", "cryo_records", "line_attributes", "line_references", "genotyping_records", "line_versions", "activities")
    }
    apply_once()
    counts_after_second = {
        table: len(rows(db, f"SELECT id FROM {table}"))
        for table in counts_after_first
    }
    assert counts_after_first == counts_after_second


def test_a_line_edited_since_import_is_never_touched_by_a_refresh_attempt(db, bob_id, workbook_path: Path):
    line = line_by_name(workbook_path, "demo_c3")
    statements, line_id = build_line_statements(line, "insert", None, bob_id)
    run_statements(db, statements)
    db.execute(
        "UPDATE lines SET ided_number = 999, version = 2 WHERE id = ?", (line_id,)
    )
    db.execute(
        "INSERT INTO line_versions (id, line_id, version_no, snapshot, change_type, summary, created_at, created_by) "
        "VALUES ('v2', ?, 2, '{}', 'edited', 'a user edit', 't', ?)",
        (line_id, bob_id),
    )
    db.commit()

    plan, existing_id = plan_for("demo_c3", existing(db))
    assert plan == "skip"
    # The orchestrator (import_xlsx.py) must not call build_line_statements for a skip; confirm
    # the edited value really is still there, i.e. nothing was touched.
    [stored] = rows(db, "SELECT ided_number FROM lines WHERE id = ?", (line_id,))
    assert stored["ided_number"] == 999


def test_snapshot_dict_is_json_serialisable_for_every_fixture_line(workbook_path: Path):
    for record in read_ver11_rows(workbook_path):
        line, _diagnostics = normalize_line(record.values)
        json.dumps(snapshot_dict(line))  # must not raise


def test_build_chat_request_statements(db, bob_id, workbook_path: Path):
    line = line_by_name(workbook_path, "demo_c3")
    statements, line_id = build_line_statements(line, "insert", None, bob_id)
    run_statements(db, statements)

    request = ChatRequest(
        line_name="demo_c3", request_type="Set up cross",
        body="[Imported task] Set Out-cross — USE WT. Assigned to Erin, due 2025-09-24.",
        created_at="2025-09-08T16:00:00Z", request_done_at="2025-09-25T19:35:25Z",
    )
    chat_statements = build_chat_request_statements(line_id, request, bob_id)
    run_statements(db, chat_statements)

    [message] = rows(db, "SELECT * FROM chat_messages WHERE line_id = ?", (line_id,))
    assert message["user_id"] == bob_id
    assert message["request_status"] == "done"
    assert message["request_done_by"] is None
    assert message["request_done_at"] == "2025-09-25T19:35:25Z"

    [activity] = rows(db, "SELECT * FROM activities WHERE ref_type = 'chat_message'")
    assert activity["type"] == "chat_posted"
    assert activity["ref_id"] == message["id"]


def test_full_pipeline_end_to_end_against_the_synthetic_workbook(db, bob_id, workbook_path: Path):
    """Reader -> normalise -> loader -> chat requests, executed against a real (in-memory) SQLite
    database built from the actual migrations -- the closest thing to a real `--apply` run without
    talking to `wrangler`."""
    ver11_records = read_ver11_rows(workbook_path)
    known_names = {str(r.values["line"]).strip() for r in ver11_records}
    line_ids: dict[str, str] = {}
    for record in ver11_records:
        line, _diagnostics = normalize_line(record.values)
        plan, existing_id = plan_for(line.name, existing(db))
        statements, line_id = build_line_statements(line, plan, existing_id, bob_id)
        run_statements(db, statements)
        line_ids[line.name] = line_id

    # The synthetic Task Management fixture references several lines (demo_014, demo_016, demo_017, ...)
    # that this test's synthetic Ver. 1.1 fixture does not include (they cover different rules), so
    # some rows are expected to stay unmatched here; only demo_c3 must resolve on both sides.
    task_rows = read_task_management_rows(workbook_path)
    requests, unmatched = build_chat_requests(task_rows, known_names)
    assert any(r.line_name == "demo_c3" for r in requests)
    assert all("demo_c3" not in message for message in unmatched)
    for request in requests:
        chat_statements = build_chat_request_statements(line_ids[request.line_name], request, bob_id)
        run_statements(db, chat_statements)

    assert len(rows(db, "SELECT id FROM lines")) == len(ver11_records)
    assert len(rows(db, "SELECT id FROM chat_messages")) == len(requests)
    assert len(requests) > 0
    [demo_c3] = rows(db, "SELECT * FROM lines WHERE name = 'demo_c3'")
    assert demo_c3["ided_number"] == line_by_name(workbook_path, "demo_c3").ided_number
    demo_c3_chats = rows(db, "SELECT * FROM chat_messages WHERE line_id = ?", (demo_c3["id"],))
    assert len(demo_c3_chats) == 1
    assert demo_c3_chats[0]["request_type"] == "Set up cross"


def _run_apply(db, bob_id, workbook_path: Path) -> tuple[int, int]:
    """One full `--apply`-style pass: lines then chat messages, skipping chat import for a line
    that already has one. Returns `(lines_written, chat_messages_written)`."""
    ver11_records = read_ver11_rows(workbook_path)
    line_ids: dict[str, str] = {}
    written = 0
    for record in ver11_records:
        line, _diagnostics = normalize_line(record.values)
        plan, existing_id = plan_for(line.name, existing(db))
        if plan != "skip":
            statements, line_id = build_line_statements(line, plan, existing_id, bob_id)
            run_statements(db, statements)
            written += 1
        else:
            line_id = existing_id
        line_ids[line.name] = line_id

    known_names = set(line_ids)
    task_rows = read_task_management_rows(workbook_path)
    requests, _unmatched = build_chat_requests(task_rows, known_names)
    already_imported = lines_with_imported_chat(rows(db, IMPORTED_CHAT_LINE_IDS_QUERY))
    chat_written = 0
    for request in requests:
        line_id = line_ids[request.line_name]
        if line_id in already_imported:
            continue
        chat_statements = build_chat_request_statements(line_id, request, bob_id)
        run_statements(db, chat_statements)
        chat_written += 1
    return written, chat_written


def test_applying_the_full_pipeline_twice_creates_no_duplicate_chat_messages(db, bob_id, workbook_path: Path):
    first_lines, first_chats = _run_apply(db, bob_id, workbook_path)
    assert first_lines > 0
    assert first_chats > 0
    counts_after_first = {
        table: len(rows(db, f"SELECT id FROM {table}"))
        for table in ("lines", "chat_messages", "line_versions", "activities")
    }

    second_lines, second_chats = _run_apply(db, bob_id, workbook_path)
    assert second_chats == 0  # every line already has its imported messages
    counts_after_second = {
        table: len(rows(db, f"SELECT id FROM {table}")) for table in counts_after_first
    }
    # Every count, including `activities` (imported + chat_posted together), must be unchanged --
    # a refresh must not silently drop the chat_posted activities of untouched chat messages.
    assert counts_after_second == counts_after_first


def test_join_statements_has_no_begin_or_commit():
    # wrangler d1 execute --file refuses a file containing its own BEGIN/COMMIT (D1 already runs
    # the whole file as one atomic unit); see loader.join_statements.
    text = join_statements(["INSERT INTO x (a) VALUES (1);"])
    assert "BEGIN" not in text
    assert "COMMIT" not in text
    assert text == "INSERT INTO x (a) VALUES (1);\n"
