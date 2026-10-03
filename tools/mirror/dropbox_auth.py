"""One-time Dropbox authorisation helper for the mirror (T-002 step 3, docs/06-operations.md 1.4).

Uses only the Python standard library and the OAuth "PKCE" flow, so no app secret is needed.
Nothing is written to disk: the refresh token is printed to the terminal once. Never paste it
into chat, a commit, or a log; store it with `npx wrangler secret put DROPBOX_REFRESH_TOKEN`.

    export DROPBOX_APP_KEY=...            # from the Dropbox App Console
    python3 tools/mirror/dropbox_auth.py authorize
    export DROPBOX_REFRESH_TOKEN=...      # printed by the step above
    python3 tools/mirror/dropbox_auth.py where        # which Dropbox root and top-level folders
    python3 tools/mirror/dropbox_auth.py upload-test  # writes ONLY into the sandbox folder

For an "App folder" Dropbox app, paths are relative to that app's folder. Pass
--full-dropbox only if your own app has "Full Dropbox" access. Upload tests are confined to
the /sandbox/ path in either mode.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize"
TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"
UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload"
ACCOUNT_URL = "https://api.dropboxapi.com/2/users/get_current_account"
LIST_URL = "https://api.dropboxapi.com/2/files/list_folder"
# Sandbox for all tests: relative to the app folder (Dropbox/Apps/Fish-Database-Copy/sandbox/).
DEFAULT_TEST_PATH = "/sandbox/README.txt"
REQUIRED_SCOPES = (
    "account_info.read",
    "files.content.write",
    "files.content.read",
    "files.metadata.write",
    "files.metadata.read",
)
TEST_CONTENT = b"Fish-Database mirror authorisation test. Safe to delete.\n"


def make_verifier() -> str:
    """A PKCE code verifier: 43-128 URL-safe characters."""
    return secrets.token_urlsafe(64)


def make_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def build_authorize_url(app_key: str, challenge: str) -> str:
    query = urllib.parse.urlencode(
        {
            "client_id": app_key,
            "response_type": "code",
            "token_access_type": "offline",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


def missing_scopes(granted: str) -> list:
    """Scopes the mirror needs that a token response (space-separated) does not include."""
    have = set(granted.split())
    return [scope for scope in REQUIRED_SCOPES if scope not in have]


def build_code_exchange_body(app_key: str, code: str, verifier: str) -> bytes:
    return urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": app_key,
            "code_verifier": verifier,
        }
    ).encode("ascii")


def build_refresh_body(app_key: str, refresh_token: str) -> bytes:
    return urllib.parse.urlencode(
        {"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": app_key}
    ).encode("ascii")


def choose_path_root(account: dict, app_folder: bool = True) -> str | None:
    """Namespace id to send as Dropbox-API-Path-Root, or None to use the default root.

    An "App folder" app always works inside its app folder and Dropbox rejects the header
    ("path root is not supported for sandbox app"), so it is never sent. For a "Full Dropbox" app
    on a team account, shared folders can live in the team root, which differs
    from the personal home namespace, so the header is needed to reach them.
    """
    if app_folder:
        return None
    root_info = account.get("root_info") or {}
    root = root_info.get("root_namespace_id")
    home = root_info.get("home_namespace_id")
    return root if root and root != home else None


def path_root_header(namespace_id: str) -> str:
    return json.dumps({".tag": "root", "root": namespace_id})


def build_upload_headers(access_token: str, path: str, root_namespace_id: str | None = None) -> dict:
    api_arg = json.dumps({"path": path, "mode": "overwrite", "mute": True})
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/octet-stream",
        # Dropbox requires the argument header to be ASCII-safe JSON.
        "Dropbox-API-Arg": api_arg.encode("ascii", "backslashreplace").decode("ascii"),
    }
    if root_namespace_id:
        headers["Dropbox-API-Path-Root"] = path_root_header(root_namespace_id)
    return headers


def hint_for_error(detail: str) -> str:
    """A plain-English hint for known Dropbox errors ('' when there is none)."""
    if "sandbox app" in detail or "path root is not supported" in detail:
        return (
            "\nHint: this Dropbox app has access type 'App folder' (the API calls it a sandbox app). "
            "Run the command without --full-dropbox; paths are then relative to "
            "Dropbox/Apps/<app name>/."
        )
    return ""


def _post(url: str, body: bytes | None, headers: dict | None = None) -> dict:
    request = urllib.request.Request(url, data=body, headers=headers or {}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        raise SystemExit(f"Dropbox returned HTTP {error.code}: {detail}{hint_for_error(detail)}") from None


def _require_app_key() -> str:
    app_key = os.environ.get("DROPBOX_APP_KEY", "").strip()
    if not app_key:
        raise SystemExit("Set DROPBOX_APP_KEY (the App key from the Dropbox App Console) first.")
    return app_key


def cmd_authorize() -> None:
    app_key = _require_app_key()
    verifier = make_verifier()
    print("1. Open this URL in the Dropbox account for this installation and click Allow:\n")
    print(build_authorize_url(app_key, make_challenge(verifier)))
    code = input("\n2. Paste the access code Dropbox shows you: ").strip()
    tokens = _post(TOKEN_URL, build_code_exchange_body(app_key, code, verifier))
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise SystemExit("Dropbox did not return a refresh token. Check the app permissions.")
    granted = tokens.get("scope", "")
    print("\nGranted scopes:", granted or "(not reported)")
    missing = missing_scopes(granted)
    if missing:
        raise SystemExit(
            "\nMissing scopes: " + ", ".join(missing) + ".\nEnable them in the App Console "
            "(Permissions tab, then Submit) and run authorize again; tokens keep the scopes they "
            "were issued with."
        )
    print("\nREFRESH TOKEN (shown once; keep it out of chat, git and logs):\n")
    print(refresh)
    print("\nNext: export DROPBOX_REFRESH_TOKEN=<token> and run the upload-test command.")


def _access_token() -> str:
    app_key = _require_app_key()
    refresh = os.environ.get("DROPBOX_REFRESH_TOKEN", "").strip()
    if not refresh:
        raise SystemExit("Set DROPBOX_REFRESH_TOKEN (printed by the authorize command) first.")
    return _post(TOKEN_URL, build_refresh_body(app_key, refresh))["access_token"]


def _json_headers(access: str, root: str | None) -> dict:
    headers = {"Authorization": f"Bearer {access}", "Content-Type": "application/json"}
    if root:
        headers["Dropbox-API-Path-Root"] = path_root_header(root)
    return headers


def cmd_where(app_folder: bool) -> None:
    """Show which root the API uses and the top-level folder names (no file contents)."""
    access = _access_token()
    account = _post(ACCOUNT_URL, None, {"Authorization": f"Bearer {access}"})
    root_info = account.get("root_info", {})
    root = choose_path_root(account, app_folder)
    print("Account type:", account.get("account_type", {}).get(".tag"))
    print("App access type:", "App folder" if app_folder else "Full Dropbox")
    print("Home namespace:", root_info.get("home_namespace_id"))
    print("Root namespace:", root_info.get("root_namespace_id"))
    print("Path root header:", "sent (team space)" if root else "not sent")
    first = "APP FOLDER (Dropbox/Apps/<app name>/)" if app_folder else "HOME"
    for label, active_root in ((first, None), ("ROOT", root)):
        if label == "ROOT" and root is None:
            continue
        listing = _post(LIST_URL, json.dumps({"path": ""}).encode(), _json_headers(access, active_root))
        names = sorted(f"{e['.tag']}: {e['name']}" for e in listing.get("entries", []))
        print(f"\nTop level of {label}:")
        print("\n".join("  " + n for n in names) or "  (empty)")


def is_forbidden_test_path(path: str) -> bool:
    """Upload tests may write only below /sandbox/ and cannot traverse out of it."""
    parts = path.split("/")
    return len(parts) < 3 or parts[0:2] != ["", "sandbox"] or any(
        part in ("", ".", "..") for part in parts[2:]
    )


def cmd_upload_test(path: str, app_folder: bool) -> None:
    if is_forbidden_test_path(path):
        raise SystemExit("Upload tests may write only inside /sandbox/.")
    access = _access_token()
    account = _post(ACCOUNT_URL, None, {"Authorization": f"Bearer {access}"})
    root = choose_path_root(account, app_folder)
    result = _post(UPLOAD_URL, TEST_CONTENT, build_upload_headers(access, path, root))
    # Print only non-sensitive facts so the output can be pasted into ADR-0004 as evidence.
    facts = {k: result.get(k) for k in ("name", "path_display", "size")}
    facts["app_folder"] = app_folder
    facts["team_root_used"] = bool(root)
    print("Upload OK:", json.dumps(facts))


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument(
        "--full-dropbox",
        action="store_true",
        help="the app has access type 'Full Dropbox' (default: 'App folder')",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("authorize", help="run the one-time OAuth flow and print a refresh token")
    sub.add_parser("where", help="show the Dropbox root in use and its top-level folder names")
    upload = sub.add_parser("upload-test", help="upload README.txt into the sandbox folder")
    upload.add_argument("--path", default=DEFAULT_TEST_PATH, help="Dropbox path (default: %(default)s)")
    args = parser.parse_args(argv)
    if args.command == "authorize":
        cmd_authorize()
    elif args.command == "where":
        cmd_where(app_folder=not args.full_dropbox)
    else:
        cmd_upload_test(args.path, app_folder=not args.full_dropbox)
    return 0


if __name__ == "__main__":
    sys.exit(main())
