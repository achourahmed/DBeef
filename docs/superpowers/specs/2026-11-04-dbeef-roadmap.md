# DBeef roadmap: from foundation to the full tool

## Context

Phase 1 of DBeef (engine + first web UI + Docker dev stack) is on `origin/develop`. Measured against the brainstorm (schema map, item trace, store lanes, DAG viewer, algorithm toolbox, read-only, "better than DBeaver" usability and looks, desktop app), most of the product is still ahead. The owner asked for a plan covering every remaining gap, every phase detailed, with this priority: prove it on the real VEDAS data first, then item trace, then usability and looks, then the rest. Scope additions confirmed by the owner: Postgres adapter, DuckDB adapter, saved queries + history, live refresh.

Facts that shape the plan:
- The real VEDAS data lives on **another machine**, reached over **SSH**. On this Mac `data/chembl/chembl_37.db` and `data/roster.db` are empty directories (Docker mount leftovers); only the `vedas_neo4j_data` volume is local.
- VEDAS writes `completed.db` and `state.db` while DBeef would read them (SQLite WAL mode is likely), ChEMBL 37 is a ~29 GB read-only file, Neo4j holds a few thousand elements, Redis has one RQ queue. Full recon at the end of this file.
- Standing rules: TDD per task (test fails first), Conventional Commits < 60 chars, behaviour commits only after end-to-end verification, no push without an explicit OK, no VEDAS-specific code in `engine/` or `app/` (VEDAS lives in config only), read-only enforced by the database itself wherever it can be, fixed error body, pip-only presentation, smallest complete change per task.
- Building blocks to reuse: `Adapter` ABC + `DBeefError` codes (`engine/dbeef/adapters/base.py`), `Project.adapter()` (`engine/dbeef/project.py`), `build_schema_map` (`engine/dbeef/schema_map.py`), `create_app` route style + `ErrorBody` (`engine/dbeef/api.py`), typed client + `useLoad` (`app/src/api/client.ts`, `useLoad.ts`), `ResultTable`, `ErrorNote`, `SchemaMapView` (ELK layout), shadcn components, `compose.yaml`, `npm run gen:api`.

How this plan is used: it is the roadmap plus a concrete task list per phase (contracts, files, tests, done criteria). When a phase starts, its section is the brief for a `superpowers:writing-plans` TDD plan plus a short spec addendum in `docs/superpowers/specs/`. A fresh reviewer read this plan once; its findings are folded in below (notably: SQLite WAL on a read-only image, Postgres read-only must be a database role, no SSE, one row-fetching method instead of two, UI tests before UI features).

Phase order (my call; the owner can reorder): **P0 real data → P1 item trace → P2 usability → P3 design → P4 map at scale → P5 desktop app → P6 DAG viewer → P7 algorithms → P8 Postgres + DuckDB → P9 live refresh → P10 hardening.** Desktop sits after the UI is representative and before the engine-heavy phases; those later contract changes mean a sidecar rebuild, which the dev-mode switch (P5) makes cheap.

Sizes: S = one session, M = two or three, L = four or more.

---

## P0: Real VEDAS data over SSH (M)

**Goal:** DBeef shows every VEDAS store from the remote machine, fast enough to use, with no VEDAS code in the repo.

**How it runs:** the engine runs on the remote machine **from source, as the user that owns the data files** (not the Docker image: it runs as `nobody`, and a WAL-mode SQLite file opened read-only still needs to create the `-shm` file next to it, so `nobody` gets `unable to open database file`). It binds 127.0.0.1 there; `ssh -L 8765:127.0.0.1:8765` brings it here; the UI runs locally (compose `app` service or `npm run dev`) with `?engine=http://localhost:8765&token=…`.

