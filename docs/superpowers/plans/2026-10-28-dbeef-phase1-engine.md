# DBeef Phase 1 Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python engine for DBeef phase 1:
- read-only SQLite, Neo4j and Redis adapters
- loading of the project config file (`dbeef.yaml`)
- the HTTP API (spec §4.3), including the schema-map payload
- a throwaway dev page used to check everything in a browser

**Architecture:**
- Each adapter sits behind one abstract base class.
- A `Project` object creates its adapters lazily, so one store being down can't block the others.
- `build_schema_map` merges three kinds of links: links inside one store (from the adapters), cross-store links (from the config file), and suggested links (from matching field names).
- A FastAPI app built by `create_app` serves all of it.
- The CLI binds a local socket, prints the `{port, token}` line, and runs uvicorn.

**Tech Stack:** Python ≥3.12, FastAPI, uvicorn, Pydantic v2, PyYAML, the `neo4j` driver (5.x), `redis` (redis-py 5.x), `sqlite3` from the standard library, pytest, httpx.

**Spec:** `docs/superpowers/specs/2026-10-28-dbeef-design.md`

## Global Constraints

- All engine code lives in `engine/`. Python package: `engine/dbeef/`. Tests: `engine/tests/`. Run every command from `engine/`.
- `engine/requirements.txt` holds runtime dependencies. `engine/requirements-dev.txt` starts with `-r requirements.txt` and adds pytest and httpx. Never commit uv files, and never mention uv in a commit message.
- Read-only is enforced **inside the adapter**. Every adapter has a test proving that a write is refused.
- Row limit: default `100`, hard cap `10_000`. Query timeout: `10` seconds (constant `QUERY_TIMEOUT_S`).
- The engine binds to `127.0.0.1` only. Every `/api/*` request needs the header `X-DBeef-Token`.
- Default CORS origins: `tauri://localhost` and `http://tauri.localhost`. More are added with `--allow-origin`.
- Error body: `{"error": {"code": ..., "message": ...}}`. Codes: `write_blocked` (403), `store_unavailable` (503), `not_found` (404), `bad_query` (400), `timeout` (504), `unauthorized` (401). `unauthorized` is the plan's addition to the spec's list.
- Neo4j and Redis tests are **skipped cleanly** when their store can't be reached.
- Commits use Conventional Commits with subjects under 60 characters. Commit only after the task's tests pass. Never push.
- No VEDAS-specific code. VEDAS appears only in example YAML.

## Review Focus

1. **SQLite writes through side doors.** `ATTACH DATABASE '/tmp/x.db' AS x` and `VACUUM INTO '/tmp/y.db'` must raise `WriteBlocked` and create no file. Covered by Task 3's allowlist authorizer tests.
2. **Missing or relative SQLite paths.** A relative path resolves against the config file's folder. A missing file gives that store status `error` and is **not created**. Covered by Task 2 and Task 3 tests.
3. **Binary or huge Redis values** (RQ stores pickled job data). These display as `"<binary N bytes>"`, and strings are cut at 1,000 characters. Nothing crashes. Covered by Task 5 tests.
4. **Odd collection names** (quotes, spaces, backticks). They work through quoting checked against the real list of names. An unknown name returns 404 and is never inserted into a query. Covered by Task 3 and Task 7 tests.
5. **Values that aren't plain JSON** (SQLite BLOB, Neo4j DateTime, float NaN). They become strings, and the response stays valid JSON. Covered by Task 1 (`to_json_safe`), Task 3 and Task 4 tests.

---

### Task 1: Scaffold and adapter base types

**Files:**
- Create: `engine/requirements.txt`, `engine/requirements-dev.txt`, `engine/pytest.ini`, `engine/dbeef/__init__.py`, `engine/dbeef/adapters/__init__.py` (empty for now), `engine/dbeef/adapters/base.py`
- Test: `engine/tests/test_base.py`

**Interfaces:**
- Produces, all in `dbeef/adapters/base.py`:
  - Constants: `DEFAULT_LIMIT = 100`, `MAX_LIMIT = 10_000`, `QUERY_TIMEOUT_S = 10`
  - `clamp_limit(limit: int | None) -> int`. `None` gives 100. Values below 1 become 1. Values above 10,000 become 10,000.
  - `to_json_safe(value: Any) -> Any`. Passes through `None`, bool, int, str and finite floats. Converts NaN and ±inf floats to `str`. Converts bytes to `"<binary N bytes>"`, or to the decoded text if it is valid UTF-8 and ≤1000 characters. Recurses into dict, list and tuple. Calls `str(value)` on anything else.
  - Exceptions: `DBeefError(code: str, message: str)` and its subclasses `WriteBlocked` (`"write_blocked"`), `StoreUnavailable` (`"store_unavailable"`), `NotFound` (`"not_found"`), `BadQuery` (`"bad_query"`) and `QueryTimeout` (`"timeout"`). Each subclass takes only `message`.
  - Pydantic models:
    - `Field(name: str, type: str)`
    - `Collection(name: str, kind: Literal["table", "view", "label", "rel_type", "key_pattern"], count: int | None, count_is_estimate: bool = False)`
    - `IntraLink(from_collection: str, from_field: str | None, to_collection: str, to_field: str | None, label: str)`
    - `Description(collection: Collection, fields: list[Field], links: list[IntraLink])`
    - `QueryResult(columns: list[str], rows: list[list[Any]], truncated: bool)`
  - `class Adapter(ABC)` with abstract methods `ping() -> None` (raises `StoreUnavailable`), `list_collections() -> list[Collection]`, `describe(name: str) -> Description`, `sample(name: str, limit: int | None = None) -> QueryResult`, `query(text: str, limit: int | None = None) -> QueryResult` and `close() -> None`.

