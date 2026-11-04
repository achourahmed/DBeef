"""Item trace: find one value at every configured endpoint (roadmap P1)."""

from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel

from .adapters.base import DBeefError, QueryResult, StoreUnavailable
from .config import StoreRef
from .project import Project, StoreStatus

_WORKERS = 8


class TraceHit(BaseModel):
    store: str
    collection: str
    field: str
    rows: QueryResult
    is_origin: bool


class TraceResult(BaseModel):
    value: str
    hits: list[TraceHit]
    errors: list[StoreStatus]


def endpoints(project: Project, field: str | None = None) -> list[StoreRef]:
    # Every {store, collection, field} the config names, in config order, each once.
    cfg = project.config
    seen: dict[tuple, StoreRef] = {}
    for ref in [e for l in cfg.links for e in (l.from_, l.to)] + list(cfg.origins.values()):
        if field is None or ref.field == field:
            seen.setdefault((ref.store, ref.collection, ref.field), ref)
    order = {name: i for i, name in enumerate(cfg.stores)}
    return sorted(seen.values(), key=lambda r: (order[r.store], r.collection, r.field))


def trace(project: Project, value: str, field: str | None = None, limit: int | None = None) -> TraceResult:
    origins = {(r.store, r.collection, r.field) for r in project.config.origins.values()}
    down: dict[str, StoreStatus] = {}

    def look(ref: StoreRef):
        try:
            return project.adapter(ref.store).rows(ref.collection, limit, eq=(ref.field, value))
        except StoreUnavailable as e:
            down.setdefault(ref.store, StoreStatus(name=ref.store, type=project.config.stores[ref.store].type,
                                                   status="error", message=e.message))
        except DBeefError:  # a collection or field the data lacks: nothing to show here
            return None

    refs = endpoints(project, field)
    with ThreadPoolExecutor(_WORKERS) as pool:
        results = list(pool.map(look, refs))
    hits = [TraceHit(store=r.store, collection=r.collection, field=r.field, rows=res,
                     is_origin=(r.store, r.collection, r.field) in origins)
            for r, res in zip(refs, results) if res is not None and res.rows]
    return TraceResult(value=value, hits=hits, errors=list(down.values()))
