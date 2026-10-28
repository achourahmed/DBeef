import pytest
from fastapi.testclient import TestClient

from dbeef.api import create_app

H = {"X-DBeef-Token": "t"}


@pytest.fixture
def client(project):
    return TestClient(create_app({"demo": project}, token="t", allow_origins=[]))


def test_token_required(client):
    r = client.get("/api/projects")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
    assert client.get("/api/projects", headers={"X-DBeef-Token": "wrong"}).status_code == 401


def test_browse(client):
    assert client.get("/api/projects", headers=H).json() == [{"name": "demo"}]
    st = {s["name"]: s["status"] for s in client.get("/api/projects/demo/stores", headers=H).json()}
    assert st["jobs"] == "error" and st["runs"] == "ok"
    rows = client.get("/api/projects/demo/stores/runs/collections/runs/rows?limit=1", headers=H).json()
    assert len(rows["rows"]) == 1
    d = client.get("/api/projects/demo/stores/runs/collections/run_facts", headers=H).json()
    assert d["links"][0]["to_collection"] == "runs"


def test_query_write_blocked(client):
    r = client.post("/api/projects/demo/stores/runs/query", headers=H, json={"text": "DELETE FROM runs"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "write_blocked"
    ok = client.post("/api/projects/demo/stores/runs/query", headers=H, json={"text": "SELECT COUNT(*) FROM runs"})
    assert ok.json()["rows"] == [[2]]


def test_errors(client):
    assert client.get("/api/projects/nope/stores", headers=H).status_code == 404
    r = client.get("/api/projects/demo/stores/jobs/collections", headers=H)
    assert r.status_code == 503 and r.json()["error"]["code"] == "store_unavailable"
    assert client.get("/api/projects/demo/stores/runs/collections/ghost", headers=H).status_code == 404
    bad = client.post("/api/projects/demo/stores/runs/query", headers=H, json={"text": "SELEC 1"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "bad_query"


def test_schema_map_and_openapi(client):
    m = client.get("/api/projects/demo/schema-map", headers=H).json()
    assert any(e["kind"] == "cross" and e["from"] == "runs/runs" for e in m["edges"])
    assert "/api/projects/{p}/schema-map" in client.get("/openapi.json").json()["paths"]


def test_cors_preflight(project):
    c = TestClient(create_app({"demo": project}, token="t", allow_origins=["tauri://localhost"]))
    r = c.options("/api/projects", headers={"Origin": "tauri://localhost",
                  "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "X-DBeef-Token"})
    assert r.headers["access-control-allow-origin"] == "tauri://localhost"


def test_error_contract_everywhere(client):
    r = client.get("/api/nope", headers=H)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = client.get("/api/projects", headers={"X-DBeef-Token": "é".encode("latin-1")})
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"


def test_openapi_documents_error_body(client):
    op = client.get("/openapi.json").json()["paths"]["/api/projects/{p}/stores/{s}/query"]["post"]
    assert "422" not in op["responses"]
    assert "ErrorBody" in op["responses"]["403"]["content"]["application/json"]["schema"]["$ref"]
