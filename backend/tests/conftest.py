import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="aqylroute-test-")
os.environ["DB_PATH"] = os.path.join(_tmp, "test.db")
os.environ["OPENAI_API_KEY"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app import config, db, llm  # noqa: E402
from app.main import app  # noqa: E402

config.OPENAI_API_KEY = ""
CURATOR = {"X-Role": "curator"}
PARENT = {"X-Role": "parent"}


class FakeLLM:
    """Подменный клиент: responder(name, schema, user_input) -> dict | Exception."""

    model = "fake-model"

    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    def structured(self, name, schema, instructions, user_input, model_cls=None):
        self.calls.append({"name": name, "schema": schema, "input": user_input})
        out = self.responder(name, schema, user_input, len(self.calls))
        if isinstance(out, Exception):
            raise out
        return out


@pytest.fixture
def client():
    if os.path.exists(config.DB_PATH):
        os.remove(config.DB_PATH)
    llm.set_llm(None)
    with TestClient(app) as c:
        yield c
    llm.set_llm(None)


@pytest.fixture
def fake_llm():
    def install(responder):
        f = FakeLLM(responder)
        llm.set_llm(f)
        return f

    yield install
    llm.set_llm(None)


def case_id_by_scenario(client, key):
    cases = client.get("/api/curator/cases", headers=CURATOR).json()["cases"]
    return next(c["id"] for c in cases if c["scenario"] == key)


def run_interview(client, case_id, scenario_key):
    from app.catalog import SCENARIOS

    sc = SCENARIOS[scenario_key]
    r = client.post(f"/api/cases/{case_id}/interview/next", json={}, headers=PARENT).json()
    asked = 0
    while not r["done"]:
        q = r["item"]
        asked += 1
        ans = sc["answers"].get(q["topic"], sc["follow_up_answer"])
        r = client.post(f"/api/cases/{case_id}/interview/next", json={"answer": ans}, headers=PARENT).json()
        assert asked <= 12
    return r, asked


__all__ = ["CURATOR", "PARENT", "FakeLLM", "case_id_by_scenario", "run_interview", "db"]
