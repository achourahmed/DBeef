"""Schema map: every collection as a node, with intra-store, cross-store, suggested and broken edges."""

from itertools import combinations
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field as PField

from .adapters.base import DBeefError, Field
from .project import Project, StoreStatus

SUGGEST_STOPLIST = {"id", "_id", "name", "type", "status", "value", "created_at", "updated_at", "key", "$key"}


class MapNode(BaseModel):
    id: str
    store: str
    store_type: str
    collection: str
    kind: str
    count: int | None
    fields: list[Field]


class MapEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)
    from_: str = PField(alias="from")
    to: str
    kind: Literal["intra", "cross", "suggested", "broken"]
    label: str
    from_field: str | None = None
    to_field: str | None = None


class SchemaMap(BaseModel):
    nodes: list[MapNode]
    edges: list[MapEdge]
    errors: list[StoreStatus]


def _node_id(store: str, collection: str) -> str:
    return f"{store}/{collection}"


def build_schema_map(project: Project) -> SchemaMap:
    nodes: dict[str, MapNode] = {}
    edges: list[MapEdge] = []
    errors: list[StoreStatus] = []

    for store, cfg in project.config.stores.items():
        try:
            adapter = project.adapter(store)
            collections = adapter.list_collections()
        except DBeefError as e:  # one failing store must not abort the whole map
            errors.append(StoreStatus(name=store, type=cfg.type, status="error", message=e.message))
            continue
        for coll in collections:
            if coll.kind == "rel_type":
                continue  # relationship types are drawn as edge labels
            try:
                d = adapter.describe(coll.name)
            except DBeefError:
                continue  # one bad collection must not hide the rest
            nid = _node_id(store, coll.name)
            nodes[nid] = MapNode(id=nid, store=store, store_type=cfg.type, collection=coll.name,
                                 kind=coll.kind, count=coll.count, fields=d.fields)
            edges += [MapEdge(from_=nid, to=_node_id(store, l.to_collection), kind="intra", label=l.label,
                              from_field=l.from_field, to_field=l.to_field) for l in d.links]

    down = {e.name for e in errors}
    linked: set[frozenset[str]] = set()
    for link in project.config.links:
        a, b = link.from_, link.to
        fid, tid = _node_id(a.store, a.collection), _node_id(b.store, b.collection)
        reason = None
        for end, nid in ((a, fid), (b, tid)):
            if end.store in down:
                reason = f"store unavailable: {end.store}"
            elif nid not in nodes:
                reason = f"no collection {end.store}.{end.collection}"
            elif not (end.field in {f.name for f in nodes[nid].fields}
                      or (end.field == "$key" and nodes[nid].kind == "key_pattern")):
                reason = f"no field {end.store}.{end.collection}.{end.field}"
            if reason:
                break
        edges.append(MapEdge(from_=fid, to=tid, kind="broken" if reason else "cross",
                             label=reason or f"{a.field} → {b.field}", from_field=a.field, to_field=b.field))
        linked.add(frozenset((fid, tid)))

    for n1, n2 in combinations(sorted(nodes), 2):
        x, y = nodes[n1], nodes[n2]
        if x.store == y.store or frozenset((n1, n2)) in linked:
            continue
        shared = ({f.name for f in x.fields} & {f.name for f in y.fields}) - SUGGEST_STOPLIST
        edges += [MapEdge(from_=n1, to=n2, kind="suggested", label=f, from_field=f, to_field=f)
                  for f in sorted(shared)]

    return SchemaMap(nodes=list(nodes.values()), edges=edges, errors=errors)
