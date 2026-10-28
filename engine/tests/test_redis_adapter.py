import os
import random
import string
from types import SimpleNamespace

import pytest
import redis

from dbeef.adapters.base import StoreUnavailable, WriteBlocked
from dbeef.adapters.redis import RedisAdapter, key_pattern

URL = os.environ.get("REDIS_TEST_URL", "redis://localhost:6379/15")


def _reachable() -> bool:
    try:
        redis.Redis.from_url(URL, socket_timeout=1).ping()
        return True
    except redis.RedisError:
        return False


needs_redis = pytest.mark.skipif(not _reachable(), reason="Redis not reachable")


@pytest.fixture
def keys():
    client = redis.Redis.from_url(URL)
    # letters only: a digit would make key_pattern collapse the prefix to *
    prefix = "dbeeftest" + "".join(random.choices(string.ascii_lowercase, k=8))
    written = [f"{prefix}:job:1a2b3c", f"{prefix}:job:4d5e6f", f"{prefix}:queue:main", f"{prefix}:big"]
    for k in written[:2]:
        client.hset(k, mapping={"status": "finished", "data": b"\x80\x05\x95\x00\x01"})
    client.rpush(f"{prefix}:queue:main", "a", "b")
    client.set(f"{prefix}:big", "x" * 5000)
    yield SimpleNamespace(prefix=prefix, client=client)
    client.delete(*written, f"{prefix}:x", f"{prefix}:y")
    client.close()


@pytest.fixture
def a():
    adapter = RedisAdapter(URL)
    yield adapter
    adapter.close()


def test_key_pattern():
    assert key_pattern("rq:job:3f2a9c1e-77d0-4b1e-9d1a-2c6b0f5e8a11") == "rq:job:*"
    assert key_pattern("rq:queue:vedas") == "rq:queue:vedas"


@needs_redis
def test_patterns_and_describe(keys, a):
    pats = {c.name for c in a.list_collections()}
    assert f"{keys.prefix}:job:*" in pats
    d = a.describe(f"{keys.prefix}:job:*")
    assert [f.name for f in d.fields][0] == "$key"
    assert {"status", "data"} <= {f.name for f in d.fields}


@needs_redis
def test_binary_and_big_values(keys, a):
    row = a.sample(f"{keys.prefix}:job:*").rows[0]
    assert row[3]["data"].startswith("<binary ")
    big = a.sample(f"{keys.prefix}:big").rows[0][3]
    assert len(big) == 1000


@needs_redis
@pytest.mark.parametrize("cmd", ["SET {p}:x 1", "DEL {p}:big", "FLUSHALL",
                                 "EVAL \"return redis.call('SET','{p}:y','1')\" 0", "CONFIG SET save ''"])
def test_writes_blocked(keys, a, cmd):
    with pytest.raises(WriteBlocked):
        a.query(cmd.format(p=keys.prefix))
    assert keys.client.exists(f"{keys.prefix}:big") == 1
    assert keys.client.exists(f"{keys.prefix}:x") == 0
    assert keys.client.exists(f"{keys.prefix}:y") == 0


@needs_redis
def test_read_query(keys, a):
    assert a.query(f"LRANGE {keys.prefix}:queue:main 0 -1").rows == [["a"], ["b"]]


def test_unreachable():
    down = RedisAdapter("redis://127.0.0.1:1")
    with pytest.raises(StoreUnavailable):
        down.ping()
    down.close()


def test_scan_errors_are_store_unavailable():
    down = RedisAdapter("redis://127.0.0.1:1")
    with pytest.raises(StoreUnavailable):
        down.list_collections()
    down.close()
