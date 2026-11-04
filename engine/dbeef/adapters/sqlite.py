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
COUNT_BUDGET_S = 1.0  # a filtered COUNT(*) gets this long, else total stays unknown


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
    def __init__(self, path: Path, immutable: bool = False):
        self.path = Path(path)
        self.immutable = immutable
        self._conn: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        self._deadline = 0.0

    def _connect(self) -> sqlite3.Connection:
        if self._conn is None:
            try:
                # mode=ro never creates a missing file; as_uri() percent-encodes '#', '?' and '%'
                # so they can't end the path early and silently drop mode=ro.
                uri = f"{self.path.resolve().as_uri()}?mode=ro" + ("&immutable=1" if self.immutable else "")
                conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
                conn.execute("PRAGMA query_only=ON")
            except sqlite3.Error as e:
                raise StoreUnavailable(f"cannot open {self.path}: {e}") from e
            conn.set_authorizer(_authorize)
            conn.set_progress_handler(lambda: int(time.monotonic() > self._deadline), 10_000)
            self._conn = conn
        return self._conn

    def _run(self, sql: str, params: tuple = (), limit: int | None = None,
             deadline_s: float = QUERY_TIMEOUT_S) -> QueryResult:
        limit = clamp_limit(limit)
        with self._lock:
            conn = self._connect()
            self._deadline = time.monotonic() + deadline_s
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

    def _objects(self) -> list[list]:
        return self._run("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') "
                         "AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name", limit=10_000).rows

    def _count(self, name: str, kind: str) -> int | None:
        # MAX(rowid) is O(log n) where COUNT(*) scans: fine for an estimate on multi-GB files.
        # Views get no count, since counting one runs its whole query.
        if kind == "view":
            return None
        try:
            return self._run(f"SELECT COALESCE(MAX(rowid), 0) FROM {_quote(name)}").rows[0][0]
        except BadQuery:  # WITHOUT ROWID tables
            try:
                return self._run(f"SELECT COUNT(*) FROM {_quote(name)}").rows[0][0]
            except (BadQuery, QueryTimeout):
                return None

    def list_collections(self) -> list[Collection]:
        return [Collection(name=name, kind=kind, count=self._count(name, kind), count_is_estimate=kind == "table")
                for name, kind in self._objects()]

    def _known(self, name: str) -> Collection:
        for obj_name, kind in self._objects():
            if obj_name == name:
                return Collection(name=name, kind=kind, count=None)
        raise NotFound(f"no table or view {name!r}")

    def describe(self, name: str) -> Description:
        coll = self._known(name)
        cols = self._run(f"PRAGMA table_info({_quote(name)})").rows
        fks = self._run(f"PRAGMA foreign_key_list({_quote(name)})").rows
        # foreign_key_list columns: id, seq, table, from, to, on_update, on_delete, match
        links = [IntraLink(from_collection=name, from_field=fk[3], to_collection=fk[2],
                           to_field=fk[4], label=f"FK {fk[3]}") for fk in fks]
        # table_info columns: cid, name, type, notnull, dflt_value, pk
        return Description(collection=coll, links=links,
                           fields=[Field(name=c[1], type=c[2] or "", pk=bool(c[5]), nullable=not (c[3] or c[5]))
                                   for c in cols])

    def rows(self, collection, limit=None, offset=0, order_by=None, desc=False, eq=None, q=None) -> QueryResult:
        self._known(collection)
        n = clamp_limit(limit)
        cols = [c[1] for c in self._run(f"PRAGMA table_info({_quote(collection)})").rows]
        for name in (eq[0] if eq else None, order_by):
            if name is not None and name not in cols:
                raise BadQuery(f"no field {name!r} in {collection!r}")
        where, params = [], []
        if eq:
            # Column affinity makes '5' match an INTEGER 5, so one parameterised '=' is enough.
            where.append(f"{_quote(eq[0])} = ?")
            params.append(eq[1])
        if q is not None:
            esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            where.append("(" + " OR ".join(f"CAST({_quote(c)} AS TEXT) LIKE ? ESCAPE '\\'" for c in cols) + ")")
            params += [f"%{esc}%"] * len(cols)
        tail = f" WHERE {' AND '.join(where)}" if where else ""
        order = f" ORDER BY {_quote(order_by)}{' DESC' if desc else ''}" if order_by else ""
        r = self._run(f"SELECT * FROM {_quote(collection)}{tail}{order} LIMIT ? OFFSET ?",
                      (*params, n + 1, offset), limit=n)
        r.offset = offset
        if where:  # a filtered count is usually cheap; an unfiltered one scans the whole table
            try:
                r.total = self._run(f"SELECT COUNT(*) FROM {_quote(collection)}{tail}", tuple(params),
                                    deadline_s=COUNT_BUDGET_S).rows[0][0]
            except QueryTimeout:
                pass
        return r

    def query(self, text: str, limit: int | None = None) -> QueryResult:
        return self._run(text, limit=limit)

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
