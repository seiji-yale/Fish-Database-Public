"""Builds a synthetic workbook (in a temp file) reproducing every special case in
docs/05-import-spec.md, so tests never touch the real Mastersheet. Shared by every test module
in this directory.
"""

from __future__ import annotations

from pathlib import Path

import openpyxl
import pytest

VER11_HEADERS = {
    "B": "Check", "C": "No.", "D": "LINE", "E": "Add Info 01", "F": "Resouces01",
    "G": "DOB (Current)", "H": "Status", "I": "ID Method", "J": "ID Date", "K": "ID Number",
    "L": "Primer F", "M": "Sequence F", "N": "Primer R", "O": "Sequence R",
    "P": "Base Pairs / b. p.", "Q": "PCR Cond. / C", "R": "Seq. Cond.", "S": "Mutation",
    "T": "Guide Sequence", "U": "Phenotype", "V": "Resource02", "W": "Cryo Preservation",
    "X": "Cryo Date", "Y": "Cryo Place", "Z": "Cryo BoxID", "AA": "CryoID_min", "AB": "~",
    "AC": "CryoID_MAX", "AD": "Add Info 02", "AE": "Last Update",
}

TASK_HEADERS = {
    "C": "Posted", "D": "Category", "E": "Task", "F": "Line", "G": "Description",
    "H": "Assigned to", "I": "Due", "J": "Status", "K": "Message", "L": "Last Updated",
}

