from pathlib import Path

import pytest
from normalize import normalize_line
from overrides import apply_overrides, load_overrides
from reader import read_ver11_rows


def test_load_overrides_missing_file_is_empty(tmp_path: Path):
    assert load_overrides(tmp_path / "no-such-file.yaml") == {}


def test_load_overrides_reads_a_mapping(tmp_path: Path):
    path = tmp_path / "overrides.yaml"
    path.write_text("demo_034:\n  fluorophore: GFP\n")
    assert load_overrides(path) == {"demo_034": {"fluorophore": "GFP"}}


def test_load_overrides_rejects_an_unknown_field(tmp_path: Path):
    path = tmp_path / "overrides.yaml"
    path.write_text("demo_034:\n  nickname: Blinky\n")
    with pytest.raises(ValueError, match="unsupported override field"):
        load_overrides(path)


def test_load_overrides_rejects_a_non_mapping_value(tmp_path: Path):
    path = tmp_path / "overrides.yaml"
    path.write_text("demo_034: GFP\n")
    with pytest.raises(ValueError, match="must map to a mapping"):
        load_overrides(path)


def test_apply_overrides_resolves_the_fluorophore_and_records_a_normalisation(workbook_path: Path):
    raw = next(r for r in read_ver11_rows(workbook_path) if r.values["line"] == "demo_034").values
    line, diagnostics = normalize_line(raw)
    assert any(d.kind == "unresolved" for d in diagnostics)

    resolved = apply_overrides(line, diagnostics, {"demo_034": {"fluorophore": "GFP"}})
    assert line.protocol.fields["fluorophore"] == "GFP"
    assert not any(d.kind == "unresolved" for d in resolved)
    assert any("overrides.yaml" in d.message for d in resolved)


def test_apply_overrides_no_entry_for_this_line_is_a_no_op(workbook_path: Path):
    raw = next(r for r in read_ver11_rows(workbook_path) if r.values["line"] == "demo_c3").values
    line, diagnostics = normalize_line(raw)
    assert apply_overrides(line, diagnostics, {"demo_034": {"fluorophore": "GFP"}}) == diagnostics


def test_apply_overrides_rejects_fluorophore_on_a_non_fluorescence_line(workbook_path: Path):
    raw = next(r for r in read_ver11_rows(workbook_path) if r.values["line"] == "demo_c3").values
    line, diagnostics = normalize_line(raw)
    with pytest.raises(ValueError, match="not a Fluorescence line"):
        apply_overrides(line, diagnostics, {"demo_c3": {"fluorophore": "GFP"}})
