from pathlib import Path

from seed_users import load_seeded_user_ids, load_user_ids_from_sql

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "worker" / "db" / "migrations"
TEST_USERS = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "users.sql"


def test_reads_builtin_users_from_the_migration_file():
    ids = load_seeded_user_ids(MIGRATIONS_DIR)
    assert {"Admin", "Guest"}.issubset(ids)
    assert all(len(user_id) == 26 for user_id in ids.values())


def test_demo_accounts_live_in_a_separate_fixture():
    demo_ids = load_user_ids_from_sql(TEST_USERS)
    assert len(demo_ids) == 5
    assert not {"Admin", "Guest"} & demo_ids.keys()


def test_missing_file_raises(tmp_path):
    try:
        load_seeded_user_ids(tmp_path)
    except FileNotFoundError:
        pass
    else:
        raise AssertionError("expected FileNotFoundError")
