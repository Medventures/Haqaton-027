from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.catalog import SERVICES_BY_ID, TOPIC_IDS
from app.main import app

from .conftest import CURATOR, PARENT, case_id_by_scenario, run_interview

STEP_FIELDS = {"priority", "owner", "due_date", "documents", "status", "explanation", "service_id", "title",
               "agency", "domain", "blocker", "blocker_note", "days_overdue", "overdue"}


def test_health(client):
    r = client.get("/api/health").json()
    assert r["status"] == "ok" and r["llm_mode"] == "mock"


def test_create_case_validation(client):
    ok = client.post("/api/cases", json={"child_alias": "Семья В", "birth_date": "2021-01-01", "city": "Астана", "language": "kk"}, headers=PARENT)
    assert ok.status_code == 201
    v = ok.json()
    assert v["status"] == "draft" and v["language"] == "kk"
    assert "age_city" in v["interview"]["covered_topics"]
    assert client.post("/api/cases", json={"child_alias": "X", "city": "Астана"}, headers=PARENT).status_code == 400
    future = (date.today() + timedelta(days=5)).isoformat()
    assert client.post("/api/cases", json={"child_alias": "X", "birth_date": future, "city": "Астана"}, headers=PARENT).status_code == 400
    assert client.post("/api/cases", json={"child_alias": "X", "birth_date": "2000-01-01", "city": "Астана"}, headers=PARENT).status_code == 400
    assert client.post("/api/cases", json={"child_alias": "X", "birth_date": "2021-01-01", "city": "Астана", "language": "en"}, headers=PARENT).status_code == 422


def test_parent_lists_only_demo_cases(client):
    client.post("/api/cases", json={"child_alias": "Чужая семья", "birth_date": "2021-01-01", "city": "Астана"}, headers=PARENT)
    parent = [c["child_alias"] for c in client.get("/api/cases", headers=PARENT).json()["cases"]]
    curator = [c["child_alias"] for c in client.get("/api/curator/cases", headers=CURATOR).json()["cases"]]
    assert "Чужая семья" not in parent and "Чужая семья" in curator
    assert client.get("/api/curator/cases", headers=PARENT).status_code == 403


def test_interview_is_adaptive_second_questions_differ(client):
    second = {}
    for key in ("A", "B"):
        cid = case_id_by_scenario(client, key)
        r, asked = run_interview(client, cid, key)
        assert r["done"] and 8 <= asked <= 12
        assert set(r["progress"]["covered_topics"]) == set(TOPIC_IDS)
        second[key] = r["interview"]["items"][1]["question"]
    assert second["A"] != second["B"]


def test_two_synthetic_cases_full_path(client):
    for key in ("A", "B"):
        cid = case_id_by_scenario(client, key)
        run_interview(client, cid, key)

        plan = client.post(f"/api/cases/{cid}/plan/generate", headers=PARENT)
        assert plan.status_code == 200
        assert plan.json()["status"] == "awaiting_curator"
        # Родитель не видит неподтверждённый план.
        assert plan.json()["steps"] == []
        pv = client.get(f"/api/cases/{cid}", headers=PARENT).json()
        assert pv["plan_visible"] is False and pv["steps"] == []

        draft = client.get(f"/api/cases/{cid}", headers=CURATOR).json()
        assert len(draft["steps"]) >= 5
        for s in draft["steps"]:
            assert STEP_FIELDS <= s.keys()
            assert s["service_id"] in SERVICES_BY_ID
            assert s["priority"] in ("high", "medium", "low")
            assert s["status"] == "todo"
            assert s["documents"] and all(d["have"] is False and d["name"] for d in s["documents"])
        ids = [s["service_id"] for s in draft["steps"]]
        assert len(ids) == len(set(ids))
        assert {"case_intake", "single_doc_package"} <= set(ids)

        assert client.post(f"/api/cases/{cid}/plan/confirm", headers=PARENT).status_code == 403
        assert client.post(f"/api/cases/{cid}/plan/confirm", headers=CURATOR).json()["status"] == "confirmed"

        pv = client.get(f"/api/cases/{cid}", headers=PARENT).json()
        assert pv["plan_visible"] is True and len(pv["steps"]) == len(draft["steps"])
        assert all("escalated" not in s for s in pv["steps"])

        # Родитель меняет статус шага.
        sid = pv["steps"][0]["id"]
        r = client.patch(f"/api/steps/{sid}", json={"status": "in_progress"}, headers=PARENT).json()
        assert r["status"] == "in_progress"
        r = client.patch(f"/api/steps/{sid}", json={"status": "done"}, headers=PARENT).json()
        assert r["status"] == "done" and r["completed_at"]

        audit = [a["action"] for a in client.get(f"/api/cases/{cid}/audit", headers=CURATOR).json()["items"]]
        assert "plan_confirmed" in audit and "case_created" in audit


