"""`npm run db:pull-mirror` (T-021, FR-SYNC-05): replaces the LOCAL development database with the lab's latest
Dropbox copy, in one command. Read-only towards Dropbox; it only ever writes the local database.

    export DROPBOX_APP_KEY=...  DROPBOX_REFRESH_TOKEN=...      # the preview/production secrets, from your keychain
    npm run db:pull-mirror                       # the copy at the top of the app folder (production's)
    npm run db:pull-mirror -- --folder /preview  # preview's copy
    npm run db:pull-mirror -- --archive 2026-10-05

Downloads `<folder>/latest/fish-database.json` (or `<folder>/archive/<date>/...`) and runs
`tools/import/restore_from_export.py --env local --wipe`. Images are not pulled (use restore_images.py
with a folder from the Dropbox app if you need them locally).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

import dropbox_auth

REPO_ROOT = Path(__file__).resolve().parents[2]
DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download"


def export_path(folder: str, archive: str | None) -> str:
    base = "/".join(part for part in folder.split("/") if part)
    where = f"archive/{archive}" if archive else "latest"
    return "/" + "/".join(part for part in (base, where, "fish-database.json") if part)


def download(access_token: str, path: str) -> bytes:
    api_arg = json.dumps({"path": path}).encode("ascii", "backslashreplace").decode("ascii")
    request = urllib.request.Request(
        DOWNLOAD_URL, method="POST", headers={"Authorization": f"Bearer {access_token}", "Dropbox-API-Arg": api_arg}
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        raise SystemExit(f"Dropbox could not give {path} (HTTP {error.code}): {detail}") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--folder", default="/", help="mirror folder inside the app folder (default: %(default)s)")
    parser.add_argument("--archive", help="a nightly archive date, e.g. 2026-10-05 (default: latest)")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    path = export_path(args.folder, args.archive)
    print(f"Downloading {path} ...")
    body = download(dropbox_auth._access_token(), path)
    target = Path(tempfile.mkdtemp(prefix="fish-pull-")) / "fish-database.json"
    target.write_bytes(body)
    command = [sys.executable, "tools/import/restore_from_export.py", str(target), "--env", "local", "--wipe"]
    return subprocess.run(command, cwd=REPO_ROOT, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