- [ ] **Step 1: Write `requirements.txt` and `requirements-dev.txt`**

  `requirements.txt` pins: `fastapi`, `uvicorn`, `pydantic>=2`, `pyyaml`, `neo4j>=5,<6` and `redis>=5`.

  `requirements-dev.txt` contains `-r requirements.txt`, `pytest` and `httpx`.

  Write `pytest.ini`:
  ```
  [pytest]
  pythonpath = .
  testpaths = tests
  ```

  Then set up the environment:
  ```bash
  python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
  ```

- [ ] **Step 2: Write the failing tests**

```python
def test_clamp_limit():
    assert clamp_limit(None) == 100
    assert clamp_limit(0) == 1
    assert clamp_limit(50) == 50
    assert clamp_limit(99_999) == 10_000

def test_to_json_safe():
    assert to_json_safe(float("nan")) == "nan"
    assert to_json_safe(b"\x80\x81") == "<binary 2 bytes>"
    assert to_json_safe(b"hello") == "hello"
    assert to_json_safe({"a": [1, b"\xff"]}) == {"a": [1, "<binary 1 bytes>"]}
    assert to_json_safe(datetime(2026, 1, 1)) == "2026-01-01 00:00:00"

def test_error_codes():
    assert WriteBlocked("x").code == "write_blocked"
    assert QueryTimeout("x").code == "timeout"
```

- [ ] **Step 3: Run the tests and check they fail.** Run `.venv/bin/pytest tests/test_base.py -v`. Expected: an ImportError.

- [ ] **Step 4: Implement `base.py`** with the interfaces above.

- [ ] **Step 5: Run the tests and check they pass.** Run `.venv/bin/pytest tests/test_base.py -v`. Expected: 3 passed.

- [ ] **Step 6: Commit**
  ```bash
  git add engine/requirements.txt engine/requirements-dev.txt engine/pytest.ini engine/dbeef engine/tests
  git commit -m "feat(engine): add adapter base types"
  ```

---

### Task 2: Project config loading

**Files:**
- Create: `engine/dbeef/config.py`
- Test: `engine/tests/test_config.py`

**Interfaces:**
- Produces, in `dbeef/config.py`:
  - `StoreRef(store: str, collection: str, field: str)`
  - `LinkConfig`. Its `from_: StoreRef` uses `alias="from"`, and `to: StoreRef`. Set `populate_by_name=True`.
  - `SqliteStore(type: Literal["sqlite"], path: Path)`
  - `Neo4jStore(type: Literal["neo4j"], uri: str, user: str = "neo4j", password: str = "", database: str | None = None)`
  - `RedisStore(type: Literal["redis"], url: str)`
  - `StoreConfig`: an Annotated union of the three store types, discriminated on `type`
  - `ProjectConfig(project: str, stores: dict[str, StoreConfig], links: list[LinkConfig] = [], origins: dict = {}, dag: dict = {})`
    - `project` must match `^[a-z0-9_-]+$`.
    - Store names must match `^[A-Za-z0-9_-]+$`.
    - `stores` must not be empty.
    - A model validator rejects any link whose `store` isn't a key of `stores`, with the message `link #<i>: unknown store '<name>'`.
  - `class ConfigError(Exception)`
  - `load_config(path: Path) -> ProjectConfig`. Steps:
    1. Parse the YAML with `yaml.safe_load`.
    2. Walk the parsed values and expand `${VAR}` in strings only. A missing variable raises `ConfigError("<path>: env var VAR is not set")`.
    3. Validate the result.
    4. Resolve relative `SqliteStore.path` values against `path.parent`.

    Wrap any Pydantic `ValidationError` as `ConfigError(f"{path}: {err}")`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests** in `test_config.py`, using pytest's `tmp_path` and `monkeypatch`:

```python
def test_loads_and_expands_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PW", "s3:cr#t")
    p = write(tmp_path, """
project: demo
stores:
  graph: {type: neo4j, uri: bolt://localhost:7687, password: "${PW}"}
  runs: {type: sqlite, path: data/runs.db}
links:
  - from: {store: runs, collection: runs, field: inchikey}
    to: {store: graph, collection: Molecule, field: inchikey}
""")
    cfg = load_config(p)
    assert cfg.stores["graph"].password == "s3:cr#t"
    assert cfg.stores["runs"].path == tmp_path / "data/runs.db"
    assert cfg.links[0].from_.field == "inchikey"

def test_missing_env_var(tmp_path):
    # Write a config containing password: "${NOPE_NOT_SET}", then:
    with pytest.raises(ConfigError, match="NOPE_NOT_SET"):
        load_config(p)

def test_unknown_link_store(tmp_path):
    # A link whose from.store is 'ghost':
    with pytest.raises(ConfigError, match="link #0: unknown store 'ghost'"):
        load_config(p)

def test_bad_store_type(tmp_path):
    # A store with type: mongo:
    with pytest.raises(ConfigError):
        load_config(p)
```

  `write(tmp_path, text)` is a small helper in the test file. It writes `dbeef.yaml` and returns its path.

- [ ] **Step 2: Run the tests and check they fail.** Run `.venv/bin/pytest tests/test_config.py -v`. Expected: an ImportError.