Tasks (each TDD, each its own commit unless noted):
1. `configs/vedas.yaml`: the draft in "VEDAS facts" below (stores, links). `configs/` is the home for real project configs; VEDAS names are allowed there because it is config.
2. `scripts/remote-engine.sh HOST [CONFIG...]`: wraps the ssh tunnel + `python -m dbeef --config … --port 8765 --allow-origin http://localhost:5173` on HOST, prints the token and the local URL. Bash only; no engine change. (Docs commit.)
3. Config: `immutable: true` per SQLite store → appends `&immutable=1` to the URI (SQLite then never touches `-wal`/`-shm`; only for files nobody writes, such as `chembl_37.db`). Test: `test_immutable_uri`.
4. Config: `Path.expanduser()` on SQLite paths, applied **before** the relative-path join in `load_config` (`engine/dbeef/config.py:93-95`). Test: `test_sqlite_path_expands_user`.
5. Config: `model_config = ConfigDict(extra="forbid")` on every config model so `pasword:` fails at load. Test: `test_unknown_key_is_config_error`.
6. SQLite: `NOT LIKE 'sqlite\_%' ESCAPE '\'` in `_objects` so `sqlite3_runs` shows. Test: `test_user_table_named_like_internal_is_listed`.
7. Text cap in `to_json_safe` (`base.py:21`): one `isinstance(value, str)` branch cutting at 1,000 chars with `… (+N chars)`; SQLite and Neo4j inherit it, Redis `_text` collapses into it. Test: `test_long_text_is_cut`.
8. Redis: `_known` (`redis.py:88`) currently runs a full `SCAN` on every `describe`/`sample`; replace with an existence probe: `_scan(_glob(pattern), cap=1)` then `key_pattern` re-check. Test: `test_known_does_not_scan_everything` (fake client counting SCAN calls).
9. Scale measurement (not a feature): `engine/scripts/bench.py` builds a 5M-row SQLite file in tmp and times `list_collections`, `describe`, `sample`, a `LIKE` query; numbers go in the commit message. Only if `list_collections` > 2 s: cache counts per adapter for 30 s.
10. CI: `.github/workflows/ci.yml`: pytest on a Python **3.12 and 3.14** matrix; `npm ci && npm run build && npm run lint`; a job that starts the engine on the sample config, runs `npm run gen:api` and fails on `git diff --exit-code app/src/api/schema.d.ts` (so no later contract change ships stale types).
11. README: "Use it on a remote machine" (tunnel recipe, WAL note, `immutable`), `configs/`.

Done when: over the tunnel the sidebar lists all VEDAS stores green; `chembl` collections load in < 2 s; the schema map renders; `DELETE` against `completed` → `write_blocked`; CI green on both Pythons.

Risks: the remote machine's Python version (needs 3.12+; a venv there); ChEMBL tables `WITHOUT ROWID` or views (handled: COUNT fallback / no count).

---

## P1: Item trace, origins, broken-link check (M–L)

**Goal:** type one value (an InChIKey, a run id, a hypothesis id) and see every place it exists across all stores, which store is its origin, and whether a configured link is actually satisfied by the data. This is the feature no other tool has, and it is also the "store lanes" view.

### UI test harness first
1. Vitest + React Testing Library, `vi.mock('@/api/client')` for engine calls (no MSW), `npm test` added to CI. Every UI task from here on ships with at least one test.

### Engine
2. **One row-fetching method, not two.** Replace `Adapter.sample(name, limit)` with
   `rows(self, collection: str, limit: int | None = None, offset: int = 0, order_by: str | None = None, desc: bool = False, eq: tuple[str, str] | None = None, q: str | None = None) -> QueryResult`
   P1 implements `limit`, `offset`, `eq` (exact match on one field) in all three adapters; `order_by`/`desc`/`q` arrive in P2 (`bad_query` until then). `QueryResult` gains `offset: int = 0` and `total: int | None = None` **with defaults** so `query()` and the 55 existing tests keep working.
   - SQLite: `WHERE "f" = ?` (parameterised); if 0 rows and the declared type isn't TEXT, retry with `CAST("f" AS TEXT) = ?`.
   - Neo4j: `MATCH (n:L) WHERE n[$f] = $v RETURN n SKIP $off LIMIT $lim`; rel-type collections match on relationship properties.
   - Redis: `eq=("$key", v)` → the key with `*` replaced by `v`, one row if it exists; `eq=(hash_field, v)` → bounded `SCAN` of the pattern (cap `SCAN_CAP`) filtered by `HGET`.
   - Tests per adapter: found / not found / quotes in the value (injection-safe) / unknown field → `bad_query` / paging past the end.
