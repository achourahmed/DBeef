"""A loaded project: its config plus lazily created, cached adapters."""

import threading
from typing import Literal

from pydantic import BaseModel

from .adapters import make_adapter
from .adapters.base import Adapter, NotFound, StoreUnavailable
from .config import ProjectConfig


class StoreStatus(BaseModel):
    name: str
    type: str
    status: Literal["ok", "error"]
    message: str | None = None


class Project:
    def __init__(self, config: ProjectConfig, adapter_factory=make_adapter):
        self.config = config
        self._factory = adapter_factory
        self._adapters: dict[str, Adapter] = {}
        self._lock = threading.Lock()

    def adapter(self, store: str) -> Adapter:
        if store not in self.config.stores:
            raise NotFound(f"no store {store!r} in project {self.config.project!r}")
        with self._lock:
            if store not in self._adapters:
                self._adapters[store] = self._factory(self.config.stores[store])
            a = self._adapters[store]
        # Ping every time so a store that comes back up recovers without a restart.
        a.ping()
        return a

    def statuses(self) -> list[StoreStatus]:
        out = []
        for name, cfg in self.config.stores.items():
            try:
                self.adapter(name)
                out.append(StoreStatus(name=name, type=cfg.type, status="ok"))
            except StoreUnavailable as e:
                out.append(StoreStatus(name=name, type=cfg.type, status="error", message=e.message))
        return out

    def close(self) -> None:
        with self._lock:
            for a in self._adapters.values():
                a.close()
            self._adapters.clear()
