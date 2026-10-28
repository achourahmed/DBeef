from datetime import datetime

from dbeef.adapters.base import QueryTimeout, WriteBlocked, clamp_limit, to_json_safe


def test_clamp_limit():
    assert clamp_limit(None) == 100
    assert clamp_limit(0) == 1
    assert clamp_limit(50) == 50
    assert clamp_limit(99_999) == 10_000


def test_to_json_safe():
    assert to_json_safe(float("nan")) == "nan"
    assert to_json_safe(b"\x80\x81") == "<binary 2 bytes>"
    assert to_json_safe(b"hello") == "hello"
    assert to_json_safe({"a": [1, b"\xff"]}) == {"a": [1, "<binary 1 bytes>"]}
    assert to_json_safe(datetime(2026, 1, 1)) == "2026-01-01 00:00:00"


def test_error_codes():
    assert WriteBlocked("x").code == "write_blocked"
    assert QueryTimeout("x").code == "timeout"