- [ ] **Step 3: Implement `config.py`.** Expand variables after parsing, never on the raw text, so a password containing `:` or `#` can't break the YAML.

- [ ] **Step 4: Run the tests and check they pass.** Run `.venv/bin/pytest tests/test_config.py -v`. Expected: 4 passed.

- [ ] **Step 5: Commit**
  ```bash
  git add engine/dbeef/config.py engine/tests/test_config.py
  git commit -m "feat(engine): load and validate dbeef.yaml"
  ```

---

### Task 3: SQLite adapter

**Files:**
- Create: `engine/dbeef/adapters/sqlite.py`
- Test: `engine/tests/test_sqlite_adapter.py`

**Interfaces:**
- Consumes: from Task 1, `Adapter`, the models, the exceptions, `clamp_limit`, `to_json_safe` and `QUERY_TIMEOUT_S`.
- Produces: `SqliteAdapter(path: Path)`, which implements `Adapter`.

**How it works:**
- Connect with `sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)`, then run `PRAGMA query_only=ON`. A failure to open raises `StoreUnavailable`, and `mode=ro` never creates the file.
- Install an **allowlist authorizer** with `conn.set_authorizer`:
  - Allow `SQLITE_SELECT`, `SQLITE_READ`, `SQLITE_FUNCTION` and `SQLITE_RECURSIVE`.
  - Allow `SQLITE_PRAGMA` only when its argument is in `{"table_info", "table_xinfo", "foreign_key_list", "index_list", "query_only"}`.
  - Deny everything else. When sqlite raises "not authorized", convert it to `WriteBlocked`.
- Timeout: `set_progress_handler` with a deadline of `QUERY_TIMEOUT_S`. An interruption raises `QueryTimeout`.
- `list_collections`: rows of `sqlite_master` with type `table` or `view` whose names don't start with `sqlite_`. Each count comes from `SELECT COUNT(*)`.
- `describe`: fields from `PRAGMA table_info`, with the type defaulting to `""` when it isn't declared. Links come from `PRAGMA foreign_key_list`, with the label `f"FK {from}"`.
- Names are checked against `list_collections()`. An unknown name raises `NotFound`. A known name is quoted as `'"' + name.replace('"', '""') + '"'`.
- `sample` runs `SELECT * FROM <quoted> LIMIT ?` with `limit + 1`. The extra row sets `truncated`, and is dropped from the result.
- `query` uses `fetchmany(limit + 1)` and converts values with `to_json_safe`. Any other `sqlite3.Error` becomes `BadQuery(str(e))`.

- [ ] **Step 1: Write the failing tests.**

  A `sample_db(tmp_path)` fixture uses a normal read-write connection to build:
  - `runs(run_id TEXT PRIMARY KEY, inchikey TEXT, score REAL, blob BLOB)`, holding 3 rows. One row has `score = NaN` and a 4-byte non-UTF-8 blob.
  - `run_facts(run_id TEXT REFERENCES runs(run_id), verdict TEXT)`
  - a table named `my "odd" table` with 1 row

```python
def test_lists_and_describes(sample_db):
    a = SqliteAdapter(sample_db)
    names = {c.name: c for c in a.list_collections()}
    assert names["runs"].count == 3 and names["runs"].kind == "table"
    d = a.describe("run_facts")
    assert d.links == [IntraLink(from_collection="run_facts", from_field="run_id",
                                 to_collection="runs", to_field="run_id", label="FK run_id")]

def test_sample_truncates_and_is_json_safe(sample_db):
    r = SqliteAdapter(sample_db).sample("runs", limit=2)
    assert len(r.rows) == 2 and r.truncated is True
    json.dumps(SqliteAdapter(sample_db).sample("runs").model_dump())  # must not raise

def test_odd_name_and_unknown_name(sample_db):
    a = SqliteAdapter(sample_db)
    assert len(a.sample('my "odd" table').rows) == 1
    with pytest.raises(NotFound):
        a.sample('runs"; DROP TABLE runs; --')

@pytest.mark.parametrize("sql", [
    "INSERT INTO runs(run_id) VALUES ('x')", "DROP TABLE runs",
    "ATTACH DATABASE '{tmp}/x.db' AS x", "VACUUM INTO '{tmp}/y.db'",
])
def test_writes_blocked(sample_db, tmp_path, sql):
    with pytest.raises(WriteBlocked):
        SqliteAdapter(sample_db).query(sql.format(tmp=tmp_path))
    assert not (tmp_path / "x.db").exists() and not (tmp_path / "y.db").exists()
    assert SqliteAdapter(sample_db).query("SELECT COUNT(*) FROM runs").rows == [[3]]

def test_missing_file_is_unavailable_and_not_created(tmp_path):
    with pytest.raises(StoreUnavailable):
        SqliteAdapter(tmp_path / "nope.db").ping()
    assert not (tmp_path / "nope.db").exists()

def test_bad_sql(sample_db):
    with pytest.raises(BadQuery):
        SqliteAdapter(sample_db).query("SELEC 1")
```

- [ ] **Step 2: Run the tests and check they fail.** Run `.venv/bin/pytest tests/test_sqlite_adapter.py -v`. Expected: an ImportError.

- [ ] **Step 3: Implement `sqlite.py`** as described above.

- [ ] **Step 4: Run the tests and check they pass.** Run `.venv/bin/pytest tests/test_sqlite_adapter.py -v`. Expected: everything passes, including all 4 write-blocked cases.

