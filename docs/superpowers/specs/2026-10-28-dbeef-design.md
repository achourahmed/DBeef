# DBeef: design

Date: 2026-10-28 · Status: draft for approval · Scope: whole product, with phase 1 (MVP) specified in detail

## 1. Intent

DBeef is an open-source desktop database visualizer. Two things set it apart:

- It looks better than the tools on the market.
- It shows graph, SQL and key-value stores side by side, with the links between them.

The owner builds it for their own projects first. Its first job is to **monitor all of VEDAS's data, well organized**. Later it should generalize to many databases.

Existing tools (DBeaver, Beekeeper Studio, DbGate, TablePlus) browse one database at a time. None of them show how items in different stores relate or where they came from. That is DBeef's core.

## 2. Goals, non-goals, anti-goals

**Goals (all decided by the owner)**
- See any data in any connected store, organized by project, then store, then collection, then item.
- Five views, delivered in phases (§7):
  1. **Schema map**: every table, label and key pattern as a box, with lines for references, including references across stores.
  2. **Item trace**: one item's origin, and every place it appears across stores.
  3. **Store lanes**: one column per store, with only the links that cross stores drawn.
  4. **DAG viewer**: a general DAG drawn from the graph store, customized per project through config. It shows node types by default and drills down to individual items (drill-down is a builder call).
  5. **Algorithms toolbox**: ready-to-use graph and DB algorithms, including node2vec.
- Read-only by default. Writes are blocked inside each adapter, not just hidden in the UI.
- General first. Anything VEDAS-specific lives in a project config file, never in code.

**Non-goals for now**
- Editing data, migrations, or admin tasks (users, backups).
- Cloud sync, accounts, telemetry.
- Breadth: Postgres, MySQL, Mongo and others come after VEDAS's stores work.

**Anti-goals (a failure even if everything else works)**
- DBeef writes to a database without the owner explicitly enabling writes.
- VEDAS-specific code in the engine or UI.
- Months of polish before the cross-store views exist.

## 3. Stack (approved by the owner)

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2. It launches the engine as a sidecar process. |
| UI | TypeScript, React, shadcn/ui. **Built in a separate chat.** |
| Box-and-line views | React Flow + elkjs layout (UI side) |
| Large graph view | Sigma.js + graphology, with ForceAtlas2 running in a Web Worker. Rust/WASM layout only if this proves too slow. |
| Engine | Python 3.12+, FastAPI, served on `127.0.0.1` |
| Adapters | `sqlite3`, official `neo4j` driver, `redis-py`, `duckdb` |
| Algorithms (phase 4) | networkx, pecanpy (node2vec), umap-learn |
| Config | YAML, validated with Pydantic |
| Tests | pytest |
| Dependencies | `requirements.txt` is the source of truth. The project presents as pip-based. |
| Packaging | PyInstaller bundles the engine for Tauri (phase 1 runs it from source) |

