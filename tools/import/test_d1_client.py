import json
from pathlib import Path
from unittest.mock import patch

import pytest
from d1_client import D1Error, execute_file, query


class FakeCompletedProcess:
    def __init__(self, returncode: int, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_query_local_uses_the_local_flag_and_parses_json():
    payload = [{"results": [{"name": "demo_c3"}], "success": True}]
    with patch("d1_client.subprocess.run") as run:
        run.return_value = FakeCompletedProcess(0, stdout=json.dumps(payload))
        rows = query(None, "SELECT name FROM lines")
    args = run.call_args.args[0]
    assert "--local" in args
    assert "--remote" not in args
    assert rows == [{"name": "demo_c3"}]


def test_query_remote_uses_env_flag():
    with patch("d1_client.subprocess.run") as run:
        run.return_value = FakeCompletedProcess(0, stdout=json.dumps([{"results": []}]))
        query("preview", "SELECT 1")
    args = run.call_args.args[0]
    assert "--remote" in args
    assert "--env" in args
    assert "preview" in args


def test_query_with_no_results_is_an_empty_list():
    with patch("d1_client.subprocess.run") as run:
        run.return_value = FakeCompletedProcess(0, stdout=json.dumps([{}]))
        assert query(None, "SELECT 1 WHERE 0") == []


def test_a_failed_command_raises_d1_error_with_stderr():
    with patch("d1_client.subprocess.run") as run:
        run.return_value = FakeCompletedProcess(1, stderr="no such table: lines")
        with pytest.raises(D1Error, match="no such table"):
            query(None, "SELECT * FROM lines")


def test_execute_file_passes_the_path(tmp_path: Path):
    sql_path = tmp_path / "import.sql"
    sql_path.write_text("SELECT 1;")
    with patch("d1_client.subprocess.run") as run:
        run.return_value = FakeCompletedProcess(0)
        execute_file("production", sql_path)
    args = run.call_args.args[0]
    assert "--file" in args
    assert str(sql_path) in args
    assert "production" in args
