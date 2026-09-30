from app import urgent_texts as ut

from .conftest import CURATOR, PARENT, case_id_by_scenario, ready_plan


def _llm_forbidden(fake_llm):
    """Any LLM call fails the test: the urgent flow must work on fixed texts only."""
    def responder(*_a):
        raise AssertionError("LLM must not be called in the urgent flow")
    return fake_llm(responder)


def _urgent_notes(client, cid):
    items = client.get("/api/curator/notifications", headers=CURATOR).json()["items"]
    return [n for n in items if n["case_id"] == cid and n["kind"]]


def test_urgent_safety_sets_alert_and_notifies_curator(client, fake_llm):
    cid = ready_plan(client, "2")
    f = _llm_forbidden(fake_llm)
    r = client.post(f"/api/cases/{cid}/urgent", json={"kind": "safety"}, headers=PARENT)
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == ut.TEXTS["safety"] and body["curator_notified"] is True
    assert "112" in body["top_text"] and "103" in body["top_text"]
    assert client.get(f"/api/cases/{cid}", headers=CURATOR).json()["alert"] is True
    notes = _urgent_notes(client, cid)
    assert [(n["type"], n["audience"], n["kind"]) for n in notes] == [("red_flag", "curator", "safety")]
    audit = client.get(f"/api/cases/{cid}/audit", headers=CURATOR).json()["items"]
    assert any(a["action"] == "urgent:safety" for a in audit)
    assert f.calls == []


def test_urgent_regression_sets_alert(client):
    cid = case_id_by_scenario(client, "3")
    client.post(f"/api/cases/{cid}/urgent", json={"kind": "regression"}, headers=PARENT)
    assert client.get(f"/api/cases/{cid}", headers=CURATOR).json()["alert"] is True


def test_urgent_need_help_notifies_without_alert(client):
    cid = case_id_by_scenario(client, "3")
    r = client.post(f"/api/cases/{cid}/urgent", json={"kind": "need_help"}, headers=PARENT).json()
    assert r["text"] == ut.TEXTS["need_help"]
    assert client.get(f"/api/cases/{cid}", headers=CURATOR).json()["alert"] is False
    assert [n["kind"] for n in _urgent_notes(client, cid)] == ["need_help"]


def test_urgent_same_day_no_duplicate(client):
    cid = case_id_by_scenario(client, "2")
    for _ in range(3):
        client.post(f"/api/cases/{cid}/urgent", json={"kind": "safety"}, headers=PARENT)
    assert len(_urgent_notes(client, cid)) == 1
    # Next (demo) day — a new notification.
    client.post("/api/settings/demo-today", json={"shift_days": 1}, headers=CURATOR)
    client.post(f"/api/cases/{cid}/urgent", json={"kind": "safety"}, headers=PARENT)
    assert len(_urgent_notes(client, cid)) == 2


def test_urgent_resolve_clears_alert(client):
    cid = case_id_by_scenario(client, "2")
    client.post(f"/api/cases/{cid}/urgent", json={"kind": "safety"}, headers=PARENT)
    assert client.post(f"/api/cases/{cid}/urgent/resolve", headers=PARENT).status_code == 403
    assert client.post(f"/api/cases/{cid}/urgent/resolve", headers=CURATOR).status_code == 200
    assert client.get(f"/api/cases/{cid}", headers=CURATOR).json()["alert"] is False
    assert all(n["read"] for n in _urgent_notes(client, cid))
    audit = client.get(f"/api/cases/{cid}/audit", headers=CURATOR).json()["items"]
    assert any(a["action"] == "urgent_resolved" for a in audit)


def test_urgent_note_truncated(client):
    cid = case_id_by_scenario(client, "2")
    long_note = "а" * 450
    client.post(f"/api/cases/{cid}/urgent", json={"kind": "need_help", "note": long_note}, headers=PARENT)
    msg = _urgent_notes(client, cid)[0]["message"]
    assert "а" * ut.NOTE_MAX in msg and "а" * (ut.NOTE_MAX + 1) not in msg


def test_urgent_unknown_kind_422(client):
    cid = case_id_by_scenario(client, "2")
    assert client.post(f"/api/cases/{cid}/urgent", json={"kind": "panic"}, headers=PARENT).status_code == 422


def test_urgent_nearest_step(client):
    cid = ready_plan(client, "2")
    r = client.post(f"/api/cases/{cid}/urgent", json={"kind": "benefit_stopped"}, headers=PARENT).json()
    step = r["nearest_step"]
    # Both steps are high and overdue: the one overdue longest (PMPK) comes first; escalation is not shown to parents.
    assert step["title"] == "Обследование на ПМПК" and step["indicator"] == "overdue"
    # Before the curator confirms a plan the family sees no steps.
    cid3 = case_id_by_scenario(client, "3")
    assert client.post(f"/api/cases/{cid3}/urgent", json={"kind": "need_help"}, headers=PARENT).json()["nearest_step"] is None


def test_urgent_alert_survives_interview_answer(client):
    cid = case_id_by_scenario(client, "2")
    client.post(f"/api/cases/{cid}/interview/next", json={}, headers=PARENT)
    client.post(f"/api/cases/{cid}/urgent", json={"kind": "safety"}, headers=PARENT)
    q = client.post(f"/api/cases/{cid}/interview/next", json={}, headers=PARENT).json()
    client.post(f"/api/cases/{cid}/interview/next", json={"answer": q["options"][0] if q["options"] else "Текст"}, headers=PARENT)
    assert client.get(f"/api/cases/{cid}", headers=CURATOR).json()["alert"] is True
