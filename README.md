# DBeef

DBeef is an open-source desktop database visualizer. It shows graph, SQL and key-value stores side by side, along with how their data connects. The links between stores, and the names that matter in each project, come from a small `dbeef.yaml` per project. DBeef is read-only by default, and every adapter enforces that itself.

Status: phase 1 (the engine). The design is in [docs/superpowers/specs/2026-10-28-dbeef-design.md](docs/superpowers/specs/2026-10-28-dbeef-design.md).

## Layout

| Path | What it holds |
|---|---|
| `engine/` | Python engine: adapters (SQLite, Neo4j, Redis), config loading, the HTTP API, and a throwaway dev page |
| `app/` | Tauri + React desktop UI (not built yet) |
| `docs/` | Design spec and implementation plans |

## Run the engine

Requires Python 3.12 or newer.

```bash
cd engine
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python examples/make_sample.py
.venv/bin/python -m dbeef --config examples/dbeef.example.yaml --port 8765 --dev-token dev
```

Then open <http://127.0.0.1:8765/?token=dev>.

On startup the engine prints `{"port": ..., "token": ...}` as its first line. Every `/api/*` request must send that token in the `X-DBeef-Token` header. Without `--dev-token`, the token is random. The full API contract is served at `/openapi.json`.

## Tests

```bash
cd engine && .venv/bin/pytest
```

The Neo4j and Redis tests skip themselves when their store isn't reachable. To run them, start throwaway containers:

```bash
docker run --rm -d --name dbeef-neo4j-test -p 7687:7687 -e NEO4J_AUTH=neo4j/dbeef-test neo4j:5
```

```bash
docker run --rm -d --name dbeef-redis-test -p 6379:6379 redis:7
```

Override the defaults with `NEO4J_TEST_URI`, `NEO4J_TEST_PASSWORD` and `REDIS_TEST_URL`. The Redis tests use database 15 and only touch keys they create themselves.

## Project config

One `dbeef.yaml` per project. The format is in spec §4.2, and [engine/examples/dbeef.example.yaml](engine/examples/dbeef.example.yaml) is a working example.

- Secrets are referenced as `${ENV_VAR}`.
- Relative SQLite paths resolve against the config file's folder.
- Cross-store links name both ends as `{store, collection, field}`. Use `field: $key` for the variable part of a Redis key.
