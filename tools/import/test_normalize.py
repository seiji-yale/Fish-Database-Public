import pytest
from normalize import (
    Diagnostic,
    fix_cryo_place,
    infer_fluorophore,
    normalize_line,
    normalize_status,
    parse_cryo_ids,
    parse_expected_band,
    parse_fluorescence_phenotype,
    parse_gene_and_note,
    parse_pcr_condition,
)
from reader import read_ver11_rows


def records_by_name(workbook_path):
    return {r.values["line"]: r.values for r in read_ver11_rows(workbook_path)}


# --- BR-10 vocabulary, via a full normalize_line, is covered by the integration tests below. ---


def test_normalize_status_accepts_the_three_values_and_rejects_anything_else():
    assert normalize_status("Current", line="x") == "Current"
    assert normalize_status("Breeding", line="x") == "Breeding"
    assert normalize_status("Closed", line="x") == "Closed"
    with pytest.raises(ValueError, match="unknown Status"):
        normalize_status("Retired", line="x")


def test_parse_gene_and_note_handles_the_documented_allele_exception():
    assert parse_gene_and_note(None) == (None, None)
    assert parse_gene_and_note("pkd2") == ("pkd2", None)
    assert parse_gene_and_note("demogene5 3 bp insertion") == ("demogene5", "[import] allele note: 3 bp insertion")


@pytest.mark.parametrize(
    "raw, expected",
    [
        (60, (60, 35, None)),
        ("62 / 40 Cycle", (62, 40, "[import] PCR condition: 62 / 40 Cycle")),
        ("61 / 30 s / 35 Cycle", (61, 35, "[import] PCR condition: 61 / 30 s / 35 Cycle")),
        ("warm, several cycles", (60, 35, "[import] PCR condition: warm, several cycles")),
    ],
)
def test_parse_pcr_condition(raw, expected):
    assert parse_pcr_condition(raw) == expected


def test_parse_expected_band():
    assert parse_expected_band(174) == "174"
    assert parse_expected_band("N/A") == "N/A"
    assert parse_expected_band(None) is None


def test_parse_fluorescence_phenotype():
    assert parse_fluorescence_phenotype("Day2: green fin fluorescence", line="x") == ("2", "green fin fluorescence")
    assert parse_fluorescence_phenotype("Day 1-2: Green heart , tail tip", line="x") == (
        "1-2", "Green heart , tail tip",
    )
    assert parse_fluorescence_phenotype("Day5: Tail", line="x") == ("5", "Tail")
    with pytest.raises(ValueError, match="does not match"):
        parse_fluorescence_phenotype("something else", line="x")


def test_infer_fluorophore_checks_gfp_and_green_before_mcherry_and_red():
    assert infer_fluorophore("green fin fluorescence", "demo_b2") == "GFP"
    assert infer_fluorophore("Green heart, tail tip", "line") == "GFP"
    assert infer_fluorophore("Use Red", "line") == "mCherry"
    assert infer_fluorophore("something else", "demo_034") is None


def test_fix_cryo_place_typo():
    assert fix_cryo_place("External storage") == "External storage"
    assert fix_cryo_place("Demo freezer shelf") == "Demo freezer shelf"
    assert fix_cryo_place(None) is None


def test_parse_cryo_ids_research_core_has_no_lab_id():
    assert parse_cryo_ids("C0000", "C0000") == (None, None, None, "[import] external storage, no lab ID")


def test_parse_cryo_ids_computes_count_from_a_range():
    assert parse_cryo_ids("C0701", "C0707") == ("C0701", "C0707", 7, None)
    assert parse_cryo_ids("C0713", "C0720") == ("C0713", "C0720", 8, None)


def test_parse_cryo_ids_when_absent():
    assert parse_cryo_ids(None, None) == (None, None, None, None)


def test_demo_c3_pcr_source_cryo_unknown_details(workbook_path):
    raw = records_by_name(workbook_path)["demo_c3"]
    line, diagnostics = normalize_line(raw)
    assert line.status == "Current"
    assert line.protocol.protocol_type == "pcr"
    assert line.protocol.label == "PCR"
    assert line.protocol.fields == {
        "primer_f_name": "Primer-1", "primer_f_seq": "CGAATACTGCATCTCGCGCGCACACT",
        "primer_r_name": "PRIMER-2", "primer_r_seq": "GACTGGCTAAGGTGATTCGCTAA",
        "annealing_c": 60, "expected_band": "174", "cycles": 35,
    }
    assert line.source_attribute == "REPOSITORY A"
    assert line.cryo_record is not None
    assert line.cryo_record.details_unknown == 1
    assert line.cryo_record.cryo_id_start is None
    assert line.genotyping_record.positive_count == raw["id_number"]
    assert line.ided_number == raw["id_number"]
    assert line.last_id_date == "2026-01-08"
    assert line.reference_title == "Example primers.docx"
    assert diagnostics == []


