"""Приёмка v2.1 / v2.2: три эталонных кейса, блокировки, сроки, уведомления, папка документов."""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app

from .conftest import CURATOR, PARENT, case_id_by_scenario, ready_plan, run_interview, steps_of


def test_interview_counts(client):
    counts = {}
    for key in ("1", "2", "3"):
        _, asked = run_interview(client, case_id_by_scenario(client, key), key)
        counts[key] = asked
    assert counts["1"] == ["2", "6", "7", "8", "9", "10", "11", "12"]
    assert counts["2"] == ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]
    assert counts["3"] == ["1", "2", "3", "4", "6", "7", "8", "9", "10", "11", "12"]
    assert [len(counts[k]) for k in ("1", "2", "3")] == [8, 11, 11]


def test_stage_labels(client):
    stages = {c["scenario"]: c["stage"] for c in client.get("/api/curator/cases", headers=CURATOR).json()["cases"]}
    assert stages == {"1": "early", "2": "socialization", "3": "correction"}


def test_case1_plan_exact(client):
    cid = ready_plan(client, "1")
    steps = steps_of(client, cid)
    assert set(steps) == {"MED_PEDIATRICIAN", "MED_MCHAT"}
    ped, mchat = steps["MED_PEDIATRICIAN"], steps["MED_MCHAT"]
    assert ped["status"] == "todo" and ped["priority"] == "high"
    assert mchat["status"] == "locked" and mchat["depends_on"] == ["MED_PEDIATRICIAN"]
    assert mchat["priority"] != "high" and mchat["due_date"] == "2027-09-30"
    assert mchat["unlock_hint"] == "после консультации педиатра, скрининг возможен до 2027-09-30"
    assert not any(s["overdue"] for s in steps.values())
    assert [s for s in steps.values() if s["status"] != "locked"] == [ped]


def test_case2_plan_exact(client):
    cid = ready_plan(client, "2")
    steps = steps_of(client, cid)
    assert set(steps) == {"EDU_PMPK", "SOC_MSE_REEXAM", "EDU_TUTOR"}
    pmpk, mse, tutor = steps["EDU_PMPK"], steps["SOC_MSE_REEXAM"], steps["EDU_TUTOR"]
    assert pmpk["status"] == "todo" and pmpk["priority"] == "high" and pmpk["overdue"] and pmpk["escalated"]
    assert mse["status"] == "todo" and mse["priority"] == "high" and mse["escalated"]
    assert mse["due_date"] == "2026-01-30" and mse["days_overdue"] == 243 and mse["indicator"] == "escalated"
    assert tutor["status"] == "locked" and tutor["depends_on"] == ["EDU_PMPK"] and not tutor["overdue"]
    types = {(n["type"], n["step_id"]) for n in client.get("/api/curator/notifications", headers=CURATOR).json()["items"]}
    assert ("escalation", mse["id"]) in types and ("escalation", pmpk["id"]) in types


def test_lock_unlock(client):
    cid = ready_plan(client, "2")
    steps = steps_of(client, cid)
    tutor = steps["EDU_TUTOR"]
    # Заблокированный шаг нельзя выполнить.
    assert client.patch(f"/api/steps/{tutor['id']}", json={"status": "done"}, headers=CURATOR).status_code == 409
    client.patch(f"/api/steps/{steps['EDU_PMPK']['id']}", json={"status": "done"}, headers=PARENT)
    after = steps_of(client, cid)
    today = date.fromisoformat(client.get("/api/settings").json()["today"])
    assert after["EDU_TUTOR"]["status"] == "todo" and after["EDU_TUTOR"]["priority"] == "high"
    assert after["EDU_TUTOR"]["due_date"] == (today + timedelta(days=30)).isoformat()
    notes = client.get("/api/curator/notifications", headers=CURATOR).json()["items"]
    assert any(n["type"] == "unlocked" and n["step_id"] == tutor["id"] for n in notes)
    # ПМПК выполнена → заключение ПМПК появилось в папке, у тьютора документ есть.
    assert all(d["have"] for d in after["EDU_TUTOR"]["documents"])


