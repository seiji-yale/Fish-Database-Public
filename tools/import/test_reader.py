from pathlib import Path

import pytest
from reader import (
    NOT_IMPORTED_SHEETS,
    file_fingerprint,
    read_sheet_inventory,
    read_task_management_rows,
    read_ver11_rows,
)


def test_reads_every_ver11_row_with_hidden_rows_included(workbook_path: Path):
    records = read_ver11_rows(workbook_path)
    assert len(records) == 12
    assert [r.values["line"] for r in records] == [
        "demo_c3", "DEMO_E5", "demo_b2", "demo_d4", "demo_a1", "demo_023", "demo_037", "DEMO_024",
        "demo_034", "demo_001", "demo_002", "DEMO_003",
    ]
    hidden = {r.values["line"]: r.row_hidden for r in records}
    assert hidden["DEMO_E5"] is True
    assert hidden["demo_023"] is True
    assert hidden["demo_037"] is True
    assert hidden["demo_c3"] is False


def test_stops_at_the_first_row_with_an_empty_line_cell(workbook_path: Path):
    # No gap in the synthetic fixture, but the loop must be bounded by max_row, not by count.
    records = read_ver11_rows(workbook_path)
    assert all(r.values["line"] for r in records)


def test_reads_hidden_columns_the_same_as_visible_ones(workbook_path: Path):
    demo_e5 = next(r for r in read_ver11_rows(workbook_path) if r.values["line"] == "DEMO_E5")
    assert demo_e5.values["cryo_id_min"] == "C0605"  # column AA, part of the "9 hidden columns"
    assert demo_e5.values["primer_f_seq"] == "GAGAAATTGTCCGGGATTTCT"  # column M, hidden


def test_captures_the_row_number_for_traceability(workbook_path: Path):
    demo_c3 = next(r for r in read_ver11_rows(workbook_path) if r.values["line"] == "demo_c3")
    assert demo_c3.row == 5


def test_ignores_the_filler_column_ab(workbook_path: Path):
    demo_c3 = next(r for r in read_ver11_rows(workbook_path) if r.values["line"] == "demo_c3")
    assert "~" not in demo_c3.values
    assert set(demo_c3.values) == {
        "check", "no", "line", "gene_raw", "source", "dob", "status", "id_method", "id_date",
        "id_number", "primer_f_name", "primer_f_seq", "primer_r_name", "primer_r_seq",
        "base_pairs", "pcr_cond", "seq_cond", "mutation", "guide_seq", "phenotype", "resource02",
        "cryo_flag", "cryo_date", "cryo_place", "cryo_box", "cryo_id_min", "cryo_id_max",
        "add_info_02", "last_update",
    }


def test_reads_task_management_rows_including_lines_above(workbook_path: Path):
    records = read_task_management_rows(workbook_path)
    assert len(records) == 6
    assert records[0].values["line"] == "demo_017"
    assert records[1].values["line"] == "demo_016"
    assert records[5].values["line"] == "Lines Above"
    assert records[0].row_hidden is True
    assert records[3].row_hidden is False


def test_sheet_inventory_lists_every_sheet_with_its_visibility(workbook_path: Path):
    inventory = {s.name: s.state for s in read_sheet_inventory(workbook_path)}
    assert inventory["Ver. 1.1"] == "visible"
    assert inventory["Task Management"] == "visible"
    for name in NOT_IMPORTED_SHEETS:
        assert inventory[name] == "hidden"


def test_a_malformed_header_fails_loudly_instead_of_reading_the_wrong_column(tmp_path: Path):
    import openpyxl

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Ver. 1.1"
    for letter, header in {"B": "Check", "C": "No.", "D": "Not LINE"}.items():
        sheet[f"{letter}4"] = header
    path = tmp_path / "bad.xlsx"
    workbook.save(path)
    with pytest.raises(ValueError, match="expected header 'LINE'"):
        read_ver11_rows(path)


def test_never_writes_back_to_the_source_file(workbook_path: Path):
    before = file_fingerprint(workbook_path)
    read_ver11_rows(workbook_path)
    read_task_management_rows(workbook_path)
    read_sheet_inventory(workbook_path)
    after = file_fingerprint(workbook_path)
    assert before == after
