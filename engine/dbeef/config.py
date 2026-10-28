"""Load and validate a project's dbeef.yaml."""

import os
import re
from pathlib import Path
from typing import Annotated, Any, Literal, Union

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

_NAME = r"^[A-Za-z0-9_-]+$"
_ENV = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class ConfigError(Exception):
    pass


class StoreRef(BaseModel):
    store: str
    collection: str
    field: str


class LinkConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: StoreRef = Field(alias="from")
    to: StoreRef


class SqliteStore(BaseModel):
    type: Literal["sqlite"]
    path: Path


class Neo4jStore(BaseModel):
    type: Literal["neo4j"]
    uri: str
    user: str = "neo4j"
    password: str = ""
    database: str | None = None


class RedisStore(BaseModel):
    type: Literal["redis"]
    url: str


StoreConfig = Annotated[Union[SqliteStore, Neo4jStore, RedisStore], Field(discriminator="type")]


class ProjectConfig(BaseModel):
    project: str = Field(pattern=r"^[a-z0-9_-]+$")
    stores: dict[Annotated[str, Field(pattern=_NAME)], StoreConfig] = Field(min_length=1)
    links: list[LinkConfig] = []
    origins: dict = {}
    dag: dict = {}

    @model_validator(mode="after")
    def _links_name_known_stores(self):
        for i, link in enumerate(self.links):
            for end in (link.from_, link.to):
                if end.store not in self.stores:
                    raise ValueError(f"link #{i}: unknown store '{end.store}'")
        return self


def _expand(value: Any, path: Path) -> Any:
    # Expand after parsing so secrets containing ':' or '#' can't break the YAML.
    if isinstance(value, str):
        def sub(m: re.Match) -> str:
            if m.group(1) not in os.environ:
                raise ConfigError(f"{path}: env var {m.group(1)} is not set")
            return os.environ[m.group(1)]
        return _ENV.sub(sub, value)
    if isinstance(value, dict):
        return {k: _expand(v, path) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand(v, path) for v in value]
    return value


def load_config(path: Path) -> ProjectConfig:
    path = Path(path)
    try:
        raw = yaml.safe_load(path.read_text())
    except (OSError, yaml.YAMLError) as e:
        raise ConfigError(f"{path}: {e}") from e
    try:
        cfg = ProjectConfig.model_validate(_expand(raw, path))
    except ValidationError as e:
        raise ConfigError(f"{path}: {e}") from e
    for store in cfg.stores.values():
        if isinstance(store, SqliteStore) and not store.path.is_absolute():
            store.path = path.parent / store.path
    return cfg