def test_case3_locked_before_lead(client):
    cid = ready_plan(client, "3")
    steps = steps_of(client, cid)
    assert list(steps) == ["SOC_MSE_REEXAM"]
    s = steps["SOC_MSE_REEXAM"]
    assert s["status"] == "locked" and s["priority"] is None
    assert s["due_date"] == "2026-11-10" and s["unlock_date"] == "2026-10-11"
    assert s["unlock_hint"] == "станет срочным с 2026-10-11, за 30 дней до окончания справки"
    assert not s["overdue"] and s["indicator"] == "locked"


def test_case3_due_soon_after_shift(client):
    cid = ready_plan(client, "3")
    client.post("/api/settings/demo-today", json={"shift_days": 14}, headers=CURATOR)
    for _ in range(3):  # повторное чтение не создаёт дубликатов
        s = steps_of(client, cid)["SOC_MSE_REEXAM"]
        client.get("/api/curator/notifications", headers=CURATOR)
    assert client.get("/api/settings").json()["today"] == "2026-10-14"
    assert s["status"] == "todo" and s["priority"] == "high" and s["due_soon"] and s["days_to_due"] == 27
    assert s["indicator"] == "due_soon"
    notes = client.get("/api/curator/notifications", headers=CURATOR).json()["items"]
    parent_notes = client.get(f"/api/cases/{cid}", headers=PARENT).json()["notifications"]
    mine = [n for n in notes if n["case_id"] == cid]
    assert [(n["type"], n["audience"]) for n in mine] == [("due_soon", "curator")]
    assert [(n["type"], n["audience"]) for n in parent_notes] == [("due_soon", "parent")]
    assert parent_notes[0]["message"] == "Срок справки МСЭ истекает 10.11.2026: соберите документы"
    # Дату вернули — шаг снова «предстоящий».
    client.post("/api/settings/demo-today", json={"date": "2026-09-30"}, headers=CURATOR)
    assert steps_of(client, cid)["SOC_MSE_REEXAM"]["status"] == "locked"


def test_case3_help_checklist(client):
    cid = ready_plan(client, "3")
    client.post("/api/settings/demo-today", json={"shift_days": 14}, headers=CURATOR)
    s = steps_of(client, cid)["SOC_MSE_REEXAM"]
    help_ = client.get(f"/api/steps/{s['id']}/help", headers=PARENT).json()
    missing = {d["doc_type"] for d in help_["checklist"]}
    assert missing == {"PSYCH_FRESH", "NEURO_CONSULT", "DYNAMICS_REPORT", "IPR_UPDATED", "INSTITUTION_REPORT", "VKK_031"}
    assert "PMPK_CONCLUSION" in {d["doc_type"] for d in help_["have"]}
    assert "Анализы — по запросу комиссии" in help_["notes"]
    assert "eGov" in help_["what_to_do"] and help_["family_message"]
    # Отмеченный документ исчезает из чек-листа.
    client.patch(f"/api/cases/{cid}/documents/PSYCH_FRESH", json={"have": True}, headers=PARENT)
    missing = {d["doc_type"] for d in client.get(f"/api/steps/{s['id']}/help", headers=PARENT).json()["checklist"]}
    assert "PSYCH_FRESH" not in missing and len(missing) == 5


