"""Read-only SQLite adapter."""

import sqlite3
import threading
import time
from pathlib import Path

from .base import (QUERY_TIMEOUT_S, Adapter, BadQuery, Collection, Description, Field,
                   IntraLink, NotFound, QueryResult, QueryTimeout, StoreUnavailable,
                   WriteBlocked, clamp_limit, to_json_safe)

_ALLOWED_ACTIONS = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ,
                    sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}
_ALLOWED_PRAGMAS = {"table_info", "table_xinfo", "foreign_key_list", "index_list", "query_only"}


def _authorize(action, arg1, arg2, db_name, trigger):
    # Allowlist: anything that isn't a plain read is refused at prepare time,
    # which also stops ATTACH and VACUUM INTO from creating files.
    if action in _ALLOWED_ACTIONS:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_PRAGMA and arg1 in _ALLOWED_PRAGMAS:
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class SqliteAdapter(Adapter):
    def __init__(self, path: Path):
        self.path = Path(path)
        self._conn: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        self._deadline = 0.0

    def _connect(self) -> sqlite3.Connection:
        if self._conn is None:
            try:
                # mode=ro never creates a missing file.
                conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False)
                conn.execute("PRAGMA query_only=ON")
            except sqlite3.Error as e:
                raise StoreUnavailable(f"cannot open {self.path}: {e}") from e
            conn.set_authorizer(_authorize)
            conn.set_progress_handler(lambda: int(time.monotonic() > self._deadline), 10_000)
            self._conn = conn
        return self._conn

    def _run(self, sql: str, params: tuple = (), limit: int | None = None) -> QueryResult:
        limit = clamp_limit(limit)
        with self._lock:
            conn = self._connect()
            self._deadline = time.monotonic() + QUERY_TIMEOUT_S
            try:
                cur = conn.execute(sql, params)
                rows = cur.fetchmany(limit + 1)
            except sqlite3.Error as e:
                msg = str(e)
                if any(s in msg for s in ("not authorized", "authorization denied", "readonly")):
                    raise WriteBlocked(f"read-only store: {msg}") from e
                if "interrupted" in msg:
                    raise QueryTimeout(f"query exceeded {QUERY_TIMEOUT_S}s") from e
                raise BadQuery(msg) from e
        columns = [d[0] for d in cur.description or []]
        return QueryResult(columns=columns, rows=[[to_json_safe(v) for v in r] for r in rows[:limit]],
                           truncated=len(rows) > limit)

    def ping(self) -> None:
        self._run("SELECT 1")

    def list_collections(self) -> list[Collection]:
        objs = self._run("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') "
                         "AND name NOT LIKE 'sqlite_%' ORDER BY name", limit=10_000).rows
        return [Collection(name=name, kind=kind,
                           count=self._run(f"SELECT COUNT(*) FROM {_quote(name)}").rows[0][0])
                for name, kind in objs]

    def _known(self, name: str) -> Collection:
        for c in self.list_collections():
            if c.name == name:
                return c
        raise NotFound(f"no table or view {name!r}")

    def describe(self, name: str) -> Description:
        coll = self._known(name)
        cols = self._run(f"PRAGMA table_info({_quote(name)})").rows
        fks = self._run(f"PRAGMA foreign_key_list({_quote(name)})").rows
        # foreign_key_list columns: id, seq, table, from, to, on_update, on_delete, match
        links = [IntraLink(from_collection=name, from_field=fk[3], to_collection=fk[2],
                           to_field=fk[4], label=f"FK {fk[3]}") for fk in fks]
        return Description(collection=coll, fields=[Field(name=c[1], type=c[2] or "") for c in cols],
                           links=links)

    def sample(self, name: str, limit: int | None = None) -> QueryResult:
        self._known(name)
        n = clamp_limit(limit)
        return self._run(f"SELECT * FROM {_quote(name)} LIMIT ?", (n + 1,), limit=n)

    def query(self, text: str, limit: int | None = None) -> QueryResult:
        return self._run(text, limit=limit)

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
