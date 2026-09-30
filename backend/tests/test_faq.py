from app import faq_texts as ft

from .conftest import CURATOR, PARENT, case_id_by_scenario, ready_plan, steps_of


def _no_llm(fake_llm):
    def responder(*_a):
        raise AssertionError("LLM must not be called")
    return fake_llm(responder)


def test_faq_case2_by_step(client, fake_llm):
    cid = ready_plan(client, "2")
    f = _no_llm(fake_llm)
    data = client.get(f"/api/faq?case_id={cid}", headers=PARENT).json()
    steps = steps_of(client, cid, PARENT)
    assert {b["service_id"] for b in data["by_step"]} == set(steps)
    assert all(it["q"] and it["a"].strip() for b in data["by_step"] for it in b["items"])
    assert all(it["q"] and it["a"].strip() for it in data["general"])
    tutor = next(b for b in data["by_step"] if b["service_id"] == "EDU_TUTOR")
    locked = next(it for it in tutor["items"] if it["q"] == ft.STEP_QUESTIONS["locked"])
    assert locked["a"] == steps["EDU_TUTOR"]["unlock_hint"]
    pmpk = next(b for b in data["by_step"] if b["service_id"] == "EDU_PMPK")
    assert any(it["q"] == ft.STEP_QUESTIONS["overdue"] for it in pmpk["items"])
    assert f.calls == []


def test_faq_skips_missing_fields(client):
    from app import faq

    step = {"id": 1, "service_id": "X", "title": "T", "status": "todo", "overdue": False, "how_to": "",
            "channel_label": "", "typical_duration": "", "documents": [], "unlock_hint": "", "explanation": ""}
    assert faq.step_items(step, {"description": ""}) == []


def test_faq_general_only(client):
    data = client.get("/api/faq").json()
    assert data["by_step"] == [] and len(data["general"]) == len(ft.GENERAL)


def test_faq_hides_unconfirmed_plan_from_parent(client):
    cid = ready_plan(client, "2", confirm=False)
    assert client.get(f"/api/faq?case_id={cid}", headers=PARENT).json()["by_step"] == []
    assert client.get(f"/api/faq?case_id={cid}", headers=CURATOR).json()["by_step"]


def test_faq_unknown_case_404(client):
    assert client.get("/api/faq?case_id=999").status_code == 404
    assert case_id_by_scenario(client, "1")