def test_shared_documents(client):
    cid = ready_plan(client, "2")
    before = steps_of(client, cid)
    uses = [sid for sid, s in before.items() if any(d["doc_type"] == "INSTITUTION_REPORT" for d in s["documents"])]
    assert "SOC_MSE_REEXAM" in uses
    r = client.patch(f"/api/cases/{cid}/documents/MED_CARD_052", json={"have": True}, headers=PARENT)
    assert r.status_code == 200 and r.json()["have"] is True
    after = steps_of(client, cid)
    for s in after.values():
        for d in s["documents"]:
            if d["doc_type"] == "MED_CARD_052":
                assert d["have"] is True
    folder = {d["doc_type"]: d for d in client.get(f"/api/cases/{cid}/documents", headers=PARENT).json()["documents"]}
    assert folder["MSE_CERT"]["expired"] and not folder["MSE_CERT"]["have"]  # справка истекла
    assert "Обследование на ПМПК" in folder["MED_CARD_052"]["used_in"]
    assert client.patch(f"/api/cases/{cid}/documents/NOPE", json={"have": True}, headers=PARENT).status_code == 404


def test_summary_gate_and_corrections(client):
    cid = case_id_by_scenario(client, "1")
    r, asked = run_interview(client, cid, "1", confirm=False)
    assert asked[-1] == "12" and r["summary"]["lines"]
    assert client.post(f"/api/cases/{cid}/plan/generate", headers=PARENT).status_code == 409
    fixed = client.post(f"/api/cases/{cid}/interview/confirm",
                        json={"corrections": {"family_goal": "Начать занятия в центре"}}, headers=PARENT).json()
    assert fixed["summary_confirmed"]
    goal = next(line for line in fixed["summary"]["lines"] if line["slot"] == "family_goal")
    assert goal["value"] == "Начать занятия в центре"
    assert client.post(f"/api/cases/{cid}/plan/generate", headers=PARENT).status_code == 200


def test_parent_cannot_see_unconfirmed_plan(client):
    cid = ready_plan(client, "2", confirm=False)
    v = client.get(f"/api/cases/{cid}", headers=PARENT).json()
    assert v["status"] == "awaiting_curator" and v["plan_visible"] is False and v["steps"] == []
    step_id = client.get(f"/api/cases/{cid}", headers=CURATOR).json()["steps"][0]["id"]
    assert client.get(f"/api/steps/{step_id}/help", headers=PARENT).status_code == 404
    assert client.patch(f"/api/steps/{step_id}", json={"status": "done"}, headers=PARENT).status_code == 404
    client.post(f"/api/cases/{cid}/plan/confirm", headers=CURATOR)
    v = client.get(f"/api/cases/{cid}", headers=PARENT).json()
    assert len(v["steps"]) == 3 and all("escalated" not in s for s in v["steps"])


def test_red_flag_alert(client):
    cid = case_id_by_scenario(client, "1")
    r = client.post(f"/api/cases/{cid}/interview/next", json={}, headers=PARENT).json()
    while r["question_id"] != "6":
        r = client.post(f"/api/cases/{cid}/interview/next", json={"answer": r["options"][0]}, headers=PARENT).json()
    assert r["type"] == "multi" and r["item"]["source"] == "template"
    client.post(f"/api/cases/{cid}/interview/next", json={"answer": ["Перестал делать то, что умел"]}, headers=PARENT)
    v = client.get(f"/api/cases/{cid}", headers=PARENT).json()
    assert v["alert"] and v["red_flag_text"] == "Рекомендуем как можно скорее обратиться к врачу."
    cases = client.get("/api/curator/cases", headers=CURATOR).json()["cases"]
    assert cases[0]["id"] == cid and cases[0]["alert"]  # алерт — вверху списка
    notes = client.get("/api/curator/notifications", headers=CURATOR).json()["items"]
    assert any(n["type"] == "red_flag" and n["case_id"] == cid for n in notes)


