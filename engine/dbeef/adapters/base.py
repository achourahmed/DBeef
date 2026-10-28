"""Shared types every store adapter implements and returns."""

import math
from abc import ABC, abstractmethod
from typing import Any, Literal

from pydantic import BaseModel

DEFAULT_LIMIT = 100
MAX_LIMIT = 10_000
QUERY_TIMEOUT_S = 10
_MAX_TEXT = 1000


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(limit, MAX_LIMIT))


def to_json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            return f"<binary {len(raw)} bytes>"
        return text if len(text) <= _MAX_TEXT else f"<binary {len(raw)} bytes>"
    if isinstance(value, dict):
        return {str(to_json_safe(k)): to_json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json_safe(v) for v in value]
    return str(value)


class DBeefError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class WriteBlocked(DBeefError):
    def __init__(self, message: str):
        super().__init__("write_blocked", message)


class StoreUnavailable(DBeefError):
    def __init__(self, message: str):
        super().__init__("store_unavailable", message)


class NotFound(DBeefError):
    def __init__(self, message: str):
        super().__init__("not_found", message)


class BadQuery(DBeefError):
    def __init__(self, message: str):
        super().__init__("bad_query", message)


class QueryTimeout(DBeefError):
    def __init__(self, message: str):
        super().__init__("timeout", message)


class Field(BaseModel):
    name: str
    type: str


class Collection(BaseModel):
    name: str
    kind: Literal["table", "view", "label", "rel_type", "key_pattern"]
    count: int | None
    count_is_estimate: bool = False


class IntraLink(BaseModel):
    from_collection: str
    from_field: str | None
    to_collection: str
    to_field: str | None
    label: str


class Description(BaseModel):
    collection: Collection
    fields: list[Field]
    links: list[IntraLink]


class QueryResult(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool


class Adapter(ABC):
    @abstractmethod
    def ping(self) -> None: ...

    @abstractmethod
    def list_collections(self) -> list[Collection]: ...

    @abstractmethod
    def describe(self, name: str) -> Description: ...

    @abstractmethod
    def sample(self, name: str, limit: int | None = None) -> QueryResult: ...

    @abstractmethod
    def query(self, text: str, limit: int | None = None) -> QueryResult: ...

    @abstractmethod
    def close(self) -> None: ...