3. Contract clean-up while nothing reads it: Neo4j `_id` → `_element_id` (and `_from`/`_to` → `_from_id`/`_to_id`) in `sample`/`_flat`, so a property named `_id` can't overwrite it; regenerate `schema.d.ts`.
4. Config: `origins: dict[str, StoreRef]` (key = identifier name, value = where it is first created), validated like links (store at load time, collection/field lazily).
5. `engine/dbeef/trace.py`: `trace(project, value, field: str | None, limit) -> TraceResult`. Candidate endpoints = every `{store, collection, field}` from `links` and `origins` (when `field` is given, only those with that field; describe-based discovery of other collections is **not** in the first cut). Run `rows(eq=…)` on each with a thread pool (8 workers); per-store errors captured, not raised. `TraceResult(value, hits: list[TraceHit], errors: list[StoreStatus])`, `TraceHit(store, collection, field, rows: QueryResult, is_origin: bool)`. Composite-keyed Neo4j labels (Evidence, MR_Analysis) return many rows per value: the lane shows `limit` and `truncated`.
6. `engine/dbeef/linkcheck.py`: `check_link(project, index, sample=200) -> LinkCheck(link, sampled, missing, examples: list[str])`: sample distinct values at the `from` end, batch-test at the `to` end (SQLite `IN (...)`, Neo4j `WHERE n[$f] IN $vals`, Redis per-key existence). Cap 1,000; `QUERY_TIMEOUT_S` per link.
7. Routes: `POST /api/projects/{p}/trace` body `{value, field?, limit?}` → `TraceResult`; `GET /api/projects/{p}/links` → links with index and kind; `GET /api/projects/{p}/links/{i}/check?sample=200` → `LinkCheck`. `rows` route gains `offset` and `eq_field`/`eq_value` query params. `npm run gen:api`.
8. Tests: `test_trace.py` (InChIKey hits in two SQLite stores; origin flagged; one store down → in `errors`), `test_linkcheck.py`, API tests incl. error bodies.

### UI
9. `TraceBar.tsx` in the header ("Trace a value…", `⌘F`), optional field chooser (names from `origins` + link fields), Enter → `api.trace`.
10. `TraceView.tsx` ("Trace" tab, auto-selected on search): **store lanes**, one column per store in config order; each lane lists hits (collection + rows via `ResultTable`); origin lane badged; stores in `errors` show `ErrorNote`; empty lanes say "not found". Clicking a hit opens the Data tab with `eq` applied (the `rows` route supports it from this phase).
11. Schema map: cross/broken edges get "Check this link" → popover with `missing / sampled` + examples; red badge when `missing > 0`.
12. Table cells get a hover action "Trace this value" → fills `TraceBar`.

Done when: over the VEDAS tunnel, tracing an InChIKey shows lanes for `completed`, `roster`, `chembl`, `graph` with the origin flagged; a run id hits `completed.runs` and `rq:job:*`; the check on `runs.inchikey → Molecule.inchikey` returns a count; engine and Vitest suites green; browser-checked on compose and on the tunnel.

---

## P2: Usability core (M)

**Goal:** the table and query experience people expect: find, sort, page, keyboard-drive, keep history, export.

### Engine
1. `rows(... order_by, desc, q)` implemented:
   - SQLite: `ORDER BY "col" [DESC] LIMIT ? OFFSET ?`; `q` → `WHERE (CAST(c1 AS TEXT) LIKE ? ESCAPE '\' OR …)` over all columns.
   - Neo4j: `ORDER BY n[$col] SKIP LIMIT`; `q` restricted to string properties: `WHERE any(k IN keys(n) WHERE n[k] IS :: STRING AND n[k] CONTAINS $q)` (a bare `toString()` raises on lists/maps).
   - Redis: `order_by` ∈ {`key`, `ttl`}; `offset` slices the capped key list; `q` filters keys by substring.
   - `total`: SQLite `COUNT(*)` over the filtered query only when `q`/`eq` is set and it finishes within 1 s; needs a per-call `deadline` parameter on `_run` (`sqlite.py:53` hard-codes `QUERY_TIMEOUT_S`). Else `null`.
   - Tests: ordering, unknown `order_by` → `bad_query`, `q` escaping of `%`/`_`, `total` null on timeout (tiny deadline).
2. `describe`: `Field.pk: bool = False`, `Field.nullable: bool | None = None` (SQLite `table_info`; others null).

