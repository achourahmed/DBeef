from ..config import Neo4jStore, RedisStore, SqliteStore, StoreConfig
from .base import Adapter


def make_adapter(store: StoreConfig) -> Adapter:
    # Imported here so a missing optional driver only breaks its own store type.
    if isinstance(store, SqliteStore):
        from .sqlite import SqliteAdapter
        return SqliteAdapter(store.path)
    if isinstance(store, Neo4jStore):
        from .neo4j import Neo4jAdapter
        return Neo4jAdapter(store.uri, store.user, store.password, store.database)
    if isinstance(store, RedisStore):
        from .redis import RedisAdapter
        return RedisAdapter(store.url)
    raise ValueError(f"unknown store type {store.type!r}")
