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


# P0: real-data fixes

def test_immutable_flag(tmp_path):
    p = write(tmp_path, """
project: demo
stores:
  chembl: {type: sqlite, path: chembl.db, immutable: true}
  runs: {type: sqlite, path: runs.db}
""")
    cfg = load_config(p)
    assert cfg.stores["chembl"].immutable is True
    assert cfg.stores["runs"].immutable is False


def test_sqlite_path_expands_user(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    p = write(tmp_path, """
project: demo
stores:
  runs: {type: sqlite, path: "~/data/runs.db"}
""")
    assert load_config(p).stores["runs"].path == tmp_path / "data/runs.db"


@pytest.mark.parametrize("text", [
    "project: demo\nstores:\n  g: {type: neo4j, uri: bolt://x, pasword: oops}\n",
    "project: demo\nstores:\n  r: {type: sqlite, path: r.db}\nlinks: []\norigin: {}\n",
    "project: demo\nstores:\n  r: {type: sqlite, path: r.db}\nlinks:\n  - from: {store: r, collection: a, field: b, extra: 1}\n    to: {store: r, collection: a, field: b}\n",
])
def test_unknown_key_is_config_error(tmp_path, text):
    with pytest.raises(ConfigError, match="[Ee]xtra"):
        load_config(write(tmp_path, text))