### UI
3. `ResultTable`: sticky header; click header sorts (shift-click desc); pager footer (`‹ ›`, page size 50/100/500, "rows N–M of total" when known). No row virtualisation (page size ≤ 500), no column resize.
4. Filter box above the table (`q`), debounced 300 ms; chips for active sort/filter/eq; "clear".
5. Sidebar filter input (client-side substring over stores/collections), `/` focuses it.
6. Command palette `⌘K` (shadcn `Command`): jump to collection, switch tab, run a saved query, "Trace…", "Check link…".
7. Keyboard: `⌘1–4` tabs, `⌘Enter` run (exists), `⌘F` trace, `Esc` closes panels; "?" shortcut sheet.
8. Saved queries + history, local only: `app/src/lib/queryStore.ts` on `localStorage` keyed `dbeef:{project}:{store}`; history = last 50 (text, time, row count, error code); saved = name + text; panel beside the editor (shadcn `Sheet`) with save/rename/delete/import/export JSON.
9. Export: CSV / JSON / Markdown table of the current result, client-side `Blob`; the file notes the limit applied.

Done when: sorting/paging the 5M-row bench table stays under the timeout and the UI never freezes; history survives reload; CSV opens in Numbers; `⌘K` reaches any VEDAS collection in two keystrokes; Vitest green in CI.

---

## P3: Design pass (M)

**Goal:** stop looking like a default shadcn scaffold.

1. Mockups first (visual companion), owner approves before code.
2. Theme: brand tokens (coral `#F0444B`, cream `#FFF0D8`, burgundy `#650D25`, tile `#FFF9EE`) on shadcn CSS variables in `app/src/index.css`, light and dark; `SchemaMapView.EDGE_STYLE` strokes become literal `var(--edge-cross)` etc. (React Flow edge `style.stroke` takes a CSS string, not a Tailwind class).
3. Native `<select>`s → shadcn `Select`; sidebar on shadcn `Sidebar` (collapsible, keyboard tree); `Tooltip` on truncated names and `~` estimates.
4. Empty/loading states: skeletons; the "pick a collection" guide; engine-unreachable page with the start command.
5. Cell renderers: objects → collapsed inline tree with "open" into a right `Sheet`; long text → "open"; `<binary>` badge; numbers right-aligned; booleans as ticks.
6. Row inspector `Sheet`: field/value list, copy, "trace" per value.
7. Density toggle (compact/comfortable); monospace only for identifiers and code.
8. Bundle: `React.lazy` for `SchemaMapView` (and later DAG/algos); target < 500 kB initial JS.
9. One local Playwright smoke (`app/e2e/`: load project, open collection, run query, write blocked, trace) run by hand against compose; CI wiring is P10.

Done when: built screens match the approved mockups in light and dark; initial bundle < 500 kB; Playwright smoke passes locally.

---

## P4: Schema map at scale (S–M)

**Goal:** readable with 50–200 collections (VEDAS ≈ 9 SQLite files incl. ~80 ChEMBL tables, 6 labels, 5 rel types, key patterns).

1. Group by store: ELK compound nodes (`elk.hierarchyHandling: INCLUDE_CHILDREN`), React Flow `parentId` + `extent: 'parent'` with parent-relative positions, cross-store edges attached at root; store header with type, status dot, collapse/expand.
2. Toolbar: store toggles, edge-kind toggles, search that highlights and centres a node, fit, re-layout.
3. Node detail: full field list in a `HoverCard`; last link-check badge (P1).
4. Suggested links: "Promote" shows the YAML snippet to paste (copy button).
5. Engine: `schema-map?stores=a,b` partial maps; `SchemaMap.stores: list[StoreStatus]` (additive).
6. Later, not now: layout persistence, minimap, focus mode.

Done when: the VEDAS map opens grouped by store with ChEMBL collapsed; searching `inchikey` highlights every collection carrying it.

---

## P5: Desktop app with Tauri 2 (M)

**Goal:** `DBeef.app` on the Dock that starts its own engine; the browser stays a dev convenience.

