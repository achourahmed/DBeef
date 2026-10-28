import sqlite3

import pytest

from dbeef.config import ProjectConfig
from dbeef.project import Project


def make_db(path, script):
    conn = sqlite3.connect(path)
    conn.executescript(script)
    conn.commit()
    conn.close()
    return path


@pytest.fixture
def project(tmp_path):
    runs = make_db(tmp_path / "runs.db", """
        CREATE TABLE runs(run_id TEXT PRIMARY KEY, inchikey TEXT, hypothesis_id TEXT);
        CREATE TABLE run_facts(run_id TEXT REFERENCES runs(run_id), verdict TEXT);
        INSERT INTO runs VALUES ('r1', 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N', 'h1'), ('r2', 'XEFQLINVKFYRCS-UHFFFAOYSA-N', 'h2');
    """)
    roster = make_db(tmp_path / "roster.db", """
        CREATE TABLE roster(inchikey TEXT, pref_name TEXT);
        INSERT INTO roster VALUES ('BSYNRYMUTXBXSQ-UHFFFAOYSA-N', 'aspirin');
    """)
    cfg = ProjectConfig.model_validate({
        "project": "demo",
        "stores": {
            "runs": {"type": "sqlite", "path": str(runs)},
            "roster": {"type": "sqlite", "path": str(roster)},
            "jobs": {"type": "redis", "url": "redis://127.0.0.1:1"},
        },
        "links": [
            {"from": {"store": "runs", "collection": "runs", "field": "inchikey"},
             "to": {"store": "roster", "collection": "roster", "field": "inchikey"}},
            {"from": {"store": "runs", "collection": "runs", "field": "hypothesis_id"},
             "to": {"store": "roster", "collection": "roster", "field": "hyp"}},
            {"from": {"store": "jobs", "collection": "rq:job:*", "field": "$key"},
             "to": {"store": "runs", "collection": "runs", "field": "run_id"}},
        ],
    })
    p = Project(cfg)
    yield p
    p.close()
