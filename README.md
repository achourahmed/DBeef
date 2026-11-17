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

Then open <http://localhost:5173>. In the UI: the schema map (click a cross-store link to check it against the data), a Data tab with sortable columns, a substring filter, paging and CSV/JSON/Markdown export, a read-only Query tab with per-store history and saved queries, and a Trace tab that finds one value in every store. `⌘K` jumps anywhere, `⌘F` traces, `/` filters the sidebar, `?` lists the shortcuts. The palette icon in the header switches between the Warm and Graphite themes, light or dark, and compact rows.

The UI reads the engine URL and token from `?engine=` and `?token=`, then from `app/.env` (see `app/.env.example`), then defaults to `http://127.0.0.1:8765` and `dev`. After an API change, regenerate the types with `npm run gen:api` while the engine runs.

## Use it on data that lives on another machine

Run the engine where the data is and tunnel it here. Two scripts do this; both start the engine over SSH with a fresh token, forward port 8765, and print the local UI URL. Ctrl-C stops the engine and the tunnel.

When the stores run in Docker on that machine, run the engine as a container beside them. The script copies `engine/` and the config over, builds the image there, and starts it with the docker-run arguments in the file next to the config (`configs/vedas.docker` for `configs/vedas.yaml`): the stores' network, their volumes mounted read-only, and an env file for passwords.

```bash
scripts/remote-docker.sh my-server configs/vedas.yaml
```

Otherwise run the engine from a DBeef checkout on that machine (`engine/.venv` installed), as the user that owns the files. The config path is relative to `engine/`:

```bash
scripts/remote-engine.sh my-server --config ../configs/vedas.yaml
```

SQLite store options for live files:

- `timeout_s`: caps every query on the store. A reader blocks a rollback-journal commit for as long as its query runs, so set it below the busy timeout of the app writing the file.
- `immutable: true`: only for files nobody writes (reference databases of many gigabytes). SQLite then skips the WAL and lock files entirely. Never use it on a WAL file: it ignores what is still in the WAL and reads stale data.
- A WAL-mode file can be read from a read-only mount only while the writing app holds it open (its `-shm` file exists). When the file is closed, the store shows as unavailable.

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

An end-to-end smoke test (Playwright) runs against a running stack on the sample data: `cd app && npx playwright install chromium && npm run e2e`.

## Project config

One `dbeef.yaml` per project. The format is in spec §4.2, and [engine/examples/dbeef.example.yaml](engine/examples/dbeef.example.yaml) is a working example.

- Secrets are referenced as `${ENV_VAR}`.
- Relative SQLite paths resolve against the config file's folder.
- Cross-store links name both ends as `{store, collection, field}`. Use `field: $key` for the variable part of a Redis key.
- `origins:` maps an identifier name to the `{store, collection, field}` where it is first created; the trace view marks that store as the origin.
- Unknown keys are rejected at load time, so a typo such as `pasword:` cannot pass silently.
- `~` is expanded in SQLite paths.