- [ ] **Step 5: Commit**
  ```bash
  git add engine/dbeef/adapters/sqlite.py engine/tests/test_sqlite_adapter.py
  git commit -m "feat(engine): add read-only SQLite adapter"
  ```

---

### Task 4: Neo4j adapter

**Files:**
- Create: `engine/dbeef/adapters/neo4j.py`
- Test: `engine/tests/test_neo4j_adapter.py`

**Interfaces:**
- Consumes: Task 1 base.
- Produces: `Neo4jAdapter(uri: str, user: str, password: str, database: str | None = None)`, which implements `Adapter`.

**How it works:**
- `ping` calls `driver.verify_connectivity()`. Any `neo4j.exceptions.ServiceUnavailable` or `AuthError` becomes `StoreUnavailable`.
- Every session is opened with `default_access_mode=neo4j.READ_ACCESS`.
- `list_collections` returns:
  - labels from `CALL db.labels()`, each with the count from `MATCH (n:<L>) RETURN count(n)`, kind `label`;
  - relationship types from `CALL db.relationshipTypes()`, with counts, kind `rel_type`.
- `describe(label)`:
  - Fields are the union of property keys over `MATCH (n:<L>) RETURN n LIMIT 100`. Each field's type is the Python type name of the first non-null value seen.
  - Links come from `MATCH (a:<L>)-[r]->(b) WITH type(r) AS t, labels(b) AS ls LIMIT 1000 RETURN DISTINCT t, ls`. Each becomes an `IntraLink` with that label, `None` for both fields, `to_collection` set to the first target label, and the relationship type as its label.
  - `describe(rel_type)` returns property fields and no links.
- Names are checked against the list (an unknown name raises `NotFound`) and quoted with backticks: `` "`" + name.replace("`", "``") + "`" ``.
- `sample(label)` returns columns `["_id", *sorted property keys]`. `_id` is `n.element_id`. Values go through `to_json_safe`, so DateTime and Point become strings.
- `query(text)`:
  1. Run `EXPLAIN <text>` and read `summary.query_type`.
  2. Any value other than `"r"` raises `WriteBlocked(f"query type {qt}")`.
  3. Otherwise run `neo4j.Query(text, timeout=QUERY_TIMEOUT_S)` inside `session.execute_read`.

  Node, Relationship and Path values are flattened into dicts or lists:
  - a Node becomes `{"_id", "_labels", **props}`;
  - a Relationship becomes `{"_id", "_type", **props}`;
  - a Path becomes a list of nodes and relationships.

  A `ClientError` caused by a syntax error becomes `BadQuery`. A timeout becomes `QueryTimeout`.

- [ ] **Step 1: Write the failing tests.**

  At the top of the file, connect to `NEO4J_TEST_URI` (default `bolt://localhost:7687`) as `neo4j` with password `NEO4J_TEST_PASSWORD` (default `dbeef-test`). If `verify_connectivity()` raises, skip the whole module:
  ```python
  pytest.skip("Neo4j not reachable", allow_module_level=True)
  ```

  A fixture creates test data through a **separate write session**, using unique labels `T<uuid8>Drug` and `T<uuid8>Target`:
  - 2 Drug nodes, one of them with a `created: datetime()` property
  - 1 Target node
  - 1 `BINDS` relationship from a Drug to the Target

  On teardown it runs `MATCH (n) WHERE n:<Drug> OR n:<Target> DETACH DELETE n`.

```python
def test_lists_and_describes(graph):
    a = Neo4jAdapter(URI, "neo4j", PW)
    c = {x.name: x for x in a.list_collections()}
    assert c[graph.drug].count == 2 and c[graph.drug].kind == "label"
    d = a.describe(graph.drug)
    assert IntraLink(from_collection=graph.drug, from_field=None, to_collection=graph.target,
                     to_field=None, label="BINDS") in d.links

def test_sample_json_safe(graph):
    r = Neo4jAdapter(URI, "neo4j", PW).sample(graph.drug)
    assert r.columns[0] == "_id" and len(r.rows) == 2
    json.dumps(r.model_dump())

@pytest.mark.parametrize("cy", ["CREATE (:{d})", "MATCH (n:{d}) SET n.x = 1",
                                "MATCH (n:{d}) DETACH DELETE n"])
def test_writes_blocked(graph, cy):
    a = Neo4jAdapter(URI, "neo4j", PW)
    with pytest.raises(WriteBlocked):
        a.query(cy.format(d=graph.drug))
    assert a.query(f"MATCH (n:{graph.drug}) RETURN count(n) AS c").rows == [[2]]

def test_unknown_label(graph):
    with pytest.raises(NotFound):
        Neo4jAdapter(URI, "neo4j", PW).sample("Nope` RETURN 1 //")

def test_unreachable():
    with pytest.raises(StoreUnavailable):
        Neo4jAdapter("bolt://127.0.0.1:1", "neo4j", "x").ping()
