"""Puts the images of a Dropbox copy back into R2 (T-021, docs/06-operations.md section 2.2).

The database comes back with `tools/import/restore_from_export.py`; its rows say where every file
belongs (`attachments.r2_key`). The copy keeps each file as `images/<line name>/<attachment id>-<file name>`,
so a file is matched by its attachment id. Point it at the folder that holds `images/` (for the lab's
copy on a Mac: `~/Library/CloudStorage/Dropbox-.../Apps/Fish-Database-Copy/latest`).

    python tools/mirror/restore_images.py fish-database.json ~/path/to/latest --env local --bucket fish-local-files
    python tools/mirror/restore_images.py fish-database.json ~/path/to/latest --env preview --bucket YOUR_BUCKET --yes
    python tools/mirror/restore_images.py ... --bucket YOUR_BUCKET --dry-run

Needs the maintainer's `wrangler login`. Anything but `local` needs --yes. Attachments removed in the app
are not in the copy; they are reported, not an error.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENVIRONMENTS = ("local", "preview", "rehearsal", "production")


def index_files(folder: Path) -> dict[str, Path]:
    """Attachment id -> file, for every file named `<id>-<name>` below `folder`."""
    found: dict[str, Path] = {}
    for path in sorted(folder.rglob("*")):
        match = re.match(r"^([0-9A-Za-z]+)-", path.name)
        if path.is_file() and match:
            found.setdefault(match.group(1), path)
    return found


def plan(doc: dict, files: dict[str, Path]) -> tuple[list[tuple[dict, Path]], list[dict]]:
    """(attachments with a file to upload, attachments whose file is not in the copy)."""
    todo: list[tuple[dict, Path]] = []
    missing: list[dict] = []
    for entry in doc["lines"]:
        for row in entry["attachments"]:
            path = files.get(str(row["id"]))
            if path is None:
                missing.append(row)
            else:
                todo.append((row, path))
    return todo, missing


def upload(env: str, bucket: str, row: dict, path: Path) -> None:
    command = ["npx", "wrangler", "r2", "object", "put", f"{bucket}/{row['r2_key']}", "--file", str(path)]
    if row.get("mime_type"):
        command += ["--content-type", str(row["mime_type"])]
    command += ["--local"] if env == "local" else ["--remote", "--env", env]
    result = subprocess.run(command, capture_output=True, text=True, cwd=REPO_ROOT, check=False)
    if result.returncode != 0:
        raise SystemExit(f"Upload of {row['r2_key']} failed: {(result.stderr or result.stdout).strip()}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("export", type=Path, help="fish-database.json")
    parser.add_argument("folder", type=Path, help="the folder that contains images/ (the copy's latest/)")
    parser.add_argument("--env", required=True, choices=ENVIRONMENTS)
    parser.add_argument("--bucket", required=True, help="the exact R2 bucket name for this environment")
    parser.add_argument("--yes", action="store_true", help="required for anything but --env local")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if args.env != "local" and not args.dry_run and not args.yes:
        print(f"This writes into the {args.env.upper()} file storage. Run it again with --yes.", file=sys.stderr)
        return 2
    if not (args.folder / "images").is_dir():
        print(f"{args.folder} has no images/ folder. Point at the copy's latest/ folder.", file=sys.stderr)
        return 1
    doc = json.loads(args.export.read_text(encoding="utf-8"))
    todo, missing = plan(doc, index_files(args.folder / "images"))
    for row, path in todo:
        print(("would upload " if args.dry_run else "uploading ") + f"{row['r2_key']}  <-  {path.name}")
        if not args.dry_run:
            upload(args.env, args.bucket, row, path)
    if missing:
        print(f"{len(missing)} attachment(s) are not in the copy (removed in the app, or never copied):")
        for row in missing:
            print(f"  {row['r2_key']}" + ("  (removed)" if row.get("deleted_at") else ""))
    print(f"{'Would upload' if args.dry_run else 'Uploaded'} {len(todo)} file(s) to {args.bucket}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