**Repo layout (builder's call, suggested):** `engine/` holds the Python package `dbeef`, `app/` holds the Tauri + React app (owned by the UI chat), and `docs/` holds this document.

## 4. Engine

### 4.1 Adapter interface

There is one adapter class per store type. Every adapter implements:

| Method | Returns |
|---|---|
| `list_collections()` | Collection names with kind (`table`, `label`, `rel_type`, `key_pattern`) and a count, or an estimate where an exact count is expensive |
| `describe(collection)` | Fields with types, plus **intra-store links**: SQLite declared foreign keys; Neo4j relationship types with their from and to labels |
| `sample(collection, limit)` | The first N items as JSON-safe rows |
| `query(text, limit)` | Results of a native query (SQL, Cypher, Redis command), after the adapter's read-only check |

**What a "collection" means per store**

| Store | Collection | Notes |
|---|---|---|
| SQLite | table or view | One connection per `.db` file |
| Neo4j | node label; relationship type | Properties sampled from up to N nodes (Neo4j has no fixed schema) |
| Redis | key pattern | Keys are grouped by prefix with variable segments collapsed (`rq:job:<id>` → `rq:job:*`). A bounded `SCAN` (≤10k keys) is enough. |
| DuckDB | table or view in a database file | VEDAS has no DuckDB file today, so the adapter is phase 5 |

**Read-only enforcement (required, and tested)**

| Store | Mechanism |
|---|---|
| SQLite | Open with the URI `file:...?mode=ro`, plus `PRAGMA query_only=ON` |
| Neo4j | Sessions use `default_access_mode=READ`. Before running a query, run `EXPLAIN <query>` and reject it unless the summary's `query_type` is `r`. |
| Redis | Allowlist of read commands (`GET`, `HGETALL`, `LRANGE`, `SCAN`, `TYPE`, `TTL`, `XRANGE`, …). Anything else is rejected before it is sent. |
| DuckDB | `duckdb.connect(path, read_only=True)` |

Limits: the default row `limit` is 100, the hard cap is 10,000, and every query has a timeout (the builder picks its value).

### 4.2 Project config (`dbeef.yaml`, one per project)

```yaml
project: vedas
stores:
  graph:   {type: neo4j,  uri: bolt://localhost:7687, user: neo4j, password: ${NEO4J_PASSWORD}}
  runs:    {type: sqlite, path: /data/runs/completed.db}
  roster:  {type: sqlite, path: /data/roster.db}
  jobs:    {type: redis,  url: redis://localhost:6379/0}
links:            # cross-store references, used by the schema map and store lanes in phase 1
  - from: {store: runs, collection: runs, field: inchikey}
    to:   {store: graph, collection: Molecule, field: inchikey}
  - from: {store: runs, collection: runs, field: hypothesis_id}
    to:   {store: graph, collection: Evidence, field: hypothesis_id}
  - from: {store: jobs, collection: "rq:job:*", field: $key}
    to:   {store: runs, collection: runs, field: run_id}
origins: {}       # phase 2: where each collection's data comes from
dag: {}           # phase 3: which labels to include, root, renames, groups
```

- Connections live in this file. Secrets go in env vars, referenced as `${VAR}`, so the file contains no passwords.
- Each end of a link is a mapping `{store, collection, field}`. Using a mapping instead of a dotted string means names that contain `:` or `.` never need splitting. Builder's call.
- `field: $key` means "the part of the key that the `*` in the pattern matches". It covers values that live in a Redis key name, such as `rq:job:<id>` → `<id>`. Builder's call.
- **Validation runs in two stages** (builder's call):
  1. At load time: YAML shape, store names and env vars. Any error here stops the load with a clear Pydantic message.
  2. At runtime, once a store connects: whether each collection and field exists. A missing one shows up as a `broken` link in the schema map and doesn't stop anything else. A store being down never blocks loading.
- **Suggested links:** when the same field name appears in two different stores (for example `inchikey`), the engine offers the link as `suggested`. The UI shows suggested links differently, and they become real once they're added to the YAML.

### 4.3 HTTP API (the contract with the UI chat)

Every response is JSON. **The engine owns this contract.** FastAPI publishes it at `/openapi.json`, and the UI chat generates its client from that file (builder's call, to be shared with the UI chat).

**Startup handshake** (builder's call):
- The command is `dbeef-engine --config <path> [--config <path> ...] [--port 0]`. The set of projects is fixed at startup by the `--config` paths. Adding projects from the UI comes later.
- The engine binds to `127.0.0.1` only, picks a free port, and generates a random token. Its **first stdout line** is the JSON `{"port": 51234, "token": "..."}`. Tauri reads that line and hands both values to the UI.
- Every request must carry an `X-DBeef-Token` header matching the token. A dev flag `--dev-token <value>` sets a known token for the dev page and the tests.
- CORS allows only the Tauri webview origins (`tauri://localhost`, `http://tauri.localhost`), plus the dev server origin given by `--allow-origin`.
- Error body for every 4xx/5xx: `{"error": {"code": "write_blocked" | "store_unavailable" | "not_found" | "bad_query" | "timeout", "message": "..."}}`.

| Method + path | Purpose |
|---|---|
| `GET /api/projects` | Loaded projects |
| `GET /api/projects/{p}/stores` | Stores with `type` and connection status (`ok` / `error` + message) |
| `GET /api/projects/{p}/stores/{s}/collections` | `list_collections()` |
| `GET /api/projects/{p}/stores/{s}/collections/{c}` | `describe()` |
| `GET /api/projects/{p}/stores/{s}/collections/{c}/rows?limit=` | `sample()` |
| `POST /api/projects/{p}/stores/{s}/query` `{text, limit}` | `query()`. A blocked write returns 403 with a reason. |
| `GET /api/projects/{p}/schema-map` | `{nodes: [collection + store + fields], edges: [{from, to, kind: intra \| cross \| suggested \| broken, label}]}`. The schema map and store lanes both render from this payload. |

The exact response shapes of the other endpoints are left to the builder. They're defined as Pydantic models, so `/openapi.json` stays the single source of truth.

One store being down must not break the others: its status is `error`, and the rest still load.

## 5. UI

The UI chat builds the real UI in `app/`, against §4.3. This chat delivers only a **throwaway dev page**: one static HTML file served by the engine at `/`. It lists stores and collections, shows rows, runs a query, and draws the schema map as plain boxes. It exists only to verify the engine end to end in a browser, and is not the product UI.

## 6. VEDAS facts (from code recon on 2026-10-24; schema as declared, live data not opened)

- **Neo4j:** labels `Molecule`, `Target`, `Disease`, `Evidence`, `MR_Analysis`, `Phenotype`. Relationship types `HAS_ACTIVITY`, `ASSOCIATED_WITH`, `SUPPORTED_BY`, `ESTIMATES`, `ON_OUTCOME`.
- **SQLite:** 9+ files, including `completed.db` (runs, run_facts, run_gates, hypothesis_stubs, copilot_*), `roster.db` (roster, catalog_*), `council.sqlite3`, `state.db`, `pubchem.db`, and `chembl_37.db` (the read-only source).
- **Redis:** only the RQ queue `vedas` (job hashes, meta: kind, progress).
- **DuckDB:** in memory only, over FAERS text files. Nothing is stored to browse.
- **Cross-store keys:** `inchikey` (the main one), RQ job id = `runs.run_id`, and `hypothesis_id` (links runs to Evidence and MR_Analysis).

## 7. Phases

| Phase | Contents |
|---|---|
| **1 · MVP** | Engine, SQLite + Neo4j + Redis adapters, config loading, the API in §4.3, schema map payload (intra + cross + suggested links), dev page, tests |
| 2 | Item trace (find a value across stores via the config links), origins in the config, broken-link check (for example a `runs.inchikey` value with no `:Molecule`) |
| 3 | DAG viewer: a general DAG from the graph store's types, customized via `dag:` in the config, with cycles detected and flagged |
| 4 | Algorithms: shortest path, neighborhood, centrality, communities, similarity, components, node2vec + UMAP; DB profiling, duplicates, freshness. Graph algorithms run on a subgraph DBeef has already read. |
| 5 | DuckDB adapter, more store types, live refresh for monitoring |

The phase order is **the builder's call, proposed to the owner and not yet confirmed**.

## 8. Phase 1 is done when

- The repo is on `develop`, and `pytest` passes.
- The adapter tests run on throwaway data: a temp SQLite file; a local Neo4j and Redis, each test **skipped cleanly** if its store isn't reachable.
- Every adapter has a test proving that a write is refused.
- The engine runs locally against a sample SQLite file, and the dev page has been checked in a browser: stores, collections, rows, a query, and the schema map.
- Commits follow Conventional Commits with subjects under 60 characters, and only verified behavior is committed. **No push without the owner's OK.**
- Repo hygiene: `.gitignore` covers `local-documents/`, `local-manuals/`, `uv.lock`, `.venv/`, `.python-version` and `.superpowers/`. No uv files are staged.

## 9. Left to the builder

- Internal module layout, naming, error types, and logging.
- Sample sizes, timeouts, and the exact Redis read allowlist.
- How Neo4j counts are estimated.
- The dev page's look (it's throwaway).
- Calls made during the design and marked as such:
  - phase order (§7)
  - monorepo layout (§3)
  - suggested links, the link format and `$key`, and two-stage validation (§4.2)
  - the engine owning the contract through OpenAPI, the startup handshake, the token, CORS, and the error body (§4.3)
  - DAG drill-down (§2)