```

- [ ] **Step 2: Start a throwaway Neo4j.** On Apple Silicon this image runs natively:
  ```bash
  docker run --rm -d --name dbeef-neo4j-test -p 7687:7687 -e NEO4J_AUTH=neo4j/dbeef-test neo4j:5
  ```
  Wait until `docker logs dbeef-neo4j-test` shows `Started.`

- [ ] **Step 3: Run the tests and check they fail.** Run `.venv/bin/pytest tests/test_neo4j_adapter.py -v`. Expected: an ImportError, not a skip.

- [ ] **Step 4: Implement `neo4j.py`** as described above.

- [ ] **Step 5: Run the tests and check they pass.** Run `.venv/bin/pytest tests/test_neo4j_adapter.py -v`. Expected: everything passes.

  Then stop the container with `docker stop dbeef-neo4j-test`, run the tests again, and expect the module to be skipped with `Neo4j not reachable`.

- [ ] **Step 6: Commit**
  ```bash
  git add engine/dbeef/adapters/neo4j.py engine/tests/test_neo4j_adapter.py
  git commit -m "feat(engine): add read-only Neo4j adapter"
  ```

---

### Task 5: Redis adapter

**Files:**
- Create: `engine/dbeef/adapters/redis.py`
- Test: `engine/tests/test_redis_adapter.py`

**Interfaces:**
- Consumes: Task 1 base.
- Produces:
  - `RedisAdapter(url: str)`, which implements `Adapter`
  - `key_pattern(key: str) -> str`, a module-level function
  - `READ_COMMANDS: frozenset[str]`

**How it works:**
- The client is `redis.Redis.from_url(url, socket_timeout=QUERY_TIMEOUT_S, decode_responses=False)`. `ping` turns any `redis.ConnectionError` into `StoreUnavailable`.
- `key_pattern(key)`: split the key on `:` and replace each segment with `*` if it contains a digit or is at least 20 characters long. For example, `rq:job:3f2a…` becomes `rq:job:*` and `rq:queue:vedas` stays the same.
- `list_collections` runs `SCAN` until 10,000 keys have been seen and groups them by `key_pattern`. Each group becomes a collection of kind `key_pattern`, counting the keys seen, with `count_is_estimate=True` when the scan stopped at the cap.
- `describe(pattern)`:
  - Fields always start with `Field("$key", "key segment")`.
  - For a hash, they then list the union of field names over up to 20 sampled keys, each with type `"hash field"`.
  - For any other type, there is a single `Field("value", <redis type>)`.
  - There are no links.
- `sample(pattern)` scans with `match=pattern`. Columns are `["key", "type", "ttl", "value"]`. The value depends on the type:

  | Type | Value |
  |---|---|
  | string | `GET`, cut to 1,000 characters |
  | hash | `HGETALL` as a dict |
  | list | `LRANGE 0 9` |
  | set | the first 10 members from `SSCAN` |
  | zset | `ZRANGE 0 9 WITHSCORES` |
  | stream | `XRANGE`, 10 entries |

  Everything goes through `to_json_safe`.
- `query(text)`: split with `shlex.split`. The upper-cased first token must be in `READ_COMMANDS`, or the adapter raises `WriteBlocked(f"{cmd} is not a read command")` without sending anything. Allowed commands are sent with `execute_command`. The result is `columns=["result"]`, with one row per list item (capped at the limit) or a single row otherwise.

  `READ_COMMANDS`: `GET MGET STRLEN GETRANGE HGET HGETALL HKEYS HVALS HLEN HMGET HEXISTS HSCAN LRANGE LLEN LINDEX SMEMBERS SCARD SISMEMBER SSCAN ZRANGE ZCARD ZSCORE ZRANGEBYSCORE ZSCAN XRANGE XREVRANGE XLEN TYPE TTL PTTL EXISTS SCAN DBSIZE`. `KEYS` is excluded because it blocks the server; use `SCAN` instead.

- [ ] **Step 1: Write the failing tests.**

  - `key_pattern` tests run without Redis.
  - The other tests connect to `REDIS_TEST_URL` (default `redis://localhost:6379/15`). If it isn't reachable, they are skipped with `pytest.skip("Redis not reachable")`.
  - A fixture writes keys under the prefix `dbeeftest<uuid8>:` through a separate client:
    - `…:job:1a2b3c` and `…:job:4d5e6f` as hashes with fields `status` and `data`, where `data` holds pickle-like bytes `b"\x80\x05..."`
    - `…:queue:main` as a list
    - `…:big` as a 5,000-character string

    On teardown it deletes exactly those keys.

```python
def test_key_pattern():
    assert key_pattern("rq:job:3f2a9c1e-77d0-4b1e-9d1a-2c6b0f5e8a11") == "rq:job:*"
    assert key_pattern("rq:queue:vedas") == "rq:queue:vedas"

def test_patterns_and_describe(keys):
    a = RedisAdapter(URL)
    pats = {c.name for c in a.list_collections()}
    assert f"{keys.prefix}:job:*" in pats
    d = a.describe(f"{keys.prefix}:job:*")
    assert [f.name for f in d.fields][0] == "$key"
    assert {"status", "data"} <= {f.name for f in d.fields}

def test_binary_and_big_values(keys):
    a = RedisAdapter(URL)
    row = a.sample(f"{keys.prefix}:job:*").rows[0]
    assert row[3]["data"].startswith("<binary ")
    big = a.sample(f"{keys.prefix}:big").rows[0][3]
    assert len(big) == 1000

@pytest.mark.parametrize("cmd", ["SET {p}:x 1", "DEL {p}:big", "FLUSHALL",
                                 "EVAL \"return redis.call('SET','{p}:y','1')\" 0", "CONFIG SET save ''"])
def test_writes_blocked(keys, cmd):
    with pytest.raises(WriteBlocked):
        RedisAdapter(URL).query(cmd.format(p=keys.prefix))
    assert keys.client.exists(f"{keys.prefix}:big") == 1
    assert keys.client.exists(f"{keys.prefix}:x") == 0
```