def test_overdue_escalation_demo_today(client):
    cid = ready_plan(client, "1")
    assert client.get("/api/curator/overdue", headers=CURATOR).json()["overdue_count"] == 0
    assert client.post("/api/settings/demo-today", json={"shift_days": 10}, headers=PARENT).status_code == 403
    client.post("/api/settings/demo-today", json={"shift_days": 10}, headers=CURATOR)
    r = client.get("/api/curator/overdue", headers=CURATOR).json()
    ped = next(s for s in r["items"] if s["service_id"] == "MED_PEDIATRICIAN")
    assert ped["days_overdue"] == 3 and not ped["escalated"]  # порог: больше 3 дней
    client.post("/api/settings/demo-today", json={"shift_days": 1}, headers=CURATOR)
    ped = next(s for s in client.get("/api/curator/overdue", headers=CURATOR).json()["items"] if s["service_id"] == "MED_PEDIATRICIAN")
    assert ped["escalated"] and ped["notification"]["sent"] is False and ped["reason"]
    mchat = steps_of(client, cid)["MED_MCHAT"]
    assert mchat["status"] == "locked" and not mchat["overdue"]  # заблокированный не просрочен
    client.patch(f"/api/steps/{ped['id']}", json={"status": "done"}, headers=PARENT)
    assert steps_of(client, cid)["MED_MCHAT"]["status"] == "todo"
    reset = client.post("/api/settings/demo-today", json={"date": None}, headers=CURATOR).json()
    assert reset["demo_today"] is None and reset["today"] == date.today().isoformat()


def test_blockers(client):
    cid = ready_plan(client, "2")
    mse = steps_of(client, cid, PARENT)["SOC_MSE_REEXAM"]
    r = client.patch(f"/api/steps/{mse['id']}", json={"blocker": "decision_disputed", "blocker_note": "Не согласны"}, headers=PARENT)
    assert r.json()["blocker"] == "decision_disputed"
    assert client.get(f"/api/steps/{mse['id']}/help", headers=PARENT).json()["dispute_hint"]
    assert client.patch(f"/api/steps/{mse['id']}", json={"priority": "low"}, headers=PARENT).status_code == 403
    assert client.patch(f"/api/steps/{mse['id']}", json={"blocker": "nope"}, headers=PARENT).status_code == 422
    listed = next(c for c in client.get("/api/curator/cases", headers=CURATOR).json()["cases"] if c["id"] == cid)
    assert listed["blockers"] == 1


def test_curator_adds_step_from_catalog_only(client):
    cid = ready_plan(client, "3", confirm=False)
    assert client.post(f"/api/cases/{cid}/steps", json={"service_id": "MADE_UP"}, headers=CURATOR).status_code == 400
    assert client.post(f"/api/cases/{cid}/steps", json={"service_id": "SOC_MSE_REEXAM"}, headers=CURATOR).status_code == 409
    v = client.post(f"/api/cases/{cid}/steps", json={"service_id": "MED_FOLLOWUP", "priority": "low"}, headers=CURATOR).json()
    assert [s["service_id"] for s in v["steps"]] == ["SOC_MSE_REEXAM", "MED_FOLLOWUP"]
    assert client.post(f"/api/cases/{cid}/steps", json={"service_id": "MED_FOLLOWUP"}, headers=PARENT).status_code == 403


def test_statuses_survive_restart(client):
    cid = ready_plan(client, "2")
    steps = steps_of(client, cid)
    client.patch(f"/api/steps/{steps['EDU_PMPK']['id']}", json={"status": "done"}, headers=CURATOR)
    client.patch(f"/api/steps/{steps['SOC_MSE_REEXAM']['id']}", json={"status": "in_progress", "curator_note": "ok"}, headers=CURATOR)
    with TestClient(app) as c2:
        after = {s["service_id"]: s for s in c2.get(f"/api/cases/{cid}", headers=CURATOR).json()["steps"]}
        assert after["EDU_PMPK"]["status"] == "done" and after["EDU_TUTOR"]["status"] == "todo"
        assert after["SOC_MSE_REEXAM"]["status"] == "in_progress" and after["SOC_MSE_REEXAM"]["curator_note"] == "ok"


