"""Time the SQLite adapter on a large file: python -m scripts.bench [rows=5_000_000] (from engine/)."""

import sqlite3
import sys
import tempfile
import time
from pathlib import Path

from dbeef.adapters.sqlite import SqliteAdapter


def main(rows: int) -> None:
    path = Path(tempfile.mkdtemp()) / "bench.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE runs(run_id TEXT PRIMARY KEY, inchikey TEXT, score REAL, note TEXT);
        CREATE TABLE facts(run_id TEXT REFERENCES runs(run_id), verdict TEXT);
        CREATE TABLE norowid(k TEXT PRIMARY KEY, v INTEGER) WITHOUT ROWID;
    """)
    t = time.perf_counter()
    for start in range(0, rows, 100_000):
        conn.executemany("INSERT INTO runs VALUES (?, ?, ?, ?)",
                         ((f"run-{i:09d}", f"KEY{i % 97:05d}-UHFFFAOYSA-N", i / 7, "x" * 40)
                          for i in range(start, min(start + 100_000, rows))))
    conn.executemany("INSERT INTO norowid VALUES (?, ?)", ((f"k{i}", i) for i in range(rows // 10)))
    conn.commit()
    conn.close()
    print(f"built {rows:,} rows in {time.perf_counter() - t:.1f}s ({path.stat().st_size / 1e6:.0f} MB)")

    a = SqliteAdapter(path)
    for label, fn in [
        ("list_collections", a.list_collections),
        ("describe", lambda: a.describe("runs")),
        ("sample", lambda: a.sample("runs")),
        ("LIKE query", lambda: a.query("SELECT * FROM runs WHERE inchikey LIKE 'KEY00042%'")),
        ("COUNT(*)", lambda: a.query("SELECT COUNT(*) FROM runs")),
    ]:
        t = time.perf_counter()
        try:
            fn()
            print(f"{label:18} {time.perf_counter() - t:7.3f}s")
        except Exception as e:  # keep timing the rest
            print(f"{label:18} {time.perf_counter() - t:7.3f}s  {type(e).__name__}: {e}")
    path.unlink()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 5_000_000)
