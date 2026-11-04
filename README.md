# DBeef

DBeef is an open-source desktop database visualizer. It shows graph, SQL and key-value stores side by side, along with how their data connects: a schema map across stores, a trace that finds one value (an identifier, a job id) in every store at once, and a check that tells you whether a configured link actually holds in the data. The links between stores, and the names that matter in each project, come from a small `dbeef.yaml` per project. DBeef is read-only by default, and every adapter enforces that itself.

Status: phase 1 (the engine). The design is in [docs/superpowers/specs/2026-10-28-dbeef-design.md](docs/superpowers/specs/2026-10-28-dbeef-design.md).

## Layout

| Path | What it holds |
|---|---|
| `engine/` | Python engine: adapters (SQLite, Neo4j, Redis), config loading, the HTTP API, and a throwaway dev page |
| `app/` | React + shadcn/ui UI, run in the browser for now (the Tauri shell comes later) |
| `docs/` | Design spec and implementation plans |

## Run with Docker

The quickest way to try DBeef: one command starts the engine on the sample data and the UI with live reload.

```bash
docker compose up -d --build
```

Then open <http://localhost:5173>. Edits under `app/src` reload the page straight away; after an engine change, run the same command again. Both ports listen on 127.0.0.1 only. Stop everything with `docker compose down`.

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

## Run the UI

Requires Node 20 or newer. Start the engine first, allowing the dev server's origin:

```bash
cd engine && .venv/bin/python -m dbeef --config examples/dbeef.example.yaml --port 8765 --dev-token dev --allow-origin http://localhost:5173
```

```bash
cd app && npm install && npm run dev -- --port 5173 --strictPort
```

Then open <http://localhost:5173>. In the UI: the schema map (click a cross-store link to check it against the data), a Data tab with sortable columns, a substring filter, paging and CSV/JSON/Markdown export, a read-only Query tab with per-store history and saved queries, and a Trace tab that finds one value in every store. `⌘K` jumps anywhere, `⌘F` traces, `/` filters the sidebar, `?` lists the shortcuts.

The UI reads the engine URL and token from `?engine=` and `?token=`, then from `app/.env` (see `app/.env.example`), then defaults to `http://127.0.0.1:8765` and `dev`. After an API change, regenerate the types with `npm run gen:api` while the engine runs.

## Use it on data that lives on another machine

Run the engine where the data is, as the user that owns the files, and tunnel it here. SQLite databases in WAL mode need to create a `-shm` file next to them even when opened read-only, so a read-only user (or the Docker image, which runs as `nobody`) cannot open them.

```bash
scripts/remote-engine.sh my-server --config configs/vedas.yaml
```

The script starts the engine over SSH with a fresh token, forwards port 8765, and prints the local UI URL. For files nobody ever writes (reference databases of many gigabytes), set `immutable: true` on the store: SQLite then skips the WAL and lock files entirely.

Real project configs live in `configs/`; [configs/vedas.yaml](configs/vedas.yaml) is the first one.

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
- `origins:` maps an identifier name to the `{store, collection, field}` where it is first created; the trace view marks that store as the origin.
- Unknown keys are rejected at load time, so a typo such as `pasword:` cannot pass silently.
- `~` is expanded in SQLite paths.
