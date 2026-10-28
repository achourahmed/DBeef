import json
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from conftest import make_db

from dbeef.__main__ import main, parse_args

ENGINE_DIR = Path(__file__).resolve().parents[1]


def test_parse_args_requires_config():
    with pytest.raises(SystemExit):
        parse_args([])


def test_bad_config_exits_2(tmp_path, capsys):
    (tmp_path / "bad.yaml").write_text("project: x\nstores: {}\n")
    assert main(["--config", str(tmp_path / "bad.yaml")]) == 2
    assert "bad.yaml" in capsys.readouterr().err


def test_duplicate_project_exits_2(tmp_path, capsys):
    make_db(tmp_path / "a.db", "CREATE TABLE t(x);")
    for name in ("one.yaml", "two.yaml"):
        (tmp_path / name).write_text("project: same\nstores:\n  a: {type: sqlite, path: a.db}\n")
    assert main(["--config", str(tmp_path / "one.yaml"), "--config", str(tmp_path / "two.yaml")]) == 2
    assert "same" in capsys.readouterr().err


def test_handshake_line(tmp_path):
    make_db(tmp_path / "sample.db", "CREATE TABLE runs(run_id TEXT);")
    cfg = tmp_path / "dbeef.yaml"
    cfg.write_text("project: sample\nstores:\n  runs: {type: sqlite, path: sample.db}\n")
    p = subprocess.Popen([sys.executable, "-m", "dbeef", "--config", str(cfg), "--dev-token", "t"],
                         stdout=subprocess.PIPE, text=True, cwd=ENGINE_DIR)
    try:
        hs = json.loads(p.stdout.readline())
        assert hs["token"] == "t" and hs["port"] > 0
        r = httpx.get(f"http://127.0.0.1:{hs['port']}/api/projects", headers={"X-DBeef-Token": "t"})
        assert r.json() == [{"name": "sample"}]
        assert httpx.get(f"http://127.0.0.1:{hs['port']}/").status_code == 200
    finally:
        p.terminate()
        p.wait(timeout=10)