def test_age_and_city_rules(client):
    plans = {}
    for key in ("A", "B"):
        cid = case_id_by_scenario(client, key)
        client.post(f"/api/cases/{cid}/interview/autofill", headers=PARENT)
        client.post(f"/api/cases/{cid}/plan/generate", headers=CURATOR)
        plans[key] = {s["service_id"]: s for s in client.get(f"/api/cases/{cid}", headers=CURATOR).json()["steps"]}
    # 4 года: сад, без школы; 8 лет: школа, без сада.
    assert "inclusive_kindergarten" in plans["A"] and "school_support" not in plans["A"]
    assert "school_support" in plans["B"] and "inclusive_kindergarten" not in plans["B"]
    assert "specialist_consultation" in plans["A"] and "specialist_consultation" not in plans["B"]
    # Социального такси нет в Караганде → шаг остаётся с блокером.
    assert plans["B"]["social_taxi"]["blocker"] == "no_service_in_region"
    assert plans["A"]["social_taxi"]["blocker"] is None


def test_generate_requires_finished_interview(client):
    cid = case_id_by_scenario(client, "A")
    assert client.post(f"/api/cases/{cid}/plan/generate", headers=CURATOR).status_code == 409


def test_autofill_and_reload(client):
    cid = case_id_by_scenario(client, "B")
    q1 = client.post(f"/api/cases/{cid}/interview/next", json={}, headers=PARENT).json()
    q2 = client.post(f"/api/cases/{cid}/interview/next", json={}, headers=PARENT).json()
    assert q1["item"] == q2["item"] and q1["question"] and q1["progress"]["asked"] == 1
    assert client.post(f"/api/cases/{cid}/interview/next", json={"answer": ""}, headers=PARENT).status_code == 400
    client.post(f"/api/cases/{cid}/interview/next", json={"answer": q1["options"][0]}, headers=PARENT)
    r = client.post(f"/api/cases/{cid}/interview/autofill", headers=PARENT).json()
    assert r["done"] and r["progress"]["open_topics"] == []
    assert 8 <= r["progress"]["answered"] <= 12


def _confirmed_case(client, key="A"):
    cid = case_id_by_scenario(client, key)
    client.post(f"/api/cases/{cid}/interview/autofill", headers=PARENT)
    client.post(f"/api/cases/{cid}/plan/generate", headers=CURATOR)
    client.post(f"/api/cases/{cid}/plan/confirm", headers=CURATOR)
    return cid


def test_overdue_and_escalation_after_shifting_demo_today(client):
    _confirmed_case(client)
    assert client.get("/api/curator/overdue", headers=CURATOR).json()["overdue_count"] == 0

    # case_intake: срок 3 дня. +10 дней => просрочка 7 дней > 3 => эскалация.
    assert client.post("/api/settings/demo-today", json={"shift_days": 10}, headers=PARENT).status_code == 403
    client.post("/api/settings/demo-today", json={"shift_days": 10}, headers=CURATOR)
    r = client.get("/api/curator/overdue", headers=CURATOR).json()
    assert r["overdue_count"] > 0 and r["escalated_count"] > 0
    esc = next(s for s in r["items"] if s["service_id"] == "case_intake")
    assert esc["days_overdue"] == 7 and esc["escalated"]
    assert esc["agency"] == "соцзащита" and esc["reason"]
    assert esc["notification"]["sent"] is False and "Семья А" in esc["notification"]["body"]
    assert client.get("/api/curator/overdue", headers=PARENT).status_code == 403

    # Выполненный шаг не считается просроченным.
    client.patch(f"/api/steps/{esc['id']}", json={"status": "done"}, headers=PARENT)
    assert all(s["id"] != esc["id"] for s in client.get("/api/curator/overdue", headers=CURATOR).json()["items"])

    # Сброс на реальную дату (date=null), затем порог: эскалация только при просрочке > 3 дней.
    reset = client.post("/api/settings/demo-today", json={"date": None}, headers=CURATOR).json()
    assert reset["demo_today"] is None and reset["today"] == date.today().isoformat()
    client.post("/api/settings/demo-today", json={"shift_days": 5}, headers=CURATOR)
    for s in client.get("/api/curator/overdue", headers=CURATOR).json()["items"]:
        assert s["escalated"] == (s["days_overdue"] > 3)


