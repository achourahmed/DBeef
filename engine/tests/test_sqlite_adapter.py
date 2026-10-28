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
    r = SqliteAdapter(sample_db).sample("runs", limit=2)
    assert len(r.rows) == 2 and r.truncated is True
    json.dumps(SqliteAdapter(sample_db).sample("runs").model_dump(), allow_nan=False)


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
    assert len(a.sample("runs").rows) == 3


def test_sample_and_describe_do_not_count(sample_db):
    a = SqliteAdapter(sample_db)
    seen = []
    a._connect().set_trace_callback(seen.append)
    a.sample("runs")
    a.describe("run_facts")
    assert not any("COUNT(" in s.upper() for s in seen)
