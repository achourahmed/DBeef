from conftest import make_db

from dbeef.config import ProjectConfig
from dbeef.project import Project
from dbeef.schema_map import build_schema_map


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
    # inchikey is already a config link, so it is not suggested again
    assert not any(e.kind == "suggested" and e.label == "inchikey" for e in m.edges)


def test_suggested_edge(tmp_path):
    a = make_db(tmp_path / "a.db", "CREATE TABLE mols(molecule_key TEXT, id INTEGER);")
    b = make_db(tmp_path / "b.db", "CREATE TABLE hits(molecule_key TEXT, id INTEGER);")
    p = Project(ProjectConfig.model_validate({"project": "x", "stores": {
        "a": {"type": "sqlite", "path": str(a)}, "b": {"type": "sqlite", "path": str(b)}}}))
    m = build_schema_map(p)
    assert [e.label for e in m.edges if e.kind == "suggested"] == ["molecule_key"]
    p.close()


def test_statuses_isolate_failures(project):
    st = {s.name: s.status for s in project.statuses()}
    assert st == {"runs": "ok", "roster": "ok", "jobs": "error"}
