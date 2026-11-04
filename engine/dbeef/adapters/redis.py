"""Read-only Redis adapter: collections are key patterns."""

import re
import shlex
from collections import Counter
from contextlib import contextmanager

import redis

from .base import (QUERY_TIMEOUT_S, Adapter, BadQuery, Collection, Description, Field,
                   NotFound, QueryResult, QueryTimeout, StoreUnavailable, WriteBlocked,
                   clamp_limit, not_yet, to_json_safe)

SCAN_CAP = 10_000
_DESCRIBE_SAMPLE = 20
_PREVIEW = 10

READ_COMMANDS = frozenset("""
GET MGET STRLEN GETRANGE HGET HGETALL HKEYS HVALS HLEN HMGET HEXISTS HSCAN LRANGE LLEN LINDEX
SMEMBERS SCARD SISMEMBER SSCAN ZRANGE ZCARD ZSCORE ZRANGEBYSCORE ZSCAN XRANGE XREVRANGE XLEN
TYPE TTL PTTL EXISTS SCAN DBSIZE
""".split())


def key_pattern(key: str) -> str:
    return ":".join("*" if re.search(r"\d", seg) or len(seg) >= 20 else seg for seg in key.split(":"))


def key_value(pattern: str, key: str) -> str:
    # The '$key' field: the segments a pattern collapsed to '*', joined back with ':'.
    return ":".join(k for p, k in zip(pattern.split(":"), key.split(":")) if p == "*")


def _glob(pattern: str) -> str:
    # shortcut: a literal '*' inside a key segment can't be told apart from a collapsed one.
    return ":".join(seg if seg == "*" else re.sub(r"([\[\]?\\])", r"\\\1", seg) for seg in pattern.split(":"))


class RedisAdapter(Adapter):
    def __init__(self, url: str):
        self._r = redis.Redis.from_url(url, socket_timeout=QUERY_TIMEOUT_S,
                                       socket_connect_timeout=QUERY_TIMEOUT_S, decode_responses=False)

    @contextmanager
    def _errors(self):
        try:
            yield
        except redis.ConnectionError as e:
            raise StoreUnavailable(f"redis unreachable: {e}") from e
        except redis.TimeoutError as e:
            raise QueryTimeout(f"query exceeded {QUERY_TIMEOUT_S}s") from e
        except redis.RedisError as e:
            raise BadQuery(str(e)) from e

    def _call(self, fn, *args, **kwargs):
        with self._errors():
            return fn(*args, **kwargs)

    def _scan(self, match: str | None = None, cap: int = SCAN_CAP) -> tuple[list[str], bool]:
        keys = []
        with self._errors():  # scan_iter is lazy: errors surface while iterating
            for k in self._r.scan_iter(match=match, count=1000):
                keys.append(k.decode("utf-8", "replace"))
                if len(keys) >= cap:
                    return keys, True
        return keys, False

    def _keys_of(self, pattern: str, cap: int) -> list[str]:
        # SCAN's '*' also matches ':', so re-check the segment shape.
        keys, _ = self._scan(_glob(pattern))
        return [k for k in keys if key_pattern(k) == pattern][:cap]

    def ping(self) -> None:
        self._call(self._r.ping)

    def list_collections(self) -> list[Collection]:
        keys, capped = self._scan()
        counts = Counter(key_pattern(k) for k in keys)
        return [Collection(name=p, kind="key_pattern", count=n, count_is_estimate=capped)
                for p, n in sorted(counts.items())]

    def _known(self, pattern: str) -> Collection:
        # Probe the glob and stop at the first key with this shape: no full keyspace scan.
        with self._errors():
            for k in self._r.scan_iter(match=_glob(pattern), count=1000):
                if key_pattern(k.decode("utf-8", "replace")) == pattern:
                    return Collection(name=pattern, kind="key_pattern", count=None)
        raise NotFound(f"no key pattern {pattern!r}")

    def describe(self, name: str) -> Description:
        coll = self._known(name)
        fields = [Field(name="$key", type="key segment")]
        keys = self._keys_of(name, _DESCRIBE_SAMPLE)
        kind = self._call(self._r.type, keys[0]).decode() if keys else "none"
        if kind == "hash":
            names = sorted({f.decode("utf-8", "replace") for k in keys for f in self._call(self._r.hkeys, k)})
            fields += [Field(name=n, type="hash field") for n in names]
        else:
            fields.append(Field(name="value", type=kind))
        return Description(collection=coll, fields=fields, links=[])

    def _value(self, key: str, kind: str):
        r = self._r
        if kind == "string":
            return to_json_safe(self._call(r.get, key))
        if kind == "hash":
            return {to_json_safe(f): to_json_safe(v) for f, v in self._call(r.hgetall, key).items()}
        if kind == "list":
            return [to_json_safe(v) for v in self._call(r.lrange, key, 0, _PREVIEW - 1)]
        if kind == "set":
            return [to_json_safe(v) for v in self._call(r.sscan, key, count=_PREVIEW)[1][:_PREVIEW]]
        if kind == "zset":
            return [[to_json_safe(m), s] for m, s in self._call(r.zrange, key, 0, _PREVIEW - 1, withscores=True)]
        if kind == "stream":
            return to_json_safe(self._call(r.xrange, key, count=_PREVIEW))
        return None

    def rows(self, collection, limit=None, offset=0, order_by=None, desc=False, eq=None, q=None) -> QueryResult:
        not_yet(order_by, q)
        self._known(collection)
        n = clamp_limit(limit)
        if eq and eq[0] == "$key":
            key = collection.replace("*", eq[1])
            keys = [key] if self._call(self._r.exists, key) else []
        else:
            keys = self._keys_of(collection, SCAN_CAP if eq else offset + n + 1)
            if eq:  # a hash field: filter the whole (capped) pattern, since Redis cannot
                field, value = eq
                keys = [k for k in keys if (v := self._call(self._r.hget, k, field)) is not None
                        and v.decode("utf-8", "replace") == value]
            keys = keys[offset:]
        rows = []
        for k in keys[:n]:
            kind = self._call(self._r.type, k).decode()
            rows.append([key_value(collection, k), k, kind, self._call(self._r.ttl, k), self._value(k, kind)])
        return QueryResult(columns=["$key", "key", "type", "ttl", "value"], rows=rows,
                           truncated=len(keys) > n, offset=offset)

    def query(self, text: str, limit: int | None = None) -> QueryResult:
        n = clamp_limit(limit)
        try:
            parts = shlex.split(text)
        except ValueError as e:
            raise BadQuery(str(e)) from e
        if not parts:
            raise BadQuery("empty command")
        cmd = parts[0].upper()
        if cmd not in READ_COMMANDS:
            raise WriteBlocked(f"{cmd} is not a read command")
        result = self._call(self._r.execute_command, cmd, *parts[1:])
        items = result if isinstance(result, list) else [result]
        return QueryResult(columns=["result"], rows=[[to_json_safe(v)] for v in items[:n]], truncated=len(items) > n)

    def close(self) -> None:
        self._r.close()
