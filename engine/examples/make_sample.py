"""Write sample.db and roster.db next to this script for trying the engine."""

import sqlite3
import sys
from pathlib import Path

MOLECULES = [
    ("BSYNRYMUTXBXSQ-UHFFFAOYSA-N", "aspirin"),
    ("HEFNNWSXXWATRW-UHFFFAOYSA-N", "ibuprofen"),
    ("RZVAJINKPMORJF-UHFFFAOYSA-N", "paracetamol"),
    ("RYYVLZVUVIJVGH-UHFFFAOYSA-N", "caffeine"),
    ("XZWYZXLIPXDOLR-UHFFFAOYSA-N", "metformin"),
]


def write(path: Path, script: str, rows: dict[str, list[tuple]]) -> None:
    path.unlink(missing_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(script)
    for table, values in rows.items():
        conn.executemany(f"INSERT INTO {table} VALUES ({', '.join('?' * len(values[0]))})", values)
    conn.commit()
    conn.close()


def main(out: Path) -> None:
    runs = [(f"run-{i:03d}", MOLECULES[i % 5][0], f"hyp-{i % 7}", "passed" if i % 3 else "failed")
            for i in range(20)]
    facts = [(r[0], f"C{j}", "supported" if (i + j) % 2 else "refuted") for i, r in enumerate(runs) for j in (1, 2)]
    write(out / "sample.db", """
        CREATE TABLE runs(run_id TEXT PRIMARY KEY, inchikey TEXT, hypothesis_id TEXT, gate_status TEXT);
        CREATE TABLE run_facts(run_id TEXT REFERENCES runs(run_id), assertion_id TEXT, verdict TEXT);
    """, {"runs": runs, "run_facts": facts})
    write(out / "roster.db", "CREATE TABLE roster(inchikey TEXT PRIMARY KEY, pref_name TEXT);",
          {"roster": MOLECULES})
    print(f"wrote {out / 'sample.db'} and {out / 'roster.db'}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent)