# One row per special case in the import spec (name -> {header: value}); DOB/dates as ISO text so
# tests can compare without a datetime round-trip. `_hidden` (row-level) is popped before writing.
VER11_ROWS: list[dict[str, object]] = [
    {
        "LINE": "demo_c3", "Status": "Current", "ID Method": "Gel", "DOB (Current)": "2025-09-15",
        "ID Date": "2026-01-08", "ID Number": 9, "Resouces01": "REPOSITORY A",
        "Primer F": "Primer-1", "Sequence F": "cgaatactgcatctcgcgcgcacact", "Primer R": "PRIMER-2",
        "Sequence R": "GACTGGCTAAGGTGATTCGCTAA", "Base Pairs / b. p.": 174, "PCR Cond. / C": 60,
        "Resource02": "Example primers.docx", "Cryo Preservation": True,
        "Last Update": "2026-04-10", "Check": False, "No.": 101,
        "_hidden": False,
    },
    {
        "LINE": "DEMO_E5", "Status": "Closed", "ID Method": "Sequence", "DOB (Current)": "2023-12-17",
        "ID Date": "2024-03-17", "ID Number": 5, "Resouces01": "REPOSITORY A",
        "Primer F": "PRIMER-3", "Sequence F": "GAGAAATTGTCCGGGATTTCT", "Primer R": "PRIMER-4",
        "Sequence R": "CCAAAGAGATCGTGGGTCAGTCCCA", "Base Pairs / b. p.": "N/A",
        "PCR Cond. / C": "61 / 30 s / 35 Cycle", "Seq. Cond.": "Use PRIMER-3",
        "Mutation": "G125 to T", "Resource02": "Example primers.docx",
        "Cryo Preservation": True, "Cryo Date": "2025-09-08", "Cryo Place": "Demo freezer shelf",
        "Cryo BoxID": "Demo cryo box-Bob", "CryoID_min": "C0605", "CryoID_MAX": "C0610",
        "Last Update": "2025-09-08", "Check": False, "No.": 102,
        "_hidden": True,
    },
    {
        "LINE": "demo_b2", "Status": "Current", "ID Method": "Fluoresence",
        "DOB (Current)": "2025-08-20", "ID Date": "2025-10-03", "ID Number": 4,
        "Phenotype": "Day2: green fin fluorescence", "Resource02": "Example microscopy.docx",
        "Cryo Preservation": False, "Last Update": "2025-11-23", "Check": False, "No.": 103,
        "_hidden": False,
    },
    {
        "LINE": "demo_d4", "Status": "Current", "ID Method": "Tails", "DOB (Current)": "2026-01-24",
        "ID Date": "2026-04-19", "ID Number": 7, "Phenotype": "Short Fins",
        "Cryo Preservation": True, "Cryo Date": "2026-03-09", "Cryo Place": "Demo freezer shelf",
        "Cryo BoxID": "Demo cryo box-Bob", "CryoID_min": "C0548", "CryoID_MAX": "C0551",
        "Add Info 02": "Example husbandry note", "Last Update": "2026-04-19", "Check": False, "No.": 104,
        "_hidden": False,
    },
    {
        "LINE": "demo_a1", "Status": "Current", "ID Method": "Sequence",
        "Add Info 01": "demogene5 3 bp insertion", "DOB (Current)": "2026-01-15", "ID Date": "2026-06-15",
        "ID Number": 3, "Primer F": "Primer-5", "Sequence F": "TATGTTCTTTACTAGACGGG",
        "Primer R": "Primer-6", "Sequence R": "TTGTCCGTCGCAAGAAACTT", "Base Pairs / b. p.": 300,
        "PCR Cond. / C": 60, "Seq. Cond.": "Primer-6", "Mutation": "AAG > A--",
        "Guide Sequence": "gattaccttgcgcacacacc", "Phenotype": "Speckled Body",
        "Resource02": "Example protocol.docx", "Cryo Preservation": False,
        "Last Update": "2026-06-15", "Check": False, "No.": 105,
        "_hidden": False,
    },
    {
        # A second PCR condition shape and a External storage cryo row with no lab id.
        "LINE": "demo_023", "Status": "Current", "ID Method": "Gel", "DOB (Current)": "2025-01-11",
        "ID Date": "2025-02-15", "ID Number": 2, "Primer F": "demo_023 GT F1",
        "Primer R": "demo_023 GT R1 ", "Base Pairs / b. p.": "N/A", "PCR Cond. / C": "62 / 40 Cycle",
        "Cryo Preservation": True, "Cryo Place": "External storage", "CryoID_min": "C0000",
        "CryoID_MAX": "C0000", "Last Update": "2025-02-15", "Check": False, "No.": 106,
        "_hidden": True,
    },
    {
        # No ID Number at all (record still created with positive_count = 0, per spec).
        "LINE": "demo_037", "Status": "Breeding", "ID Method": "NONE",
        "DOB (Current)": "2025-06-16", "ID Date": "2025-07-17",
        "Last Update": "2025-07-17", "Check": False, "No.": 107,
        "_hidden": True,
    },
    {
        # An unparsable PCR condition string (keep default 60/35, note the original) and a primer
        # name with a curly apostrophe, kept verbatim and reported (spec section 3.5).
        "LINE": "DEMO_024", "Status": "Current", "ID Method": "Gel", "DOB (Current)": "2025-03-17",
        "ID Date": "2025-04-16", "ID Number": 1, "PCR Cond. / C": "warm, several cycles",
        "Primer R": "Demo’Primer R",
        "Last Update": "2025-04-16", "Check": False, "No.": 108,
        "_hidden": False,
    },
    {
        # Fluorescence line whose fluorophore cannot be inferred (per spec: demo_034).
        "LINE": "demo_034", "Status": "Current", "ID Method": "Fluoresence",
        "DOB (Current)": "2025-05-11", "ID Date": "2025-05-22", "ID Number": 6,
        "Phenotype": "Day5: Tail", "Last Update": "2025-05-22", "Check": False, "No.": 109,
        "_hidden": False,
    },
    {
        # No ID Date and no ID Number at all yet: no genotyping record, ided_number stays 0.
        "LINE": "demo_001", "Status": "Current", "ID Method": "NONE", "Cryo Preservation": False,
        "Last Update": "2025-01-11", "Check": False, "No.": 110,
        "_hidden": False,
    },
    {
        "LINE": "demo_002", "Status": "Current", "ID Method": "NONE", "Cryo Preservation": False,
        "Last Update": "2025-01-18", "Check": False, "No.": 111,
        "_hidden": False,
    },
    {
        "LINE": "DEMO_003", "Status": "Current", "ID Method": "NONE", "Cryo Preservation": False,
        "Last Update": "2025-01-25", "Check": False, "No.": 112,
        "_hidden": False,
    },
]

