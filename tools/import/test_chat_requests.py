from pathlib import Path

import pytest
from chat_requests import build_body, build_chat_requests, map_request_type, resolve_line_name
from reader import read_task_management_rows
from tz import local_noon_to_utc_iso

KNOWN_NAMES = {
    "demo_c3", "demo_006", "demo_008", "demo_009", "demo_010", "demo_011", "demo_013", "demo_014", "demo_015",
    "demo_016", "demo_017",
}


def test_map_request_type():
    assert map_request_type("Genotyping", "All Process") == "Genotyping"
    assert map_request_type("Breeding", "Set Out-cross") == "Set up cross"
    assert map_request_type("Breeding", "Collect Embryos") == "Other"
    assert map_request_type("Breeding", "Tank Wash") == "Other"
    assert map_request_type("Something Else", "Whatever") == "Other"


def test_build_body_with_and_without_a_message():
    body = build_body("Set Out-cross", "USE WT", "Erin", "2025-09-24", None)
    assert body == "[Imported task] Set Out-cross — USE WT. Assigned to Erin, due 2025-09-24."
    with_message = build_body("Tank Wash", "desc", "Erin", "2025-09-24", "Please let Bob know.")
    assert with_message == (
        "[Imported task] Tank Wash — desc. Assigned to Erin, due 2025-09-24. Please let Bob know."
    )


def test_build_body_requires_a_due_date():
    with pytest.raises(ValueError, match="Due must not be blank"):
        build_body("Task", "desc", "Erin", None, None)


def test_resolve_line_name_exact_and_hi_prefixed():
    assert resolve_line_name("demo_c3", KNOWN_NAMES) == "demo_c3"
    assert resolve_line_name(1234, {"hi1234"}) == "hi1234"
    assert resolve_line_name("5678A", {"hi5678A"}) == "hi5678A"
    assert resolve_line_name("ghost-line", KNOWN_NAMES) is None
    assert resolve_line_name(None, KNOWN_NAMES) is None


def test_build_chat_requests_against_the_synthetic_task_management_sheet(workbook_path: Path):
    rows = read_task_management_rows(workbook_path)
    requests, unmatched = build_chat_requests(rows, KNOWN_NAMES)
    assert unmatched == []

    by_line: dict[str, list] = {}
    for request in requests:
        by_line.setdefault(request.line_name, []).append(request)

    # Both task rows in this group refer to known lines.
    assert "demo_017" in by_line
    assert "demo_016" in by_line

    # demo_c3's Set Out-cross message (Posted 2025-09-08, EDT -> UTC-4 at local noon).
    demo_c3 = by_line["demo_c3"][0]
    assert demo_c3.request_type == "Set up cross"
    assert "Use a control fish from the demo rack" in demo_c3.body
    assert demo_c3.created_at == local_noon_to_utc_iso("2025-09-08")

    # "Lines Above" (Posted 2025-11-08) expands to every line named earlier in that same group:
    # demo_014 and demo_016 (both "Set Out-cross" rows before the "Lines Above" row).
    above_targets = {r.line_name for r in requests if "Example collection group" in r.body}
    assert above_targets == {"demo_014", "demo_016"}


def test_build_chat_requests_reports_an_unmatched_line(workbook_path: Path):
    rows = read_task_management_rows(workbook_path)
    ghost = rows[0]
    ghost.values["line"] = "ghost-line-9999"
    requests, unmatched = build_chat_requests([ghost], KNOWN_NAMES)
    assert requests == []
    assert len(unmatched) == 1
    assert "ghost-line-9999" in unmatched[0]


def test_build_chat_requests_reports_lines_above_with_nothing_before_it(workbook_path: Path):
    rows = read_task_management_rows(workbook_path)
    orphan = rows[0]
    orphan.values["line"] = "Lines Above"
    requests, unmatched = build_chat_requests([orphan], KNOWN_NAMES)
    assert requests == []
    assert len(unmatched) == 1
    assert "Lines Above" in unmatched[0]


def test_build_chat_requests_falls_back_to_due_when_last_updated_is_blank(workbook_path: Path):
    rows = read_task_management_rows(workbook_path)
    row = rows[0]
    row.values["last_updated"] = None
    requests, unmatched = build_chat_requests([row], KNOWN_NAMES)
    assert unmatched == []
    assert requests[0].request_done_at == local_noon_to_utc_iso(row.values["due"])
