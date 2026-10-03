import json
from pathlib import Path

import pytest
from import_xlsx import _confirm, cmd_apply, cmd_dry_run, main

ACTOR_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"


def test_confirm_accepts_the_exact_env_name(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _prompt: "preview")
    _confirm("preview", assume_yes=False)  # must not raise


def test_confirm_rejects_a_typo(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _prompt: "prevew")
    with pytest.raises(SystemExit, match="did not match"):
        _confirm("preview", assume_yes=False)


def test_confirm_yes_skips_the_prompt_for_non_production(monkeypatch):
    def fail(_prompt: str) -> str:
        raise AssertionError("input() must not be called when --yes is given")

    monkeypatch.setattr("builtins.input", fail)
    _confirm("local", assume_yes=True)
    _confirm("preview", assume_yes=True)


def test_confirm_production_is_never_skipped_by_yes(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _prompt: "production")
    _confirm("production", assume_yes=True)  # still asks; correct answer passes

    monkeypatch.setattr("builtins.input", lambda _prompt: "")
    with pytest.raises(SystemExit, match="did not match"):
        _confirm("production", assume_yes=True)  # --yes does not bypass a wrong/blank answer


def test_main_requires_env_with_apply(tmp_path: Path):
    xlsx = tmp_path / "in.xlsx"
    xlsx.write_bytes(b"")
    with pytest.raises(SystemExit):
        main(["--file", str(xlsx), "--actor-id", ACTOR_ID, "--apply", "--out", str(tmp_path / "out")])


def test_main_rejects_a_missing_file(tmp_path: Path):
    with pytest.raises(SystemExit):
        main(["--file", str(tmp_path / "does-not-exist.xlsx"), "--actor-id", ACTOR_ID, "--dry-run", "--out", str(tmp_path / "out")])


def test_main_requires_a_valid_actor_id(tmp_path: Path, capsys):
    xlsx = tmp_path / "in.xlsx"
    xlsx.write_bytes(b"")
    with pytest.raises(SystemExit):
        main(["--file", str(xlsx), "--dry-run", "--out", str(tmp_path / "out")])
    with pytest.raises(SystemExit):
        main(["--file", str(xlsx), "--actor-id", "not-a-ulid", "--dry-run", "--out", str(tmp_path / "out")])
    assert "26-character ULID" in capsys.readouterr().err


def test_dry_run_writes_report_lines_json_and_sql(workbook_path: Path, tmp_path: Path):
    out_dir = tmp_path / "out"
    overrides_path = tmp_path / "overrides.yaml"
    overrides_path.write_text("")
    cmd_dry_run(workbook_path, out_dir, overrides_path, ACTOR_ID)

    assert (out_dir / "report.md").exists()
    assert (out_dir / "lines.json").exists()
    assert (out_dir / "sql" / "import.sql").exists()

    lines = json.loads((out_dir / "lines.json").read_text())
    assert any(entry["name"] == "demo_c3" for entry in lines)
    sql_text = (out_dir / "sql" / "import.sql").read_text()
    assert "BEGIN" not in sql_text  # see loader.join_statements
    assert "INSERT INTO lines" in sql_text
    assert "INSERT INTO chat_messages" in sql_text


def test_dry_run_main_entrypoint(workbook_path: Path, tmp_path: Path):
    out_dir = tmp_path / "out"
    exit_code = main(["--file", str(workbook_path), "--actor-id", ACTOR_ID, "--dry-run", "--out", str(out_dir)])
    assert exit_code == 0
    assert (out_dir / "report.md").exists()


def test_apply_asks_for_confirmation_and_applies_via_d1_client(
    workbook_path: Path, tmp_path: Path, monkeypatch
):
    applied = {}

    def fake_query(env, sql):
        if "FROM users WHERE" in sql:
            return [{"id": ACTOR_ID}]
        if "line_versions" in sql:
            return []  # no existing lines: everything is a fresh insert
        return []  # no imported chat messages yet either

    def fake_execute_file(env, path):
        applied["env"] = env
        applied["path"] = path

    monkeypatch.setattr("import_xlsx.d1_client.query", fake_query)
    monkeypatch.setattr("import_xlsx.d1_client.execute_file", fake_execute_file)
    monkeypatch.setattr("builtins.input", lambda _prompt: "local")

    out_dir = tmp_path / "out"
    overrides_path = tmp_path / "overrides.yaml"
    overrides_path.write_text("")
    cmd_apply(workbook_path, "local", out_dir, overrides_path, assume_yes=False, actor_id=ACTOR_ID)

    assert applied["env"] is None  # "local" maps to d1_client's local (None) environment
    assert applied["path"] == out_dir / "sql" / "import.sql"
    sql_text = (out_dir / "sql" / "import.sql").read_text()
    assert sql_text.count("INSERT INTO lines") == 12  # every line in the synthetic fixture
    assert "INSERT INTO import_runs" in sql_text


def test_apply_aborts_on_the_wrong_confirmation_without_calling_execute_file(
    workbook_path: Path, tmp_path: Path, monkeypatch
):
    def fail_execute_file(env, path):
        raise AssertionError("execute_file must not run after a failed confirmation")

    monkeypatch.setattr("import_xlsx.d1_client.query", lambda env, sql: [{"id": ACTOR_ID}] if "FROM users WHERE" in sql else [])
    monkeypatch.setattr("import_xlsx.d1_client.execute_file", fail_execute_file)
    monkeypatch.setattr("builtins.input", lambda _prompt: "nope")

    with pytest.raises(SystemExit, match="did not match"):
        cmd_apply(workbook_path, "preview", tmp_path / "out", tmp_path / "overrides.yaml", assume_yes=False, actor_id=ACTOR_ID)


def test_apply_rejects_an_inactive_or_unknown_actor_before_writing(
    workbook_path: Path, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr("import_xlsx.d1_client.query", lambda env, sql: [])
    monkeypatch.setattr("import_xlsx.d1_client.execute_file", lambda env, path: pytest.fail("must not write"))
    with pytest.raises(SystemExit, match="existing, active Admin or Member"):
        cmd_apply(workbook_path, "preview", tmp_path / "out", tmp_path / "overrides.yaml", assume_yes=True, actor_id=ACTOR_ID)
    assert not (tmp_path / "out").exists()