TASK_ROWS: list[dict[str, object]] = [
    {"Posted": "2025-08-07", "Category": "Genotyping", "Task": "All Process", "Line": "demo_017",
     "Description": "5 example fish", "Assigned to": "Erin", "Due": "2025-08-25", "Status": "Completed",
     "Last Updated": "2025-09-08T09:15:00", "_hidden": True},
    {"Posted": "2025-08-07", "Category": "Genotyping", "Task": "All Process", "Line": "demo_016",
     "Description": "5 example fish", "Assigned to": "Erin", "Due": "2025-08-25", "Status": "Completed",
     "Last Updated": "2025-09-08T09:15:00", "_hidden": True},
    {"Posted": "2025-09-08", "Category": "Breeding", "Task": "Set Out-cross", "Line": "demo_c3",
     "Description": "Use a control fish from the demo rack", "Assigned to": "Erin",
     "Due": "2025-09-24", "Status": "Completed", "Last Updated": "2025-09-25T13:20:00",
     "_hidden": True},
    {"Posted": "2025-11-08", "Category": "Breeding", "Task": "Set Out-cross", "Line": "demo_014",
     "Description": "Use a control fish from the demo rack", "Assigned to": "Erin",
     "Due": "2025-11-16", "Status": "Completed", "Message": "EXAMPLE OBSERVATION",
     "Last Updated": "2025-11-08T08:40:00", "_hidden": False},
    {"Posted": "2025-11-08", "Category": "Breeding", "Task": "Set Out-cross", "Line": "demo_016",
     "Description": "Use a control fish from the demo rack", "Assigned to": "Erin",
     "Due": "2025-11-16", "Status": "Completed", "Message": "EXAMPLE OBSERVATION",
     "Last Updated": "2025-11-08T08:40:00", "_hidden": False},
    {"Posted": "2025-11-08", "Category": "Breeding", "Task": "Collect Embryos", "Line": "Lines Above",
     "Description": "Example collection group", "Assigned to": "Erin",
     "Due": "2025-11-16", "Status": "Completed", "Last Updated": "2025-11-08T08:40:00",
     "_hidden": False},
]


def _write_sheet(workbook, name, state, headers, rows):
    sheet = workbook.create_sheet(name)
    sheet.sheet_state = state
    for letter, header in headers.items():
        sheet[f"{letter}4"] = header
    for index, row in enumerate(rows):
        row_number = 5 + index
        hidden = row.pop("_hidden", False)
        for letter, header in headers.items():
            if header in row:
                sheet[f"{letter}{row_number}"] = row[header]
        sheet.row_dimensions[row_number].hidden = hidden
    return sheet


def build_synthetic_workbook(path: Path) -> Path:
    """Writes a workbook with the same sheet names/visibility and column layout as the real
    Mastersheet, with hand-picked rows covering every normalisation rule in the import spec."""
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    _write_sheet(workbook, "Ver. 1.1", "visible", VER11_HEADERS, [dict(r) for r in VER11_ROWS])
    _write_sheet(workbook, "Ver. 1.0", "hidden", VER11_HEADERS, [])
    _write_sheet(workbook, "Task Management", "visible", TASK_HEADERS, [dict(r) for r in TASK_ROWS])
    _write_sheet(workbook, "Feeding Management", "hidden", {"B": "Week"}, [])
    _write_sheet(workbook, "BACKUP", "hidden", VER11_HEADERS, [])
    workbook.save(path)
    return path


@pytest.fixture
def workbook_path(tmp_path: Path) -> Path:
    return build_synthetic_workbook(tmp_path / "synthetic.xlsx")