1. `npm i -D @tauri-apps/cli && npx tauri init` inside `app/` (existing Vite app; `beforeDevCommand: npm run dev`, `devUrl: http://localhost:5173`, `frontendDist: ../dist`); identifier `dev.dbeef.app`; min size 1100×700; icons via `tauri icon dbeef-brand/app-icon.svg`; `src-tauri/target/` in `.gitignore`.
2. Engine sidecar: `bundle.externalBin: ["binaries/dbeef-engine"]`; in debug builds spawn `engine/.venv/bin/python -m dbeef` instead (`cfg(debug_assertions)`), always passing `--allow-origin http://localhost:5173` in dev (Vite origin). Rust reads the **first stdout line**, keeps `{port, token}` in managed state, exposes `get_engine()`; forwards stderr lines as events.
3. Orphan control: the engine exits when its stdin reaches EOF (a 10-line thread in `__main__.py`, TDD with a subprocess test); Tauri keeps stdin open, so a crash or quit of the app ends the engine. No Rust kill logic.
4. UI: `client.ts` gets an `engineReady: Promise<{url, token}>`; every `call` awaits it; in the browser it resolves immediately from `?engine=`/`.env`, in Tauri from `invoke('get_engine')`. Splash "starting engine…" until resolved; crash → error page with the stderr tail.
5. Projects: "Open project…" (`tauri-plugin-dialog`) adds a `dbeef.yaml` to the app config (`tauri-plugin-store`) and restarts the sidecar with all `--config` paths. Menu, settings window and recents are **not** in the first cut.
6. CSP: `connect-src http://127.0.0.1:* http://localhost:*`; verify Tauri 2 still injects its `ipc:` entries alongside a custom `connect-src` (10-minute check before starting).
7. Packaging: `engine/build-binary.sh` with PyInstaller (`--collect-submodules uvicorn`, name `dbeef-engine-aarch64-apple-darwin`; prefer `--onedir` over `--onefile` to avoid unpack time at every launch); `pyinstaller` in `requirements-dev.txt`; check PyInstaller supports the Python in use (3.14) before starting, else build the binary with 3.12. `npm run tauri build` → `.app` + `.dmg`, unsigned (document right-click-open); signing later.
8. Tests: Rust unit test for handshake parsing; Python test that the built binary prints the handshake; manual checklist: launch, open project, quit → `pgrep dbeef` empty.

Done when: double-click the `.app`, pick the sample config or `configs/vedas.yaml` (with the tunnel), see data; quitting leaves no engine process; the build runs on a second Mac without Python.

---

## P6: DAG viewer (S–M)

**Goal:** a general DAG from the graph store, customised per project through config, cycles flagged, per-stage counts. VEDAS's pipeline order lives only in `configs/vedas.yaml`.

1. Config `dag:` typed model (replaces `dict`): `source` (store), `nodes[]` `{id, store, collection, label?}`, `edges[]` `{from, to, label?}`, `hide[]`. Freshness (`order_by`) is **not** in the first cut (it needs a new adapter method; add `Adapter.max_value` later if wanted).
2. `engine/dbeef/dag.py`: `build_dag(project) -> Dag(nodes, edges, cycles)`: default extraction from `source` = labels as nodes with counts, rel types with observed label pairs as edges (reuse `Neo4jAdapter.describe().links`); config nodes/edges/hide override and extend; cycle detection by DFS.
3. Route `GET /api/projects/{p}/dag` → `Dag`, per-store errors as in the map.
4. UI `DagView.tsx` (lazy): ELK layered left→right; count per node; cycle edges dashed red with a banner; click → Data tab; node colour by store.
5. Tests: default extraction (seeded Neo4j, skip if absent), config merge, 3-node cycle, error body when the source store is down.

Done when: VEDAS's stages show in order with counts; an artificial cycle in a test graph is flagged.

---

## P7: Algorithm toolbox (L)

**Goal:** ready-to-use graph and database algorithms on a bounded subgraph or collection DBeef has already read; results are tables or a 2-D scatter; never writes.

0. **Pre-check before starting:** `numba`/`llvmlite` wheels for the Python in use (pecanpy and umap-learn depend on them; 3.14 is not assured). If missing, node2vec/UMAP run only under a 3.12 venv, or wait; everything else needs just networkx + numpy.
1. Dependencies in **`requirements-algos.txt`** (`networkx>=3`, `numpy`, then `pecanpy`, `umap-learn`), imported lazily; when absent the route answers `503 algo_unavailable` (new code, added to spec §4.3 and `_STATUS`).
2. Subgraph fetch `engine/dbeef/algos/subgraph.py`: `fetch_subgraph(adapter, labels, rel_types, max_nodes=5000, max_edges=50000) -> nx.Graph` via bounded Cypher; `edge_table(collection, from_col, to_col)` builds a graph from a relational table (covers `run_facts → runs`); `truncated` flag.
3. Registry `engine/dbeef/algos/registry.py`: `{name, title, params: JSON schema, scope: graph|collection, run(ctx, params) -> AlgoResult(columns, rows, points | None, truncated)}`.
   Graph: `shortest_path`, `neighborhood(hops ≤ 3)`, `degree`, `pagerank`, `betweenness` (sampled k > 2k nodes), `connected_components`, `louvain_communities`, `jaccard_similarity(node, top_k)`; **last:** `node2vec + umap` → `points`.
   Database: `profile` (null %, distinct, min/max, top 5 per field; one bounded query per field), `duplicates(field)`, `freshness(timestamp_field)`, `orphans(link_index)` (reuses P1 link check).
