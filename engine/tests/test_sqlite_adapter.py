import json
import sqlite3

import pytest

from dbeef.adapters.base import BadQuery, IntraLink, NotFound, StoreUnavailable, WriteBlocked
from dbeef.adapters.sqlite import SqliteAdapter


@pytest.fixture
def sample_db(tmp_path):
    path = tmp_path / "sample.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE runs(run_id TEXT PRIMARY KEY, inchikey TEXT, score REAL, blob BLOB);
        CREATE TABLE run_facts(run_id TEXT REFERENCES runs(run_id), verdict TEXT);
        CREATE TABLE "my ""odd"" table"(x INTEGER);
        INSERT INTO "my ""odd"" table" VALUES (1);
    """)
    conn.executemany("INSERT INTO runs VALUES (?, ?, ?, ?)", [
        ("r1", "AAA", 0.5, None),
        ("r2", "BBB", float("nan"), b"\x80\x81\x82\x83"),
        ("r3", "CCC", 1.0, None),
    ])
    conn.commit()
    conn.close()
    return path


def test_lists_and_describes(sample_db):
    a = SqliteAdapter(sample_db)
    names = {c.name: c for c in a.list_collections()}
    assert names["runs"].count == 3 and names["runs"].kind == "table"
    d = a.describe("run_facts")
    assert d.links == [IntraLink(from_collection="run_facts", from_field="run_id",
                                 to_collection="runs", to_field="run_id", label="FK run_id")]


def test_sample_truncates_and_is_json_safe(sample_db):
    r = SqliteAdapter(sample_db).rows("runs", limit=2)
    assert len(r.rows) == 2 and r.truncated is True
    json.dumps(SqliteAdapter(sample_db).rows("runs").model_dump(), allow_nan=False)


def test_odd_name_and_unknown_name(sample_db):
    a = SqliteAdapter(sample_db)
    assert len(a.rows('my "odd" table').rows) == 1
    with pytest.raises(NotFound):
        a.rows('runs"; DROP TABLE runs; --')


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


# Final review fixes

def test_uri_special_chars_in_path(tmp_path):
    with pytest.raises(StoreUnavailable):
        SqliteAdapter(tmp_path / "a#b.db").ping()
    assert list(tmp_path.iterdir()) == []
    odd = tmp_path / "q?x%41.db"
    conn = sqlite3.connect(odd)
    conn.execute("CREATE TABLE t(x)")
    conn.commit()
    conn.close()
    assert [c.name for c in SqliteAdapter(odd).list_collections()] == ["t"]


def test_broken_view_does_not_break_store(sample_db):
    conn = sqlite3.connect(sample_db)
    conn.executescript("CREATE TABLE g(x); CREATE VIEW v AS SELECT * FROM g; DROP TABLE g;")
    conn.close()
    a = SqliteAdapter(sample_db)
    counts = {c.name: c.count for c in a.list_collections()}
    assert counts["v"] is None and counts["runs"] == 3
    assert len(a.rows("runs").rows) == 3


def test_sample_and_describe_do_not_count(sample_db):
    a = SqliteAdapter(sample_db)
    seen = []
    a._connect().set_trace_callback(seen.append)
    a.rows("runs")
    a.describe("run_facts")
    assert not any("COUNT(" in s.upper() for s in seen)


# P0: real-data fixes

def test_immutable_uri_never_creates_wal_or_shm(sample_db):
    conn = sqlite3.connect(sample_db)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.close()
    a = SqliteAdapter(sample_db, immutable=True)
    assert len(a.rows("runs").rows) == 3
    assert not (sample_db.parent / "sample.db-shm").exists()
    with pytest.raises(WriteBlocked):
        a.query("DELETE FROM runs")


def test_user_table_named_like_internal_is_listed(sample_db):
    conn = sqlite3.connect(sample_db)
    conn.execute("CREATE TABLE sqlite3_runs(x)")
    conn.commit()
    conn.close()
    assert "sqlite3_runs" in {c.name for c in SqliteAdapter(sample_db).list_collections()}


# P1: rows(eq=…, offset=…)

def test_rows_eq_and_offset(sample_db):
    a = SqliteAdapter(sample_db)
    hit = a.rows("runs", eq=("inchikey", "BBB"))
    assert [r[0] for r in hit.rows] == ["r2"] and hit.offset == 0 and hit.total == 1
    assert a.rows("runs", eq=("inchikey", "nope")).rows == []
    assert a.rows("runs", eq=("inchikey", "x' OR '1'='1")).rows == []
    page = a.rows("runs", limit=2, offset=2)
    assert [r[0] for r in page.rows] == ["r3"] and page.truncated is False and page.offset == 2
    assert a.rows("runs", offset=99).rows == []
    with pytest.raises(BadQuery):
        a.rows("runs", eq=("ghost", "1"))


# P2: order_by, q, total

def test_rows_order_by_and_q(sample_db):
    a = SqliteAdapter(sample_db)
    assert [r[0] for r in a.rows("runs", order_by="run_id", desc=True).rows] == ["r3", "r2", "r1"]
    assert [r[0] for r in a.rows("runs", order_by="score").rows][0] == "r2"  # NaN sorts first, as SQLite does
    with pytest.raises(BadQuery):
        a.rows("runs", order_by="ghost")
    q = a.rows("runs", q="BB")
    assert [r[0] for r in q.rows] == ["r2"] and q.total == 1
    assert a.rows("runs", q="r").total == 3            # matches run_id in every row
    assert a.rows("runs", q="%").rows == []            # LIKE wildcards are escaped
    assert a.rows("runs", q="_").rows == []
    assert a.rows("runs").total is None                # unfiltered: no count


def test_total_is_null_when_counting_is_slow(sample_db, monkeypatch):
    import dbeef.adapters.sqlite as mod
    conn = sqlite3.connect(sample_db)  # enough rows for the progress handler to fire during COUNT(*)
    conn.executemany("INSERT INTO runs VALUES (?, 'ZZZ', 0, NULL)", ((f"big{i}",) for i in range(50_000)))
    conn.commit()
    conn.close()
    monkeypatch.setattr(mod, "COUNT_BUDGET_S", 0.0)
    r = SqliteAdapter(sample_db).rows("runs", q="ZZZ", limit=5)
    assert len(r.rows) == 5 and r.total is None


def test_describe_marks_primary_key(sample_db):
    f = {x.name: x for x in SqliteAdapter(sample_db).describe("runs").fields}
    assert f["run_id"].pk is True and f["inchikey"].pk is False
    assert f["run_id"].nullable is False and f["inchikey"].nullable is True