- [ ] **Step 2: Start a throwaway Redis**
  ```bash
  docker run --rm -d --name dbeef-redis-test -p 6379:6379 redis:7
  ```

- [ ] **Step 3: Run the tests and check they fail.** Run `.venv/bin/pytest tests/test_redis_adapter.py -v`. Expected: an ImportError.

- [ ] **Step 4: Implement `redis.py`** as described above.

- [ ] **Step 5: Run the tests and check they pass.** Run `.venv/bin/pytest tests/test_redis_adapter.py -v`. Expected: everything passes.

  Then run `docker stop dbeef-redis-test` and check the Redis tests are skipped while `test_key_pattern` still passes.

- [ ] **Step 6: Commit**
  ```bash
  git add engine/dbeef/adapters/redis.py engine/tests/test_redis_adapter.py
  git commit -m "feat(engine): add read-only Redis adapter"
  ```

---

### Task 6: Project registry and schema map

**Files:**
- Modify: `engine/dbeef/adapters/__init__.py` to add `make_adapter`
- Create: `engine/dbeef/project.py`, `engine/dbeef/schema_map.py`
- Test: `engine/tests/test_schema_map.py`

**Interfaces:**
- Consumes:
  - Task 2: `ProjectConfig`, the store config types, `LinkConfig`
  - Tasks 3–5: the adapter classes
  - Task 1: the models
- Produces:
  - `make_adapter(store: StoreConfig) -> Adapter`, in `dbeef/adapters/__init__.py`. It dispatches on `store.type`.
  - `StoreStatus(name: str, type: str, status: Literal["ok", "error"], message: str | None)`, in `dbeef/project.py`.
  - `class Project`, in `dbeef/project.py`:
    - `__init__(config: ProjectConfig, adapter_factory=make_adapter)`
    - `adapter(store: str) -> Adapter`: lazy and cached. An unknown store raises `NotFound`. It calls `ping()`, so a store that's down raises `StoreUnavailable`.
    - `statuses() -> list[StoreStatus]`
    - `close()`
  - In `dbeef/schema_map.py`:
    - `MapNode(id: str, store: str, store_type: str, collection: str, kind: str, count: int | None, fields: list[Field])`. `id` is `f"{store}/{collection}"`.
    - `MapEdge(from_: str, to: str, kind: Literal["intra", "cross", "suggested", "broken"], label: str, from_field: str | None = None, to_field: str | None = None)`. `from_` uses `alias="from"`, and the model is serialized `by_alias`.
    - `SchemaMap(nodes: list[MapNode], edges: list[MapEdge], errors: list[StoreStatus])`
    - `build_schema_map(project: Project) -> SchemaMap`
    - `SUGGEST_STOPLIST = {"id", "_id", "name", "type", "status", "value", "created_at", "updated_at", "key", "$key"}`

**How `build_schema_map` works:**
1. For each store, get its adapter. A `StoreUnavailable` is added to `errors` and the store is skipped.
2. For each collection whose kind isn't `rel_type`, call `describe`. A failure in one `describe` skips only that collection. Each described collection becomes a `MapNode`, and each `IntraLink` becomes an `intra` edge between `store/collection` ids. Relationship types appear only as edge labels.
3. For each config link:
   - It becomes a `cross` edge, labelled `"{from.field} → {to.field}"`, when both nodes exist and both fields exist. `$key` counts as existing on any `key_pattern` node.
   - Otherwise it becomes a `broken` edge, labelled with the reason: `"store unavailable: X"`, `"no collection X.Y"` or `"no field X.Y.Z"`.
4. For each pair of nodes in **different** stores:
   - Each field name they share that isn't in the stoplist and isn't already covered by a config link between that pair becomes one `suggested` edge, labelled with the field name.
   - The two ids are ordered by sort, so each pair is reported once.

- [ ] **Step 1: Write the failing tests.**

  The fixture builds two temp SQLite files:
  - `runs.db`: `runs(run_id PK, inchikey, hypothesis_id)` and `run_facts(run_id REFERENCES runs)`
  - `roster.db`: `roster(inchikey, pref_name)`

  It also defines a `ProjectConfig` with these stores:
  - `runs` (sqlite)
  - `roster` (sqlite)
  - `jobs` (redis, unreachable URL `redis://127.0.0.1:1`)

  The config has three links:
  - `runs.runs.inchikey → roster.roster.inchikey`
  - `runs.runs.hypothesis_id → roster.roster.hyp`, which is broken because there's no such field
  - `jobs.rq:job:*.$key → runs.runs.run_id`, which is broken because the store is unavailable

```python
def test_schema_map(project):
    m = build_schema_map(project)
    ids = {n.id for n in m.nodes}
    assert {"runs/runs", "runs/run_facts", "roster/roster"} <= ids
    kinds = {(e.from_, e.to, e.kind) for e in m.edges}
    assert ("runs/run_facts", "runs/runs", "intra") in kinds
    assert ("runs/runs", "roster/roster", "cross") in kinds
    broken = [e for e in m.edges if e.kind == "broken"]
    assert {e.label for e in broken} == {"no field roster.roster.hyp", "store unavailable: jobs"}
    assert [s.name for s in m.errors] == ["jobs"]
    # inchikey is already a config link, so it is not suggested again:
    assert not any(e.kind == "suggested" and e.label == "inchikey" for e in m.edges)

def test_suggested_edge(tmp_path):
    # Two sqlite stores that share a 'molecule_key' column, with no config links:
    m = build_schema_map(project_without_links)
    assert [e.label for e in m.edges if e.kind == "suggested"] == ["molecule_key"]

def test_statuses_isolate_failures(project):
    st = {s.name: s.status for s in project.statuses()}
    assert st == {"runs": "ok", "roster": "ok", "jobs": "error"}
```

