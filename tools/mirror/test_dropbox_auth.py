import base64
import hashlib
import json
import urllib.parse

import dropbox_auth as auth


def test_verifier_length_is_within_pkce_limits():
    assert 43 <= len(auth.make_verifier()) <= 128


def test_verifiers_are_random():
    assert auth.make_verifier() != auth.make_verifier()


def test_challenge_is_base64url_sha256_without_padding():
    verifier = "abc"
    expected = base64.urlsafe_b64encode(hashlib.sha256(b"abc").digest()).decode().rstrip("=")
    assert auth.make_challenge(verifier) == expected
    assert "=" not in auth.make_challenge(verifier)


def test_authorize_url_requests_offline_access_with_pkce():
    url = auth.build_authorize_url("APPKEY", "CHALLENGE")
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    assert parsed.netloc == "www.dropbox.com"
    assert query["client_id"] == ["APPKEY"]
    assert query["token_access_type"] == ["offline"]
    assert query["code_challenge"] == ["CHALLENGE"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["response_type"] == ["code"]


def test_code_exchange_body_has_verifier_and_no_secret():
    body = urllib.parse.parse_qs(auth.build_code_exchange_body("APPKEY", "CODE", "VERIFIER").decode())
    assert body["grant_type"] == ["authorization_code"]
    assert body["code_verifier"] == ["VERIFIER"]
    assert "client_secret" not in body


def test_refresh_body():
    body = urllib.parse.parse_qs(auth.build_refresh_body("APPKEY", "RT").decode())
    assert body == {"grant_type": ["refresh_token"], "refresh_token": ["RT"], "client_id": ["APPKEY"]}


def test_upload_headers_overwrite_and_stay_ascii():
    headers = auth.build_upload_headers("TOKEN", "/example/README.txt")
    assert headers["Authorization"] == "Bearer TOKEN"
    assert '"mode": "overwrite"' in headers["Dropbox-API-Arg"]
    headers["Dropbox-API-Arg"].encode("ascii")


def test_upload_headers_escape_non_ascii_paths():
    headers = auth.build_upload_headers("T", "/café/a.txt")
    headers["Dropbox-API-Arg"].encode("ascii")
    assert "\\xe9" in headers["Dropbox-API-Arg"] or "\\u00e9" in headers["Dropbox-API-Arg"]


def test_missing_scopes_reports_what_is_absent():
    granted = "account_info.read files.content.read files.metadata.write files.metadata.read"
    assert auth.missing_scopes(granted) == ["files.content.write"]


def test_missing_scopes_empty_when_all_granted():
    assert auth.missing_scopes(" ".join(auth.REQUIRED_SCOPES)) == []


def test_missing_scopes_when_none_reported():
    assert auth.missing_scopes("") == list(auth.REQUIRED_SCOPES)


def test_default_test_path_is_inside_the_sandbox():
    assert not auth.is_forbidden_test_path(auth.DEFAULT_TEST_PATH)
    assert "sandbox" in auth.DEFAULT_TEST_PATH.lower()


def test_forbidden_test_paths():
    assert auth.is_forbidden_test_path("/example/README.txt")
    assert auth.is_forbidden_test_path("/sandbox/../example.txt")
    assert auth.is_forbidden_test_path("/sandbox/")
    assert not auth.is_forbidden_test_path("/sandbox/README.txt")


TEAM_ACCOUNT = {"root_info": {"root_namespace_id": "999", "home_namespace_id": "100"}}


def test_choose_path_root_never_for_app_folder_apps():
    assert auth.choose_path_root(TEAM_ACCOUNT) is None
    assert auth.choose_path_root(TEAM_ACCOUNT, app_folder=True) is None


def test_choose_path_root_none_for_personal_full_dropbox_account():
    account = {"root_info": {"root_namespace_id": "100", "home_namespace_id": "100"}}
    assert auth.choose_path_root(account, app_folder=False) is None


def test_choose_path_root_team_root_for_full_dropbox_team_account():
    assert auth.choose_path_root(TEAM_ACCOUNT, app_folder=False) == "999"


def test_choose_path_root_handles_missing_root_info():
    assert auth.choose_path_root({}, app_folder=False) is None


def test_upload_headers_send_path_root_only_when_given():
    assert "Dropbox-API-Path-Root" not in auth.build_upload_headers("T", "/a.txt")
    headers = auth.build_upload_headers("T", "/a.txt", "999")
    assert json.loads(headers["Dropbox-API-Path-Root"]) == {".tag": "root", "root": "999"}


def test_hint_explains_app_folder_apps():
    detail = "path root is not supported for sandbox app"
    assert "without --full-dropbox" in auth.hint_for_error(detail)


def test_hint_is_empty_for_other_errors():
    assert auth.hint_for_error("something else") == ""