def test_demo_e5_pcr_sequence_with_parsed_condition_and_cryo_range(workbook_path):
    raw = records_by_name(workbook_path)["DEMO_E5"]
    line, diagnostics = normalize_line(raw)
    assert line.status == "Closed"
    assert line.protocol.protocol_type == "pcr_sequence"
    assert line.protocol.fields["annealing_c"] == 61
    assert line.protocol.fields["cycles"] == 35
    assert line.protocol.fields["seq_primer"] == "PRIMER-3"  # "Use " prefix stripped
    assert line.protocol.fields["expected_band"] == "N/A"
    assert line.protocol.notes == "[import] PCR condition: 61 / 30 s / 35 Cycle"
    assert line.cryo_record.cryo_id_start == "C0605"
    assert line.cryo_record.count == int(line.cryo_record.cryo_id_end[1:]) - int(line.cryo_record.cryo_id_start[1:]) + 1
    assert any(d.kind == "normalisation" and "annealing 61" in d.message for d in diagnostics)


def test_demo_b2_fluorescence_fields_and_no_phenotype_row(workbook_path):
    raw = records_by_name(workbook_path)["demo_b2"]
    line, diagnostics = normalize_line(raw)
    assert line.protocol.protocol_type == "fluorescence"
    assert line.protocol.fields == {
        "fluorophore": "GFP", "screening_day": "2", "description": "green fin fluorescence",
    }
    assert line.phenotypes == []
    assert line.cryo_record is None
    assert diagnostics == []


def test_demo_d4_tails_phenotype_and_note(workbook_path):
    raw = records_by_name(workbook_path)["demo_d4"]
    line, diagnostics = normalize_line(raw)
    assert line.protocol.protocol_type == "tails"
    assert line.protocol.fields == {}
    assert line.phenotypes == ["Short Fins"]
    assert line.notes == "Example husbandry note"
    assert line.cryo_record.cryo_id_start == "C0548"
    assert line.cryo_record.count == int(line.cryo_record.cryo_id_end[1:]) - int(line.cryo_record.cryo_id_start[1:]) + 1
    assert diagnostics == []


def test_demogene5_m1_gene_split_from_allele_note(workbook_path):
    raw = records_by_name(workbook_path)["demo_a1"]
    line, diagnostics = normalize_line(raw)
    assert line.gene == "demogene5"
    assert line.notes == "[import] allele note: 3 bp insertion"
    assert line.protocol.fields["guide_seq"] == "GATTACCTTGCGCACACACC"
    assert any(d.kind == "normalisation" and "allele note" in d.message for d in diagnostics)


def test_demo_023_research_core_cryo_and_trailing_space_primer(workbook_path):
    raw = records_by_name(workbook_path)["demo_023"]
    line, diagnostics = normalize_line(raw)
    assert line.protocol.fields["primer_r_name"] == "demo_023 GT R1"  # trailing space trimmed
    assert line.protocol.fields["annealing_c"] == 62
    assert line.protocol.fields["cycles"] == 40
    assert line.cryo_record.cryo_id_start is None
    assert line.cryo_record.details_unknown == 0  # place is known; only the lab id is missing
    assert line.cryo_record.notes == "[import] external storage, no lab ID"
    assert any("external storage" in d.message for d in diagnostics)


def test_lrrc50_m1_date_without_number_still_creates_a_record(workbook_path):
    raw = records_by_name(workbook_path)["demo_037"]
    line, diagnostics = normalize_line(raw)
    assert line.genotyping_record is not None
    assert line.genotyping_record.positive_count == 0
    assert line.ided_number == 0
    assert any(d.kind == "normalisation" and "0 positives" in d.message for d in diagnostics)


def test_demo_024_unparsable_pcr_condition_keeps_default_and_notes_original(workbook_path):
    raw = records_by_name(workbook_path)["DEMO_024"]
    line, diagnostics = normalize_line(raw)
    assert line.protocol.fields["annealing_c"] == 60
    assert line.protocol.fields["cycles"] == 35
    assert line.protocol.notes == "[import] PCR condition: warm, several cycles"


def test_demo_024_non_ascii_primer_name_is_kept_verbatim_and_reported(workbook_path):
    raw = records_by_name(workbook_path)["DEMO_024"]
    line, diagnostics = normalize_line(raw)
    assert line.protocol.fields["primer_r_name"] == "Demo’Primer R"
    assert any(
        d.kind == "normalisation" and "non-ASCII" in d.message and "primer_r_name" in d.message
        for d in diagnostics
    )


def test_tpi_um14_uninferred_fluorophore_is_reported_as_unresolved(workbook_path):
    raw = records_by_name(workbook_path)["demo_034"]
    line, diagnostics = normalize_line(raw)
    assert line.protocol.fields["fluorophore"] is None
    assert any(d.kind == "unresolved" and "fluorophore" in d.message for d in diagnostics)


def test_three_lines_without_id_date_or_number_get_no_record_and_zero_ided(workbook_path):
    for name in ("demo_001", "demo_002", "DEMO_003"):
        raw = records_by_name(workbook_path)[name]
        line, diagnostics = normalize_line(raw)
        assert line.genotyping_record is None
        assert line.ided_number == 0
        assert line.last_id_date is None