4. Execution: **synchronous**, 60 s cap, no job system (the graph is a few thousand elements). Routes: `GET /api/algos`, `POST /api/projects/{p}/stores/{s}/algos/{name}` body `params`.
5. UI `AlgosView.tsx` (lazy): picker grouped graph/database; param form from the JSON schema; result `ResultTable`; `points` → plain canvas scatter (≤ 5k points) coloured by label/community; "highlight in map".
6. Tests: each algorithm on a tiny seeded graph with known answers; registry schema validation; `algo_unavailable` when deps are missing (monkeypatched import).

Done when: on VEDAS, `pagerank` over `Molecule–HAS_ACTIVITY–Target` returns a ranked table; `profile` on `completed.runs` lists null % per column; node2vec draws a scatter if its deps install.

---

## P8: Postgres and DuckDB adapters (M)

**Goal:** the store outside users try first (Postgres) and the one VEDAS will grow into (DuckDB), with read-only enforced by the database.

1. Postgres `engine/dbeef/adapters/postgres.py` (`psycopg[binary]>=3`): **the required mechanism is a role with `SELECT` only** (`CONNECT` + `USAGE` + `SELECT`), documented and tested with such a role; layer two is `options='-c default_transaction_read_only=on'` and `statement_timeout`. The user's SQL could `SET default_transaction_read_only=off` or send `COMMIT; DROP …`, so the session flags alone never count as enforcement. Collections `schema.table` + views from `information_schema` (no `pg_catalog`); counts from `pg_class.reltuples` (estimate) with exact `COUNT(*)` only when `reltuples < 0`; `describe` from `information_schema.columns` + `pg_constraint` FKs; `rows/query` builders copied from SQLite (no shared `sqlbuild` module until a third SQL store needs it). Errors: `42501 insufficient_privilege` and `25006` → `write_blocked`, `57014` → `timeout`, `08xxx` → `store_unavailable`, else `bad_query`. Config `PostgresStore(type: postgres, dsn)`.
2. DuckDB `engine/dbeef/adapters/duckdb.py` (`duckdb>=1`; check wheels for the Python in use): `duckdb.connect(path, read_only=True)` is genuine DB-side enforcement; exact counts; `describe` via `PRAGMA table_info` + `duckdb_constraints()`; read-only error message → `write_blocked`. Parquet/CSV attach is later.
3. Tests: `test_postgres_adapter.py` skips unless `POSTGRES_TEST_DSN`; compose `postgres` service under a `test` profile seeded with a SELECT-only role; DuckDB tests on a tmp file. Both prove: `INSERT`, `CREATE`, `COPY … TO`, `SET … off; INSERT` refused; timeout; odd identifiers; counts.
4. UI: type icon + query placeholder per type; README store matrix.

Done when: a seeded Postgres shows FK intra-links and refuses `COPY … TO` and the `SET …; INSERT` trick; a DuckDB file made from the sample SQLite shows the same collections; P1/P2 features (eq, sort, page, q) work on both.

---

## P9: Live refresh and monitoring (S–M)

**Goal:** DBeef left open on a second screen while VEDAS runs: counts, queue depth and job states update by themselves.

