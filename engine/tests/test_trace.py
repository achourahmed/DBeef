import pytest

from dbeef.config import ConfigError, StoreRef, load_config
from dbeef.project import Project
from dbeef.trace import trace

ASPIRIN = "BSYNRYMUTXBXSQ-UHFFFAOYSA-N"


def test_origins_validated_like_links(tmp_path):
    (tmp_path / "c.yaml").write_text("""
project: demo
stores:
  runs: {type: sqlite, path: runs.db}
origins:
  inchikey: {store: ghost, collection: roster, field: inchikey}
""")
    with pytest.raises(ConfigError, match="origin 'inchikey': unknown store 'ghost'"):
        load_config(tmp_path / "c.yaml")


def test_trace_finds_value_in_every_store(project):
    project.config.origins = {"inchikey": StoreRef(store="roster", collection="roster", field="inchikey")}
    t = trace(project, ASPIRIN)
    assert t.value == ASPIRIN
    hits = {(h.store, h.collection, h.field): h for h in t.hits}
    assert ("runs", "runs", "inchikey") in hits and ("roster", "roster", "inchikey") in hits
    assert hits[("roster", "roster", "inchikey")].is_origin is True
    assert hits[("runs", "runs", "inchikey")].is_origin is False
    assert hits[("runs", "runs", "inchikey")].rows.rows[0][0] == "r1"
    # the Redis store is down: reported once, the other lanes still come back
    assert [e.name for e in t.errors] == ["jobs"]
    # a missing field at one endpoint (roster.hyp) is skipped, not an error
    assert not any(h.field == "hyp" for h in t.hits)


def test_trace_restricts_to_a_field(project):
    t = trace(project, "h1", field="hypothesis_id")
    assert [(h.store, h.collection) for h in t.hits] == [("runs", "runs")]
    assert trace(project, "nothing-here").hits == []
