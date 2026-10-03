from ulid import new_id


def test_is_26_char_crockford_base32():
    assert len(new_id()) == 26
    assert set(new_id()) <= set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")


def test_does_not_repeat():
    ids = {new_id(1_800_000_000_000) for _ in range(1000)}
    assert len(ids) == 1000


def test_later_timestamp_sorts_after_earlier():
    earlier = new_id(1_800_000_000_000)
    later = new_id(1_800_000_001_000)
    assert later > earlier
