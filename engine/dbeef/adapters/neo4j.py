"""Read-only Neo4j adapter."""

import re
from typing import Any

import neo4j
from neo4j.exceptions import AuthError, ClientError, DriverError, Neo4jError, ServiceUnavailable
from neo4j.graph import Node, Path, Relationship

from .base import (QUERY_TIMEOUT_S, Adapter, BadQuery, Collection, Description, Field,
                   IntraLink, NotFound, QueryResult, QueryTimeout, StoreUnavailable,
                   WriteBlocked, clamp_limit, to_json_safe)

_DESCRIBE_SAMPLE = 100
# Neo4j reports these as plain reads ('r'), but they change server state:
# TERMINATE kills other sessions' transactions, the procedures touch stats and indexes.
_SIDE_EFFECTS = re.compile(r"\bTERMINATE\s+TRANSACTIONS?\b|\bdb\.(stats\.|resample|clearQueryCaches)"
                           r"|\bdbms\.(kill|clearQueryCaches)", re.IGNORECASE)


def _quote(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def _flat(v: Any) -> Any:
    if isinstance(v, Node):
        return {"_id": v.element_id, "_labels": sorted(v.labels), **dict(v)}
    if isinstance(v, Relationship):
        return {"_id": v.element_id, "_type": v.type, **dict(v)}
    if isinstance(v, Path):
        out: list = [_flat(v.start_node)]
        for rel in v.relationships:
            out += [_flat(rel), _flat(rel.end_node)]
        return out
    if isinstance(v, list):
        return [_flat(x) for x in v]
    if isinstance(v, dict):
        return {k: _flat(x) for k, x in v.items()}
    return v


class Neo4jAdapter(Adapter):
    def __init__(self, uri: str, user: str, password: str, database: str | None = None):
        self.database = database
        self._driver = neo4j.GraphDatabase.driver(uri, auth=(user, password),
                                                  connection_timeout=QUERY_TIMEOUT_S)

    def _session(self):
        return self._driver.session(database=self.database, default_access_mode=neo4j.READ_ACCESS)

    def _read(self, cypher: str, params: dict | None = None, limit: int = 10_000) -> tuple[list[str], list]:
        @neo4j.unit_of_work(timeout=QUERY_TIMEOUT_S)
        def work(tx):
            result = tx.run(cypher, params or {})
            records = []
            for rec in result:
                records.append(rec)
                if len(records) > limit:
                    break
            return list(result.keys()), records

        try:
            with self._session() as s:
                return s.execute_read(work)
        except (ServiceUnavailable, AuthError) as e:
            raise StoreUnavailable(str(e)) from e
        except ClientError as e:
            code = e.code or ""
            if "AccessMode" in code or "ForbiddenOnReadOnly" in code:
                raise WriteBlocked(f"read-only store: {e.message}") from e
            if "TimedOut" in code:
                raise QueryTimeout(f"query exceeded {QUERY_TIMEOUT_S}s") from e
            raise BadQuery(e.message or str(e)) from e
        except (Neo4jError, DriverError) as e:
            raise BadQuery(str(e)) from e

    def ping(self) -> None:
        try:
            self._driver.verify_connectivity()
        except Exception as e:  # driver raises several unrelated types on connect failure
            raise StoreUnavailable(f"neo4j unreachable: {e}") from e

    def list_collections(self) -> list[Collection]:
        _, labels = self._read("CALL db.labels() YIELD label RETURN label ORDER BY label")
        _, types = self._read("CALL db.relationshipTypes() YIELD relationshipType AS t RETURN t ORDER BY t")
        out = [Collection(name=r[0], kind="label",
                          count=self._read(f"MATCH (n:{_quote(r[0])}) RETURN count(n)")[1][0][0])
               for r in labels]
        out += [Collection(name=r[0], kind="rel_type",
                           count=self._read(f"MATCH ()-[r:{_quote(r[0])}]->() RETURN count(r)")[1][0][0])
                for r in types]
        return out

    def _known(self, name: str) -> Collection:
        _, labels = self._read("CALL db.labels() YIELD label RETURN label")
        if any(r[0] == name for r in labels):
            return Collection(name=name, kind="label", count=None)
        _, types = self._read("CALL db.relationshipTypes() YIELD relationshipType AS t RETURN t")
        if any(r[0] == name for r in types):
            return Collection(name=name, kind="rel_type", count=None)
        raise NotFound(f"no label or relationship type {name!r}")

    def _items(self, coll: Collection, limit: int) -> list:
        q = _quote(coll.name)
        cypher = (f"MATCH (n:{q}) RETURN n LIMIT $lim" if coll.kind == "label"
                  else f"MATCH ()-[n:{q}]->() RETURN n LIMIT $lim")
        return [r[0] for r in self._read(cypher, {"lim": limit}, limit=limit)[1]]

    def describe(self, name: str) -> Description:
        coll = self._known(name)
        types: dict[str, str] = {}
        for item in self._items(coll, _DESCRIBE_SAMPLE):
            for k, v in dict(item).items():
                if v is not None and k not in types:
                    types[k] = type(v).__name__
        links = []
        if coll.kind == "label":
            _, rows = self._read(f"MATCH (a:{_quote(name)})-[r]->(b) WITH type(r) AS t, labels(b) AS ls "
                                 "LIMIT 1000 RETURN DISTINCT t, ls")
            links = [IntraLink(from_collection=name, from_field=None, to_collection=ls[0],
                               to_field=None, label=t) for t, ls in rows if ls]
        return Description(collection=coll, fields=[Field(name=k, type=t) for k, t in sorted(types.items())],
                           links=links)

    def sample(self, name: str, limit: int | None = None) -> QueryResult:
        coll = self._known(name)
        n = clamp_limit(limit)
        items = self._items(coll, n + 1)
        keys = sorted({k for item in items for k in dict(item)})
        extra = ["_from", "_to"] if coll.kind == "rel_type" else []
        rows = []
        for item in items[:n]:
            ends = [item.start_node.element_id, item.end_node.element_id] if extra else []
            rows.append([item.element_id, *ends, *(to_json_safe(dict(item).get(k)) for k in keys)])
        return QueryResult(columns=["_id", *extra, *keys], rows=rows, truncated=len(items) > n)

    def query(self, text: str, limit: int | None = None) -> QueryResult:
        n = clamp_limit(limit)
        if _SIDE_EFFECTS.search(text):
            raise WriteBlocked("read-only store: statement changes server state")
        try:
            with self._session() as s:
                qt = s.run("EXPLAIN " + text).consume().query_type
        except (ServiceUnavailable, AuthError) as e:
            raise StoreUnavailable(str(e)) from e
        except Neo4jError as e:
            raise BadQuery(e.message or str(e)) from e
        if qt != "r":
            raise WriteBlocked(f"read-only store: query type {qt}")
        keys, records = self._read(text, limit=n)
        rows = [[to_json_safe(_flat(v)) for v in rec.values()] for rec in records[:n]]
        return QueryResult(columns=keys, rows=rows, truncated=len(records) > n)

    def close(self) -> None:
        self._driver.close()
