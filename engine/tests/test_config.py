import pytest

from dbeef.config import ConfigError, load_config


def write(tmp_path, text):
    p = tmp_path / "dbeef.yaml"
    p.write_text(text)
    return p


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
    p = write(tmp_path, """
project: demo
stores:
  graph: {type: neo4j, uri: bolt://x, password: "${NOPE_NOT_SET}"}
""")
    with pytest.raises(ConfigError, match="NOPE_NOT_SET"):
        load_config(p)


def test_unknown_link_store(tmp_path):
    p = write(tmp_path, """
project: demo
stores:
  runs: {type: sqlite, path: runs.db}
links:
  - from: {store: ghost, collection: a, field: b}
    to: {store: runs, collection: runs, field: run_id}
""")
    with pytest.raises(ConfigError, match="link #0: unknown store 'ghost'"):
        load_config(p)


def test_bad_store_type(tmp_path):
    p = write(tmp_path, """
project: demo
stores:
  docs: {type: mongo, url: mongodb://x}
""")
    with pytest.raises(ConfigError):
        load_config(p)
