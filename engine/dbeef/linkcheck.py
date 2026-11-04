"""Does the data honour a configured cross-store link? (roadmap P1)"""

from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, ConfigDict, Field as PField

from .adapters.base import NotFound
from .config import StoreRef
from .project import Project

MAX_SAMPLE = 1000
_WORKERS = 8


class LinkInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)
    index: int
    from_: StoreRef = PField(alias="from")
    to: StoreRef


class LinkCheck(BaseModel):
    index: int
    sampled: int
    missing: int
    examples: list[str]


def list_links(project: Project) -> list[LinkInfo]:
    return [LinkInfo(index=i, from_=l.from_, to=l.to) for i, l in enumerate(project.config.links)]


def check_link(project: Project, index: int, sample: int = 200) -> LinkCheck:
    try:
        link = project.config.links[index]
    except IndexError:
        raise NotFound(f"no link #{index}") from None
    src, dst = link.from_, link.to
    head = project.adapter(src.store).rows(src.collection, min(max(sample, 1), MAX_SAMPLE))
    col = head.columns.index(src.field) if src.field in head.columns else None
    if col is None:
        raise NotFound(f"no field {src.store}.{src.collection}.{src.field}")
    values = sorted({str(r[col]) for r in head.rows if r[col] is not None})

    # shortcut: one lookup per value (≤ MAX_SAMPLE round trips); batch IN-queries when a store needs them.
    def exists(v: str) -> bool:
        return bool(project.adapter(dst.store).rows(dst.collection, 1, eq=(dst.field, v)).rows)

    with ThreadPoolExecutor(_WORKERS) as pool:
        found = list(pool.map(exists, values))
    missing = [v for v, ok in zip(values, found) if not ok]
    return LinkCheck(index=index, sampled=len(values), missing=len(missing), examples=missing[:10])