- [ ] **Step 2: Run the tests and check they fail.** Run `.venv/bin/pytest tests/test_schema_map.py -v`. Expected: an ImportError.

- [ ] **Step 3: Implement `make_adapter`, `project.py` and `schema_map.py`** as described above.

- [ ] **Step 4: Run the tests and check they pass.** Run `.venv/bin/pytest tests/test_schema_map.py -v`. Expected: everything passes.

- [ ] **Step 5: Commit**
  ```bash
  git add engine/dbeef/adapters/__init__.py engine/dbeef/project.py engine/dbeef/schema_map.py engine/tests/test_schema_map.py
  git commit -m "feat(engine): build cross-store schema map"
  ```

---

### Task 7: HTTP API

**Files:**
- Create: `engine/dbeef/api.py`
- Test: `engine/tests/test_api.py`

**Interfaces:**
- Consumes: `Project` and `build_schema_map` (Task 6), `DBeefError` and the models (Task 1).
- Produces: `create_app(projects: dict[str, Project], token: str, allow_origins: list[str]) -> FastAPI`, in `dbeef/api.py`.

**Routes** (exactly those in spec §4.3, all sync `def`). All responses use Pydantic response models, so `/openapi.json` documents them.

| Route | Returns |
|---|---|
| `GET /api/projects` | `[{"name": ...}]` |
| `GET /api/projects/{p}/stores` | `list[StoreStatus]` |
| `GET /api/projects/{p}/stores/{s}/collections` | `list[Collection]` |
| `GET /api/projects/{p}/stores/{s}/collections/{c}` | `Description` |
| `GET /api/projects/{p}/stores/{s}/collections/{c}/rows?limit=` | `QueryResult` |
| `POST /api/projects/{p}/stores/{s}/query` with body `{text: str, limit: int \| None}` | `QueryResult` |
| `GET /api/projects/{p}/schema-map` | `SchemaMap` (by alias) |

**Behavior:**
- Middleware checks `X-DBeef-Token` with `secrets.compare_digest` on `/api/*`. A missing or wrong token returns 401 `unauthorized`.
- An exception handler maps `DBeefError` to its status: `write_blocked` 403, `store_unavailable` 503, `not_found` 404, `bad_query` 400, `timeout` 504. The body is `{"error": {"code", "message"}}`.
- An unknown project returns `not_found`.
- `CORSMiddleware` is configured with `allow_origins` and allows the header `X-DBeef-Token`.
- A `{c}` path segment containing `/` or `:` must reach the handler, so the route uses the `{c:path}` converter.

- [ ] **Step 1: Write the failing tests.** Use `TestClient(create_app({"demo": project}, token="t", allow_origins=[]))`, with the Task 6 fixture moved into `tests/conftest.py` as `project`.

```python
H = {"X-DBeef-Token": "t"}

def test_token_required(client):
    r = client.get("/api/projects")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"

def test_browse(client):
    assert client.get("/api/projects", headers=H).json() == [{"name": "demo"}]
    st = {s["name"]: s["status"] for s in client.get("/api/projects/demo/stores", headers=H).json()}
    assert st["jobs"] == "error" and st["runs"] == "ok"
    rows = client.get("/api/projects/demo/stores/runs/collections/runs/rows?limit=1", headers=H).json()
    assert len(rows["rows"]) == 1

def test_query_write_blocked(client):
    r = client.post("/api/projects/demo/stores/runs/query", headers=H, json={"text": "DELETE FROM runs"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "write_blocked"

def test_errors(client):
    assert client.get("/api/projects/nope/stores", headers=H).status_code == 404
    assert client.get("/api/projects/demo/stores/jobs/collections", headers=H).status_code == 503
    assert client.get("/api/projects/demo/stores/runs/collections/ghost", headers=H).status_code == 404

def test_schema_map_and_openapi(client):
    m = client.get("/api/projects/demo/schema-map", headers=H).json()
    assert any(e["kind"] == "cross" and e["from"] == "runs/runs" for e in m["edges"])
    assert "/api/projects/{p}/schema-map" in client.get("/openapi.json").json()["paths"]

def test_cors_preflight(project):
    c = TestClient(create_app({"demo": project}, token="t", allow_origins=["tauri://localhost"]))
    r = c.options("/api/projects", headers={"Origin": "tauri://localhost",
                  "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "X-DBeef-Token"})
    assert r.headers["access-control-allow-origin"] == "tauri://localhost"
```

  The token middleware must let `OPTIONS` preflight requests and `/openapi.json` through. Neither carries data.

- [ ] **Step 2: Run the tests and check they fail.** Run `.venv/bin/pytest tests/test_api.py -v`. Expected: an ImportError.

- [ ] **Step 3: Implement `api.py`** as described above.

- [ ] **Step 4: Run the tests and check they pass.** Run `.venv/bin/pytest -v`. Expected: the full suite passes, with Neo4j and Redis skipped if they're not running.

- [ ] **Step 5: Commit**
  ```bash
  git add engine/dbeef/api.py engine/tests/test_api.py engine/tests/conftest.py engine/tests/test_schema_map.py
  git commit -m "feat(engine): add HTTP API with token and errors"
  ```