def test_create_case_with_intake(client):
    body = {"child_alias": "Семья Д", "birth_date": "2021-01-01", "city": "Астана", "language": "kk",
            "intake": {"has_conclusion": True, "conclusion_date": "2025-01-10", "documents": ["BIRTH_CERT"]}}
    v = client.post("/api/cases", json=body, headers=PARENT)
    assert v.status_code == 201 and v.json()["status"] == "draft"
    bad = {**body, "intake": {"documents": ["NOPE"]}}
    assert client.post("/api/cases", json=bad, headers=PARENT).status_code == 400
    future = (date.today() + timedelta(days=400)).isoformat()
    assert client.post("/api/cases", json={**body, "birth_date": future}, headers=PARENT).status_code == 400
    assert client.post("/api/cases", json={**body, "birth_date": "2000-01-01"}, headers=PARENT).status_code == 400


def test_demo_reset(client):
    ready_plan(client, "2")
    client.post("/api/settings/demo-today", json={"shift_days": 30}, headers=CURATOR)
    client.post("/api/demo/reset", headers=CURATOR)
    cases = client.get("/api/curator/cases", headers=CURATOR).json()["cases"]
    assert sorted(c["child_alias"] for c in cases) == ["Семья 1", "Семья 2", "Семья 3"]
    assert all(c["status"] == "draft" for c in cases)
    assert client.get("/api/settings").json()["today"] == "2026-09-30"
    assert client.get("/api/curator/notifications", headers=CURATOR).json()["items"] == []


def test_gov_sync_demo(client):
    cid = case_id_by_scenario(client, "2")
    r = client.post(f"/api/cases/{cid}/gov-sync", headers=PARENT).json()
    assert [s["short"] for s in r["sources"]] == ["ГБД ФЛ", "НОБД", "МСЭ", "Портал"]
    rows = {row["doc"]: row for row in r["rows"]}
    assert rows["Справка МСЭ об инвалидности"]["tone"] == "crit"  # истекла 30.01.2026
    assert rows["Заключение ПМПК"]["detail"] == "Сведений не найдено"
    assert rows["Заключение врача"]["source"] == "Вручную"
    folder = {d["doc_type"]: d for d in client.get(f"/api/cases/{cid}/documents", headers=PARENT).json()["documents"]}
    assert folder["BIRTH_CERT"]["have"] and folder["ID_PARENT"]["have"]
    client.post(f"/api/cases/{cid}/gov-sync", headers=PARENT)  # повтор — без дублей в журнале
    audit = [a["action"] for a in client.get(f"/api/cases/{cid}/audit", headers=CURATOR).json()["items"]]
    assert audit.count("gov_consent") == 1
    # План кейса не меняется от документов из ГБД ФЛ.
    run_interview(client, cid, "2")
    client.post(f"/api/cases/{cid}/plan/generate", headers=PARENT)
    assert set(steps_of(client, cid)) == {"EDU_PMPK", "SOC_MSE_REEXAM", "EDU_TUTOR"}


def test_demo_prepare_and_helper_routes(client):
    assert client.post("/api/demo/prepare", headers=PARENT).status_code == 403
    r = client.post("/api/demo/prepare", json={}, headers=CURATOR).json()
    got = {p["scenario"]: set(p["steps"]) for p in r["prepared"]}
    assert got == {"2": {"EDU_PMPK", "SOC_MSE_REEXAM", "EDU_TUTOR"}, "3": {"SOC_MSE_REEXAM"}}
    cases = {c["scenario"]: c for c in client.get("/api/curator/cases", headers=CURATOR).json()["cases"]}
    assert cases["2"]["status"] == cases["3"]["status"] == "confirmed" and cases["1"]["status"] == "draft"
    cid2 = cases["2"]["id"]
    plan = client.get(f"/api/cases/{cid2}/plan", headers=PARENT).json()
    assert plan["plan_visible"] and len(plan["steps"]) == 3
    notes = client.get(f"/api/cases/{cid2}/notifications", headers=CURATOR).json()["items"]
    assert any(n["type"] == "escalation" for n in notes)
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/api/docs").status_code == 200