def test_curator_edits_plan(client):
    cid = case_id_by_scenario(client, "B")
    client.post(f"/api/cases/{cid}/interview/autofill", headers=PARENT)
    view = client.post(f"/api/cases/{cid}/plan/generate", headers=CURATOR).json()
    steps = {s["service_id"]: s for s in view["steps"]}

    # Приоритет меняется, срок — нет: due_date = дата плана + default_deadline_days (spec v2).
    pmpk = steps["pmpk"]
    base = date.fromisoformat(view["plan_meta"]["base_date"])
    assert pmpk["due_date"] == (base + timedelta(days=SERVICES_BY_ID["pmpk"]["default_deadline_days"])).isoformat()
    low = client.patch(f"/api/steps/{pmpk['id']}", json={"priority": "low"}, headers=CURATOR).json()
    assert low["priority"] == "low" and low["due_date"] == pmpk["due_date"]

    # Удалить и добавить шаг — только из справочника.
    after_del = client.delete(f"/api/steps/{steps['parent_support']['id']}", headers=CURATOR).json()
    assert "parent_support" not in {s["service_id"] for s in after_del["steps"]}
    assert [s["position"] for s in after_del["steps"]] == list(range(1, len(after_del["steps"]) + 1))
    assert client.post(f"/api/cases/{cid}/steps", json={"service_id": "made_up"}, headers=CURATOR).status_code == 400
    assert client.post(f"/api/cases/{cid}/steps", json={"service_id": "pmpk"}, headers=CURATOR).status_code == 409
    added = client.post(f"/api/cases/{cid}/steps", json={"service_id": "home_schooling", "priority": "low"}, headers=CURATOR).json()
    assert added["steps"][-1]["service_id"] == "home_schooling"
    assert client.post(f"/api/cases/{cid}/steps", json={"service_id": "pmpk"}, headers=PARENT).status_code == 403

    # Родитель не может править неподтверждённый план.
    assert client.patch(f"/api/steps/{pmpk['id']}", json={"status": "done"}, headers=PARENT).status_code == 404


def test_blockers_and_documents(client):
    cid = _confirmed_case(client, "A")
    steps = client.get(f"/api/cases/{cid}", headers=PARENT).json()["steps"]
    intake = next(s for s in steps if s["service_id"] == "case_intake")

    # Родитель ставит блокер и отмечает документ; отметка документа синхронизируется во всех шагах.
    r = client.patch(f"/api/steps/{intake['id']}", json={"blocker": "missing_document", "blocker_note": "Нет справки"}, headers=PARENT).json()
    assert r["blocker"] == "missing_document" and r["blocker_note"] == "Нет справки"
    client.patch(f"/api/steps/{intake['id']}", json={"documents": [{"name": "Свидетельство о рождении ребёнка", "have": True}]}, headers=PARENT)
    after = client.get(f"/api/cases/{cid}", headers=CURATOR).json()
    for s in after["steps"]:
        for d in s["documents"]:
            if d["name"] == "Свидетельство о рождении ребёнка":
                assert d["have"] is True
    assert after["blockers"] >= 1
    listed = next(c for c in client.get("/api/curator/cases", headers=CURATOR).json()["cases"] if c["id"] == cid)
    assert listed["blockers"] >= 1
    blocked = client.get("/api/curator/overdue", headers=CURATOR).json()["blocked"]
    assert any(s["id"] == intake["id"] for s in blocked)

    # Снять блокер.
    r = client.patch(f"/api/steps/{intake['id']}", json={"blocker": None}, headers=CURATOR).json()
    assert r["blocker"] is None and r["blocker_note"] == ""
    # Родителю нельзя менять приоритет и заметку куратора.
    assert client.patch(f"/api/steps/{intake['id']}", json={"priority": "low"}, headers=PARENT).status_code == 403
    assert client.patch(f"/api/steps/{intake['id']}", json={"curator_note": "x"}, headers=PARENT).status_code == 403
    assert client.patch(f"/api/steps/{intake['id']}", json={"blocker": "unknown"}, headers=PARENT).status_code == 422


def test_statuses_survive_restart(client):
    cid = _confirmed_case(client, "B")
    steps = client.get(f"/api/cases/{cid}", headers=CURATOR).json()["steps"]
    client.patch(f"/api/steps/{steps[0]['id']}", json={"status": "done"}, headers=CURATOR)
    client.patch(f"/api/steps/{steps[1]['id']}", json={"status": "in_progress", "curator_note": "ok"}, headers=CURATOR)
    client.post("/api/settings/demo-today", json={"shift_days": 20}, headers=CURATOR)

    with TestClient(app) as c2:  # новый старт приложения на той же SQLite
        after = c2.get(f"/api/cases/{cid}", headers=CURATOR).json()
        assert after["status"] == "confirmed"
        assert after["steps"][0]["status"] == "done"
        assert after["steps"][1]["status"] == "in_progress" and after["steps"][1]["curator_note"] == "ok"
        assert any(s["escalated"] for s in after["steps"])


def test_demo_reset(client):
    _confirmed_case(client)
    client.post("/api/demo/reset", headers=CURATOR)
    cases = client.get("/api/curator/cases", headers=CURATOR).json()["cases"]
    assert sorted(c["child_alias"] for c in cases) == ["Семья А", "Семья Б"]
    assert all(c["status"] == "draft" for c in cases)
    assert client.get("/api/settings").json()["demo_today"] is None
