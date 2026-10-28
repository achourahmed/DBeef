import json
import os
import uuid
from types import SimpleNamespace

import neo4j
import pytest

from dbeef.adapters.base import IntraLink, NotFound, StoreUnavailable, WriteBlocked
from dbeef.adapters.neo4j import Neo4jAdapter

URI = os.environ.get("NEO4J_TEST_URI", "bolt://localhost:7687")
PW = os.environ.get("NEO4J_TEST_PASSWORD", "dbeef-test")

try:
    _probe = neo4j.GraphDatabase.driver(URI, auth=("neo4j", PW))
    _probe.verify_connectivity()
    _probe.close()
except Exception:
    pytest.skip("Neo4j not reachable", allow_module_level=True)


@pytest.fixture
def graph():
    tag = uuid.uuid4().hex[:8]
    drug, target = f"T{tag}Drug", f"T{tag}Target"
    driver = neo4j.GraphDatabase.driver(URI, auth=("neo4j", PW))
    driver.execute_query(
        f"CREATE (a:{drug} {{name: 'aspirin', created: datetime()}}), (:{drug} {{name: 'ibuprofen'}}), "
        f"(t:{target} {{gene: 'PTGS2'}}), (a)-[:BINDS]->(t)")
    yield SimpleNamespace(drug=drug, target=target)
    driver.execute_query(f"MATCH (n) WHERE n:{drug} OR n:{target} DETACH DELETE n")
    driver.close()


@pytest.fixture
def a():
    adapter = Neo4jAdapter(URI, "neo4j", PW)
    yield adapter
    adapter.close()


def test_lists_and_describes(graph, a):
    c = {x.name: x for x in a.list_collections()}
    assert c[graph.drug].count == 2 and c[graph.drug].kind == "label"
    d = a.describe(graph.drug)
    assert IntraLink(from_collection=graph.drug, from_field=None, to_collection=graph.target,
                     to_field=None, label="BINDS") in d.links


def test_sample_json_safe(graph, a):
    r = a.sample(graph.drug)
    assert r.columns[0] == "_id" and len(r.rows) == 2
    json.dumps(r.model_dump(), allow_nan=False)


@pytest.mark.parametrize("cy", ["CREATE (:{d})", "MATCH (n:{d}) SET n.x = 1",
                                "MATCH (n:{d}) DETACH DELETE n"])
def test_writes_blocked(graph, a, cy):
    with pytest.raises(WriteBlocked):
        a.query(cy.format(d=graph.drug))
    assert a.query(f"MATCH (n:{graph.drug}) RETURN count(n) AS c").rows == [[2]]


def test_unknown_label(graph, a):
    with pytest.raises(NotFound):
        a.sample("Nope` RETURN 1 //")


def test_unreachable():
    down = Neo4jAdapter("bolt://127.0.0.1:1", "neo4j", "x")
    with pytest.raises(StoreUnavailable):
        down.ping()
    down.close()


@pytest.mark.parametrize("cy", ["TERMINATE TRANSACTIONS 'neo4j-transaction-1'",
                                "CALL db.resampleOutdatedIndexes()"])
def test_side_effect_statements_blocked(a, cy):
    with pytest.raises(WriteBlocked):
        a.query(cy)