---

### Task 8: CLI, dev page, sample data, browser check

**Files:**
- Create: `engine/dbeef/__main__.py`, `engine/dbeef/static/index.html`, `engine/examples/make_sample.py`, `engine/examples/dbeef.example.yaml`
- Modify: `engine/dbeef/api.py` to serve `static/index.html` at `/`, outside the token check; `.gitignore` to add `engine/examples/*.db`; `README.md`
- Test: `engine/tests/test_cli.py`

**Interfaces:**
- Consumes: `load_config` and `ConfigError` (Task 2), `Project` (Task 6), `create_app` (Task 7).
- Produces:
  - `main(argv: list[str] | None = None) -> int`, in `dbeef/__main__.py`. It is run as `python -m dbeef`. Packaging it as the `dbeef-engine` binary is phase 1+ PyInstaller work and isn't part of this plan.
  - `parse_args(argv) -> argparse.Namespace`

**CLI behavior:**
- Flags:
  - `--config PATH` (repeatable, at least one required)
  - `--port INT` (default 0)
  - `--dev-token STR`
  - `--allow-origin ORIGIN` (repeatable)
- Each config is loaded with `load_config`. A `ConfigError` prints to stderr and exits with code 2. A duplicate `project` name across configs also exits 2.
- Startup:
  1. Generate the token with `secrets.token_urlsafe(32)`, unless `--dev-token` is given.
  2. Bind a socket to `("127.0.0.1", port)`.
  3. Print `json.dumps({"port": <bound port>, "token": <token>})` as the first stdout line, and flush.
  4. Run `uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])`.
- `allow_origins` is `["tauri://localhost", "http://tauri.localhost", *args.allow_origin]`.

**Dev page** (`static/index.html`): one HTML file with plain JS and no build step.
- It reads `?token=` from the URL and sends it as `X-DBeef-Token`.
- It shows a project picker, then the store list with status badges, then collections with counts.
- Clicking a collection shows its fields, links and a rows table.
- A query box (`POST …/query`) shows results or the error code.
- A "Schema map" section lists nodes grouped by store as boxes, and edges as lines like `runs/runs.inchikey → roster/roster.inchikey [cross]`, colored by kind.
- It's throwaway, so keep it short.

**Sample data:**
- `make_sample.py` writes `examples/sample.db` and `examples/roster.db`, using the same schema as the Task 6 fixture, with about 20 rows.
- `dbeef.example.yaml` points at both files through relative paths. It has one cross link (`inchikey`), and a commented-out VEDAS-style Neo4j store.

- [ ] **Step 1: Write the failing tests**

```python
def test_parse_args_requires_config():
    with pytest.raises(SystemExit):
        parse_args([])

def test_bad_config_exits_2(tmp_path, capsys):
    (tmp_path / "bad.yaml").write_text("project: x\nstores: {}\n")
    assert main(["--config", str(tmp_path / "bad.yaml")]) == 2
    assert "bad.yaml" in capsys.readouterr().err

def test_handshake_line(tmp_path):
    # Run the engine as a subprocess, using the example config generated by make_sample:
    p = subprocess.Popen([sys.executable, "-m", "dbeef", "--config", cfg, "--dev-token", "t"],
                         stdout=subprocess.PIPE, text=True, cwd=ENGINE_DIR)
    try:
        hs = json.loads(p.stdout.readline())
        assert hs["token"] == "t" and hs["port"] > 0
        r = httpx.get(f"http://127.0.0.1:{hs['port']}/api/projects", headers={"X-DBeef-Token": "t"})
        assert r.json() == [{"name": "sample"}]
    finally:
        p.terminate()
```

- [ ] **Step 2: Run the tests and check they fail.** Run `.venv/bin/pytest tests/test_cli.py -v`. Expected: an ImportError.

- [ ] **Step 3: Implement `__main__.py`, the `/` route, `index.html`, `make_sample.py` and `dbeef.example.yaml`** as described above.

- [ ] **Step 4: Run the tests and check they pass.** Run `.venv/bin/pytest -v`. Expected: the full suite passes.

- [ ] **Step 5: Check in the browser (end to end).**
  1. Start the engine:
     ```bash
     .venv/bin/python examples/make_sample.py && .venv/bin/python -m dbeef --config examples/dbeef.example.yaml --port 8765 --dev-token dev
     ```
  2. Open `http://127.0.0.1:8765/?token=dev` and confirm each of these:
     - both stores show `ok`;
     - collections show counts;
     - clicking `runs` shows its rows;
     - `SELECT COUNT(*) FROM runs` returns 20;
     - `DELETE FROM runs` shows `write_blocked`;
     - the schema map lists the `intra` FK edge, the `cross` `inchikey` edge, and no `suggested` `inchikey` edge.
  3. Start the throwaway Neo4j and Redis containers again, add them to a scratch copy of the config, and confirm their stores, collections and rows render too.

- [ ] **Step 6: Update `README.md`.** Describe what DBeef is (one paragraph), how to install the engine (`pip install -r engine/requirements-dev.txt`), how to run it (the command from Step 5), how to run the tests (and which ones skip, and why), and the `dbeef.yaml` format (link to spec §4.2).

- [ ] **Step 7: Commit**
  ```bash
  git add engine/dbeef/__main__.py engine/dbeef/static engine/dbeef/api.py engine/examples engine/tests/test_cli.py .gitignore README.md
  git commit -m "feat(engine): add CLI handshake and dev page"
  ```