1. Engine `GET /api/projects/{p}/stats?stores=a,b` → per store: collection counts (reusing `list_collections`), plus type specifics: Redis list/zset lengths **only for patterns already in the cached collection list** (`LLEN`/`ZCARD`, no extra SCAN); SQLite file `mtime`/size; Neo4j node/rel totals. Server cache TTL 2 s.
2. **Polling, not SSE:** the UI calls `/stats` with the normal header every N seconds (SSE would force `?token=` in URLs, a middleware exception, and Starlette's streaming-through-`BaseHTTPMiddleware` disconnect problem, for no gain at one or two clients).
3. UI: refresh control in the header (off / 5 s / 30 s); sidebar counts animate `+N` deltas; "Monitor" tab: queue-depth sparkline (last 10 min, in memory), per-store totals, newest `rq:job:*` rows by a user-chosen hash field (saved in `localStorage`); "auto-refresh this table" on Data views.
4. Tests: `/stats` shape; cache TTL honoured (fake adapter counts calls); Redis lengths only for known patterns.

Done when: with the tunnel and a sweep running, queue depth and `completed.runs` count move within 5 s without reloading.

---

## P10: Hardening (S, closes last)

1. Engine minors: SQLite error classification by `sqlite_errorcode` (`SQLITE_AUTH`, `SQLITE_READONLY`, `SQLITE_INTERRUPT`) instead of message text; drop `query_only` from `_ALLOWED_PRAGMAS`; Neo4j `Duration`/`Point`/`Date` as ISO strings in `_flat`; Redis `inf` scores consistent; `LRANGE`/`ZRANGE` bounds capped; `key_pattern` rules configurable per Redis store.
2. CI: compose stack + Playwright smoke job; `pip-audit` and `npm audit`; macOS runner for the PyInstaller handshake test.
3. Docs: engineering guide refreshed per phase (untracked); README store matrix and architecture diagram; `docs/CONTRIBUTING.md` (TDD rule, commit style, how to add an adapter).
4. Release: tag → GitHub Release building the Tauri `.dmg`; CHANGELOG from Conventional Commits.

---

## Verification (every phase)

- Engine: `cd engine && .venv/bin/pytest` green; each behaviour has a test that failed first; store tests against throwaway containers (`neo4j:5`, `redis:7`, later `postgres:16`).
- UI: `npm test` (from P1), `npm run build && npm run lint`; Playwright smoke locally from P3.
- Browser check in the pane for every UI change, light and dark; VEDAS check over the tunnel for P0, P1, P4, P6, P7, P9.
- Commit only verified behaviour; list unpushed commits and ask before any push; no uv files, no `local-documents/`.

## Ten-minute checks to run before the phase that needs them

| Before | Check |
|---|---|
| P5 | Tauri 2 keeps its `ipc:` CSP entries with a custom `connect-src`; PyInstaller supports the engine's Python |
| P7 | `numba`/`llvmlite` wheels for the engine's Python on arm64 |
| P8 | `duckdb` wheels for the engine's Python; psycopg3 multi-statement behaviour for unparametrised text |

## Open calls left to the owner (defaults in parentheses)

- Phase order: desktop (P5) before the engine-heavy phases (default) or last.
- P2 filtering: substring `q` + one `eq` (default) versus a structured `where` builder now.
- P7: run node2vec/UMAP under a 3.12 venv if 3.14 wheels are missing (default) or drop them until wheels exist.
- P8: Postgres and DuckDB together (default) or Postgres first.

## VEDAS facts (read-only recon of `~/dojo/vistasy/vedas`, 2026-11-04)

Sizes: ChEMBL 37 SQLite ≈ **29 GB** (stock schema, ~80 tables; the scale target); `roster.db` ≈ 3k roster rows but `catalog_records` ≈ **730k** molecules; `completed.db` ≈ 100–200 runs; Neo4j "a few thousand elements"; one RQ queue `vedas`; `completed.db` declares **no foreign keys** (links are implicit), `council.sqlite3` is the only file with real FKs. Not in any store DBeef reads: FAERS text files, OpenGWAS JSON/NPZ (DuckDB over files, after P8).

Draft `configs/vedas.yaml` (P0 task 1; env vars hold the remote machine's paths):

```yaml
project: vedas
stores:
  completed:   {type: sqlite, path: "${VEDAS_DATA}/runs/completed.db"}      # runs, run_facts, run_gates, hypothesis_stubs, rd_generations, copilot_*
  roster:      {type: sqlite, path: "${VEDAS_DATA}/roster.db"}              # roster, roster_synonyms, catalog_*
  sweep_state: {type: sqlite, path: "${VEDAS_DATA}/sweep/state.db"}         # run_state
  council:     {type: sqlite, path: "${VEDAS_DATA}/runs/council.sqlite3"}   # council_* (real FKs)
  pubchem:     {type: sqlite, path: "${VEDAS_DATA}/enrichment/pubchem.db"}  # cache, throttle
  chembl:      {type: sqlite, path: "${VEDAS_DATA}/chembl/chembl_37.db", immutable: true}
  graph:       {type: neo4j, uri: "${NEO4J_URI}", user: "${NEO4J_USER}", password: "${NEO4J_PASSWORD}"}
  jobs:        {type: redis, url: "${REDIS_URL}"}
links:
  - {from: {store: completed, collection: runs, field: inchikey}, to: {store: roster, collection: roster, field: inchikey}}
  - {from: {store: completed, collection: runs, field: inchikey}, to: {store: graph, collection: Molecule, field: inchikey}}
  - {from: {store: roster, collection: roster, field: inchikey}, to: {store: roster, collection: catalog_records, field: inchikey}}
  - {from: {store: sweep_state, collection: run_state, field: inchikey}, to: {store: roster, collection: roster, field: inchikey}}
  - {from: {store: roster, collection: roster, field: chembl_id}, to: {store: graph, collection: Molecule, field: chembl_id}}
  - {from: {store: completed, collection: run_facts, field: run_id}, to: {store: completed, collection: runs, field: run_id}}
  - {from: {store: completed, collection: run_gates, field: run_id}, to: {store: completed, collection: runs, field: run_id}}
  - {from: {store: completed, collection: hypothesis_stubs, field: run_id}, to: {store: completed, collection: runs, field: run_id}}
  - {from: {store: jobs, collection: "rq:job:*", field: $key}, to: {store: completed, collection: runs, field: run_id}}   # holds for single-hypothesis jobs only
  - {from: {store: council, collection: council_lab_proposals, field: job_id}, to: {store: jobs, collection: "rq:job:*", field: $key}}
  - {from: {store: completed, collection: runs, field: hypothesis_id}, to: {store: graph, collection: Evidence, field: hypothesis_id}}
  - {from: {store: completed, collection: runs, field: hypothesis_id}, to: {store: graph, collection: MR_Analysis, field: hypothesis_id}}
  - {from: {store: graph, collection: Target, field: chembl_id}, to: {store: chembl, collection: target_dictionary, field: chembl_id}}
origins:                       # P1
  inchikey:      {store: roster, collection: roster, field: inchikey}
  run_id:        {store: completed, collection: runs, field: run_id}
  hypothesis_id: {store: completed, collection: runs, field: hypothesis_id}
  chembl_id:     {store: chembl, collection: molecule_dictionary, field: chembl_id}
dag:                           # P6: the graph holds no stage order, so stages are explicit
  source: graph
  nodes:
    - {id: stubs,     store: completed,   collection: hypothesis_stubs, label: "0 breadth"}
    - {id: sweep,     store: sweep_state, collection: run_state,        label: "sweep"}
    - {id: jobs,      store: jobs,        collection: "rq:job:*",       label: "4 verify (RQ)"}
    - {id: molecule,  store: graph,       collection: Molecule,         label: "7 write"}
    - {id: evidence,  store: graph,       collection: Evidence}
    - {id: mr,        store: graph,       collection: MR_Analysis}
    - {id: phenotype, store: graph,       collection: Phenotype}
    - {id: target,    store: graph,       collection: Target}
    - {id: disease,   store: graph,       collection: Disease}
    - {id: runs,      store: completed,   collection: runs,             label: "8 persist"}
    - {id: facts,     store: completed,   collection: run_facts}
    - {id: gates,     store: completed,   collection: run_gates}
  edges:
    - {from: stubs, to: jobs}
    - {from: sweep, to: jobs}
    - {from: jobs, to: molecule}
    - {from: molecule, to: evidence, label: SUPPORTED_BY}
    - {from: molecule, to: mr, label: ESTIMATES}
    - {from: mr, to: phenotype, label: ON_OUTCOME}
    - {from: molecule, to: target, label: HAS_ACTIVITY}
    - {from: target, to: disease, label: ASSOCIATED_WITH}
    - {from: jobs, to: runs}
    - {from: runs, to: facts}
    - {from: runs, to: gates}
```

Identity keys for `rows(eq=…)` (P1): `Molecule.inchikey`, `Target.gene_symbol` (plus `chembl_id`), `Disease.efo_id`, `Phenotype.phenotype_name`; `Evidence` and `MR_Analysis` are composite (`hypothesis_id` + `assertion_id`), and `SUPPORTED_BY` relationships carry `hypothesis_id`/`assertion_id` too, so a `hypothesis_id` trace should include that rel type as an endpoint.
