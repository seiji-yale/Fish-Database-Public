"""Tests for restore_images.py and pull_mirror.py (T-021). No network, no wrangler."""

from __future__ import annotations

import json
from pathlib import Path

import pull_mirror
import pytest
import restore_images

DOC = {
    "lines": [
        {
            "attachments": [
                {"id": "A1", "r2_key": "lines/L1/A1-gel.png", "mime_type": "image/png", "deleted_at": None},
                {"id": "A2", "r2_key": "lines/L1/A2-old.png", "mime_type": None, "deleted_at": "2026-01-01"},
            ]
        }
    ]
}


def make_copy(tmp_path: Path) -> tuple[Path, Path]:
    export = tmp_path / "fish-database.json"
    export.write_text(json.dumps(DOC), encoding="utf-8")
    latest = tmp_path / "latest"
    (latest / "images" / "demo_c3").mkdir(parents=True)
    (latest / "images" / "demo_c3" / "A1-gel.png").write_bytes(b"png")
    (latest / "images" / "demo_c3" / "notes.txt").write_bytes(b"not an attachment")
    return export, latest


def test_files_are_matched_by_attachment_id(tmp_path):
    export, latest = make_copy(tmp_path)
    files = restore_images.index_files(latest / "images")
    assert list(files) == ["A1"]
    todo, missing = restore_images.plan(DOC, files)
    assert [row["id"] for row, _ in todo] == ["A1"]
    assert [row["id"] for row in missing] == ["A2"]


def test_bucket_name_is_required(tmp_path):
    export, latest = make_copy(tmp_path)
    with pytest.raises(SystemExit, match="2"):
        restore_images.main([str(export), str(latest), "--env", "local"])


def test_dry_run_lists_without_uploading_and_reports_missing(tmp_path, monkeypatch, capsys):
    export, latest = make_copy(tmp_path)
    monkeypatch.setattr(restore_images, "upload", lambda *a: pytest.fail("uploaded in a dry run"))
    assert restore_images.main([str(export), str(latest), "--env", "preview", "--bucket", "demo-preview", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "would upload lines/L1/A1-gel.png" in out
    assert "lines/L1/A2-old.png  (removed)" in out
    assert "Would upload 1 file(s) to demo-preview" in out


def test_uploads_locally_and_needs_yes_elsewhere(tmp_path, monkeypatch, capsys):
    export, latest = make_copy(tmp_path)
    sent = []
    monkeypatch.setattr(restore_images, "upload", lambda env, bucket, row, path: sent.append((env, bucket, row["r2_key"])))
    assert restore_images.main([str(export), str(latest), "--env", "production", "--bucket", "demo-prod"]) == 2
    assert "PRODUCTION" in capsys.readouterr().err
    assert restore_images.main([str(export), str(latest), "--env", "local", "--bucket", "demo-local"]) == 0
    assert sent == [("local", "demo-local", "lines/L1/A1-gel.png")]
    assert restore_images.main([str(export), str(tmp_path), "--env", "local", "--bucket", "demo-local"]) == 1
    assert "no images/ folder" in capsys.readouterr().err


def test_upload_builds_the_wrangler_command(tmp_path, monkeypatch):
    calls = []

    class Done:
        returncode, stdout, stderr = 0, "", ""

    monkeypatch.setattr(restore_images.subprocess, "run", lambda cmd, **kw: calls.append(cmd) or Done())
    file = tmp_path / "A1-gel.png"
    restore_images.upload("preview", "demo-preview", DOC["lines"][0]["attachments"][0], file)
    restore_images.upload("local", "demo-local", DOC["lines"][0]["attachments"][1], file)
    assert calls[0][2:5] == ["r2", "object", "put"] and "demo-preview/lines/L1/A1-gel.png" in calls[0]
    assert calls[0][-3:] == ["--remote", "--env", "preview"] and "--content-type" in calls[0]
    assert calls[1][-1] == "--local" and "--content-type" not in calls[1]

    class Failed:
        returncode, stdout, stderr = 1, "", "no such bucket"

    monkeypatch.setattr(restore_images.subprocess, "run", lambda cmd, **kw: Failed())
    with pytest.raises(SystemExit, match="no such bucket"):
        restore_images.upload("preview", "demo-preview", DOC["lines"][0]["attachments"][0], file)


def test_export_path_for_latest_archive_and_folders():
    assert pull_mirror.export_path("/", None) == "/latest/fish-database.json"
    assert pull_mirror.export_path("/preview", None) == "/preview/latest/fish-database.json"
    assert pull_mirror.export_path("preview/", "2026-10-05") == "/preview/archive/2026-10-05/fish-database.json"


def test_pull_downloads_then_restores_locally_with_wipe(monkeypatch, capsys):
    seen = {}
    monkeypatch.setattr(pull_mirror.dropbox_auth, "_access_token", lambda: "token")
    monkeypatch.setattr(pull_mirror, "download", lambda token, path: seen.update(path=path) or b"{}")

    class Done:
        returncode = 0

    monkeypatch.setattr(pull_mirror.subprocess, "run", lambda cmd, **kw: seen.update(cmd=cmd) or Done())
    assert pull_mirror.main(["--folder", "/preview"]) == 0
    assert seen["path"] == "/preview/latest/fish-database.json"
    assert ["--env", "local", "--wipe"] == seen["cmd"][-3:]
    assert "production" not in " ".join(seen["cmd"])
    assert "Downloading /preview/latest/fish-database.json" in capsys.readouterr().out


def test_download_sends_the_path_and_explains_a_refusal(monkeypatch):
    import urllib.error
    import urllib.request

    class Reply:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"data"

    captured = {}
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout: captured.update(req=req) or Reply())
    assert pull_mirror.download("tok", "/latest/fish-database.json") == b"data"
    assert captured["req"].get_header("Authorization") == "Bearer tok"
    assert json.loads(captured["req"].get_header("Dropbox-api-arg")) == {"path": "/latest/fish-database.json"}

    def refuse(req, timeout):
        raise urllib.error.HTTPError("u", 409, "x", {}, __import__("io").BytesIO(b"path/not_found/"))

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    with pytest.raises(SystemExit, match="HTTP 409.*not_found"):
        pull_mirror.download("tok", "/missing")
