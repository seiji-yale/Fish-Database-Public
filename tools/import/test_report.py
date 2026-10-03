from pathlib import Path

from normalize import normalize_line
from reader import read_sheet_inventory, read_ver11_rows
from report import REFERENCE_CANDIDATES, TaskManagementSummary, compute_summary, render_report


def _entries(workbook_path: Path):
    records = read_ver11_rows(workbook_path)
    return [normalize_line(r.values) for r in records]


def test_compute_summary_matches_the_synthetic_fixture(workbook_path: Path):
    lines = [line for line, _diagnostics in _entries(workbook_path)]
    summary = compute_summary(lines)
    assert summary.total_lines == 12
    assert summary.status_counts["Current"] == 10
    assert summary.status_counts["Closed"] == 1
    assert summary.status_counts["Breeding"] == 1
    assert summary.cryo_total == 4  # demo_c3, DEMO_E5, demo_d4, demo_023
    assert summary.cryo_details_unknown == 1  # demo_c3
    assert summary.next_cryo_id == "C0611"  # highest seen is DEMO_E5's C0610


def test_render_report_is_english_and_contains_every_section(workbook_path: Path):
    entries = _entries(workbook_path)
    inventory = read_sheet_inventory(workbook_path)
    text = render_report(
        generated_at="2026-09-28T12:00:00Z",
        source_file="synthetic.xlsx",
        sheet_inventory=inventory,
        entries=entries,
    )
    for heading in (
        "## Summary counts", "## Sheet inventory", "## Per-line summary",
        "## Normalisations applied", "## Unresolved items", "## Reference candidates",
    ):
        assert heading in text
    assert "demo_c3" in text
    assert "demo_034" in text
    assert REFERENCE_CANDIDATES == ()
    assert "None configured; add links through the app after import" in text
    # The report's own prose (every heading above) is written in English; a data value copied
    # verbatim from the lab's spreadsheet (e.g. a primer name with a curly apostrophe, section 3.5)
    # is deliberately not rewritten, so the report as a whole is not asserted to be pure ASCII --
    # see test_report_keeps_a_non_ascii_primer_name_verbatim below.


def test_render_report_lists_the_uninferred_fluorophore_as_unresolved(workbook_path: Path):
    text = render_report(
        generated_at="2026-09-28T12:00:00Z",
        source_file="synthetic.xlsx",
        sheet_inventory=read_sheet_inventory(workbook_path),
        entries=_entries(workbook_path),
    )
    assert "demo_034" in text.split("## Unresolved items", 1)[1]


def test_render_report_lists_references_with_no_link(workbook_path: Path):
    text = render_report(
        generated_at="2026-09-28T12:00:00Z",
        source_file="synthetic.xlsx",
        sheet_inventory=read_sheet_inventory(workbook_path),
        entries=_entries(workbook_path),
    )
    section = text.split("### References with no link yet", 1)[1]
    assert "demo_c3" in section
    assert "Example primers.docx" in section


def test_render_report_shows_the_task_management_summary_when_given(workbook_path: Path):
    text = render_report(
        generated_at="2026-09-28T12:00:00Z",
        source_file="synthetic.xlsx",
        sheet_inventory=read_sheet_inventory(workbook_path),
        entries=_entries(workbook_path),
        task_management=TaskManagementSummary(
            source_rows=26, messages_created=32, unmatched=["row 99: Line 'ghost-line' not found"],
        ),
    )
    assert "ghost-line" in text
    assert "26 sheet row(s)" in text
    assert "32 chat message(s)" in text
    assert "Poster is the account selected with --actor-id" in text


def test_render_report_task_management_defaults_to_not_run(workbook_path: Path):
    text = render_report(
        generated_at="2026-09-28T12:00:00Z",
        source_file="synthetic.xlsx",
        sheet_inventory=read_sheet_inventory(workbook_path),
        entries=_entries(workbook_path),
    )
    assert "Not run in this dry run" in text


def test_render_report_says_none_when_there_is_nothing_to_report(workbook_path: Path):
    demo_c3_only = [e for e in _entries(workbook_path) if e[0].name == "demo_c3"]
    text = render_report(
        generated_at="2026-09-28T12:00:00Z",
        source_file="synthetic.xlsx",
        sheet_inventory=read_sheet_inventory(workbook_path),
        entries=demo_c3_only,
    )
    assert "_None._" in text  # no normalisations/unresolved items for demo_c3 alone


def test_report_keeps_a_non_ascii_primer_name_verbatim(workbook_path: Path):
    # docs/05-import-spec.md section 3.5: a primer name with a curly apostrophe is kept as typed
    # and reported, not rewritten to a plain quote.
    text = render_report(
        generated_at="2026-09-28T12:00:00Z",
        source_file="synthetic.xlsx",
        sheet_inventory=read_sheet_inventory(workbook_path),
        entries=_entries(workbook_path),
    )
    normalisations = text.split("## Normalisations applied", 1)[1].split("## Unresolved items", 1)[0]
    assert "Demo’Primer R" in normalisations
    assert "DEMO_024" in normalisations
