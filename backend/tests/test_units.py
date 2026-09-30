"""Справочник, стоп-слова, расчёт просрочки и эскалации, handoff."""

import re
from datetime import date

from app import config
from app.catalog import (
    AGENCIES, BASE_SERVICES, DOMAINS, QUESTION_TEMPLATES, SCENARIOS, SERVICES, TOPIC_IDS,
)
from app.plan import rules_plan
from app.safety import find_stop_words, is_safe
from app.tracking import is_escalated, overdue_days

from .conftest import CURATOR, PARENT, case_id_by_scenario

SERVICES_MAP = {s["id"]: {**s} for s in SERVICES}


# --- справочник ---

def test_catalog_is_valid():
    ids = [s["id"] for s in SERVICES]
    assert 15 <= len(ids) <= 20
    assert len(ids) == len(set(ids))
    assert set(BASE_SERVICES) == {"case_intake", "single_doc_package"}
    for s in SERVICES:
        assert s["agency"] in AGENCIES
        assert s["domain"] in DOMAINS
        assert s["required_documents"] and all(isinstance(d, str) for d in s["required_documents"])
        assert s["default_deadline_days"] > 0 and s["responsible"]
        if s["min_age_months"] is not None and s["max_age_months"] is not None:
            assert s["min_age_months"] < s["max_age_months"]
    assert {s["domain"] for s in SERVICES} == set(DOMAINS)


def test_scenarios_cover_all_topics():
    for sc in SCENARIOS.values():
        assert set(sc["answers"]) | {"age_city"} == set(TOPIC_IDS)


# --- стоп-слова ---

def test_stop_words():
    assert find_stop_words("Врач поставит диагноз") == ["диагноз"]
    for bad in ("Нужно начать лечение", "Прогноз благоприятный", "Оценим степень тяжести",
                "Терапия рекомендуется", "У ребёнка РАС", "Лёгкая форма"):
        assert not is_safe(bad), bad
    assert is_safe("Консультация поможет получить заключение для комиссии")


def test_no_stop_words_in_any_static_text():
    for s in SERVICES:
        assert is_safe(s["default_explanation"]), s["id"]
        assert is_safe(s["title"]) and is_safe(s["description"]), s["id"]
    for t in QUESTION_TEMPLATES.values():
        assert is_safe(t["question"]) and all(is_safe(o) for o in t["options"])
        for v in t.get("by_age", {}).values():
            assert is_safe(v["question"])


def test_no_stop_words_in_generated_plans():
    for key in ("A", "B"):
        interview = {"items": [{"topic": t, "question": "?", "answer": a} for t, a in SCENARIOS[key]["answers"].items()], "done": True}
        for months in (20, 51, 100):
            for st in rules_plan(interview, SERVICES_MAP, months):
                assert is_safe(st["explanation"])


# --- просрочка и эскалация ---

def test_overdue_and_escalation_calc():
    today = date(2026, 10, 10)
    assert overdue_days("2026-10-10", "todo", today) == 0
    assert overdue_days("2026-10-09", "todo", today) == 1
    assert overdue_days("2026-10-01", "in_progress", today) == 9
    assert overdue_days("2026-10-01", "done", today) == 0
    assert overdue_days("2026-10-20", "todo", today) == 0
    n = config.ESCALATION_AFTER_DAYS
    assert not is_escalated(n) and is_escalated(n + 1) and not is_escalated(0)


# --- handoff ---

def _confirmed(client, key):
    cid = case_id_by_scenario(client, key)
    client.post(f"/api/cases/{cid}/interview/autofill", headers=PARENT)
    client.post(f"/api/cases/{cid}/plan/generate", headers=CURATOR)
    return cid


def test_handoff_blocks_and_access(client):
    cid = _confirmed(client, "B")
    assert client.get(f"/api/cases/{cid}/handoff", headers=CURATOR).status_code == 409  # не подтверждён
    client.post(f"/api/cases/{cid}/plan/confirm", headers=CURATOR)
    assert client.get(f"/api/cases/{cid}/handoff", headers=PARENT).status_code == 403
    assert client.post(f"/api/cases/{cid}/handoff/export", headers=PARENT).status_code == 403

    steps = client.get(f"/api/cases/{cid}", headers=CURATOR).json()["steps"]
    client.patch(f"/api/steps/{steps[0]['id']}", json={"status": "done", "documents": [{"name": "Удостоверение личности родителя", "have": True}]}, headers=CURATOR)
    client.post("/api/settings/demo-today", json={"shift_days": 10}, headers=CURATOR)

    h = client.get(f"/api/cases/{cid}/handoff", headers=CURATOR).json()
    for key in ("case", "done", "pending", "overdue", "documents", "blockers", "next_deadlines",
                "coverage_by_domain", "gaps", "summary_text"):
        assert key in h, key
    assert set(h["case"]) >= {"alias", "age_months", "city"}
    assert h["case"]["age_months"] >= 96
    assert len(h["done"]) == 1 and len(h["done"]) + len(h["pending"]) == len(steps)
    assert h["overdue"] and all(o["days_overdue"] > 0 for o in h["overdue"])
    assert "Удостоверение личности родителя" in h["documents"]["have"]
    assert "Удостоверение личности родителя" not in h["documents"]["missing"]
    assert any(b["blocker"] == "no_service_in_region" for b in h["blockers"])
    assert len(h["next_deadlines"]) <= 3
    assert set(h["coverage_by_domain"]) == set(DOMAINS)
    assert h["coverage_by_domain"]["family_support"]["done"] == 1
    assert all(g["domain"] in DOMAINS and h["coverage_by_domain"][g["domain"]]["total"] == 0 for g in h["gaps"])
    assert h["summary_text"] and is_safe(h["summary_text"])
    assert len(re.findall(r"[.!?](?:\s|$)", h["summary_text"])) <= 2  # 1–2 предложения
    # Сырые ответы интервью в сводку не попадают.
    blob = str(h)
    for ans in SCENARIOS["B"]["answers"].values():
        if isinstance(ans, str) and len(ans) > 30:
            assert ans not in blob

    assert client.post(f"/api/cases/{cid}/handoff/export", headers=CURATOR).json()["ok"]
    audit = [a["action"] for a in client.get(f"/api/cases/{cid}/audit", headers=CURATOR).json()["items"]]
    assert "handoff_exported" in audit
