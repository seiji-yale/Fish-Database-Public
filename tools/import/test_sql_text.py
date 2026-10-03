from sql_text import sql_insert, sql_literal


def test_none_is_null():
    assert sql_literal(None) == "NULL"


def test_booleans_are_bare_0_or_1():
    assert sql_literal(True) == "1"
    assert sql_literal(False) == "0"


def test_integers_are_bare():
    assert sql_literal(6) == "6"
    assert sql_literal(0) == "0"


def test_strings_are_quoted_and_escaped():
    assert sql_literal("demo_c3") == "'demo_c3'"
    assert sql_literal("O'Brien") == "'O''Brien'"
    assert sql_literal("it's a test's test") == "'it''s a test''s test'"


def test_sql_insert_builds_a_statement_in_dict_order():
    stmt = sql_insert("lines", {"id": "L1", "name": "demo_c3", "gene": None, "version": 1})
    assert stmt == "INSERT INTO lines (id, name, gene, version) VALUES ('L1', 'demo_c3', NULL, 1);"
