"""LLM-пути, стоп-слова, справочник, правила и передача дела."""

import re
from datetime import date

from app import config
from app.catalog import (
    AGENCIES, DOC_TYPES_BY_ID, DOMAINS, QUESTIONS, SCENARIOS, SERVICES, SERVICES_BY_ID,
)
from app.llm import LLM, LLMError
from app.rules import Profile, add_months, evaluate_all, stage_for
from app.safety import find_stop_words, is_safe
from app.tracking import is_escalated, overdue_days

from .conftest import CURATOR, PARENT, case_id_by_scenario, ready_plan, run_interview, steps_of

EXPECTED = {
    "1": {"MED_PEDIATRICIAN", "MED_MCHAT"},
    "2": {"EDU_PMPK", "SOC_MSE_REEXAM", "EDU_TUTOR"},
    "3": {"SOC_MSE_REEXAM"},
}


# --- справочник и данные ---

def test_catalog_is_valid():
    assert 15 <= len(SERVICES) <= 20
    for s in SERVICES:
        prefix = s["id"].split("_")[0]
        assert prefix in AGENCIES and s["agency"] == AGENCIES[prefix]
        assert s["domain"] in DOMAINS
        assert s["channel"] in ("egov", "polyclinic", "pmpk", "social_dept", "school")
        assert s["how_to"] and s["typical_duration"] and s["responsible"]
        assert s["egov_url"] is None  # не выдумываем ссылки
        for d in s["required_documents"] + s["optional_documents"] + s["produces"]:
            assert d in DOC_TYPES_BY_ID, (s["id"], d)
    assert len(DOC_TYPES_BY_ID) == 15
    for sc in SCENARIOS.values():
        assert set(sc["intake"]["documents"]) <= set(DOC_TYPES_BY_ID)


def test_no_stop_words_in_static_texts():
    for s in SERVICES:
        assert is_safe(s["default_explanation"]), s["id"]
    for q in QUESTIONS:
        assert is_safe(q["text"]), q["id"]


def test_stopwords():
    assert find_stop_words("Врач уточнит диагноз") == ["диагноз"]
    for bad in ("Нужно начать лечение", "Прогноз хороший", "Оценим степень тяжести", "Терапия рекомендуется"):
        assert not is_safe(bad), bad
    # РАС и аутизм — предметная область, не стоп-слова.
    assert is_safe("Маршрут помощи ребёнку с РАС") and is_safe("Семьи детей с аутизмом")


def test_stage_boundaries():
    assert stage_for(0) == "early" and stage_for(35) == "early"
    assert stage_for(36) == "correction" and stage_for(83) == "correction"
    assert stage_for(84) == "socialization"


def test_overdue_and_escalation_calc():
    today = date(2026, 10, 10)
    assert overdue_days("2026-10-01", "todo", today) == 9
    assert overdue_days("2026-10-01", "locked", today) == 0
    assert overdue_days("2026-10-01", "done", today) == 0
    n = config.ESCALATION_AFTER_DAYS
    assert not is_escalated(n) and is_escalated(n + 1)


def _profile(key, today=date(2026, 9, 30), slots=None):
    sc = SCENARIOS[key]
    case = {"birth_date": sc["birth_date"], "city": sc["city"], "intake": sc["intake"], "profile": slots or {}}
    return Profile(case, set(sc["intake"]["documents"]), today)


def test_rules_mse_windows():
    # Справка действует до 10.11.2026: >90 дней — скрыт, ≤90 — locked, ≤30 — active, истекла — active.
    assert "SOC_MSE_REEXAM" not in evaluate_all(_profile("3", date(2026, 8, 1)))
    assert evaluate_all(_profile("3", date(2026, 9, 30)))["SOC_MSE_REEXAM"].state == "locked"
    r = evaluate_all(_profile("3", date(2026, 10, 11)))["SOC_MSE_REEXAM"]
    assert r.state == "active" and r.base_priority == "high"
    r = evaluate_all(_profile("3", date(2026, 12, 1)))["SOC_MSE_REEXAM"]
    assert r.state == "active" and r.due_date == date(2026, 11, 10)


def test_rules_mchat_window():
    p = _profile("1", date(2025, 6, 30))  # 3 месяца — ещё рано и нужен педиатр
    r = evaluate_all(p)["MED_MCHAT"]
    assert r.state == "locked" and r.unlock_date == add_months(date(2025, 3, 30), 16)
    assert "MED_MCHAT" not in evaluate_all(_profile("1", date(2027, 10, 30)))  # старше 30 мес


def test_rules_soc_only_with_valid_mse():
    slots = {"ipar_items": ["Пока ничего"], "education_setting": "Детский сад, инклюзивная группа с тьютором",
             "rehab_status": "Получает все рекомендованные занятия", "med_followup": "Визит назначен, назначения выполняем"}
    got = evaluate_all(_profile("3", slots=slots))
    assert {"SOC_BENEFIT", "SOC_TSR", "SOC_SANATORIUM", "SOC_SOCIAL_SERVICES"} <= set(got)
    assert not {"SOC_BENEFIT", "SOC_TSR"} & set(evaluate_all(_profile("2", slots=slots)))  # справка истекла


# --- LLM ---

def _plan_responder(extra=None, text="Этот шаг открывает следующий этап маршрута."):
    def responder(name, schema, user_input, n):
        if name != "case_plan":
            return {"text": "Расскажите, пожалуйста?"} if name == "interview_question" else {
                "family_priority": "Понять, с чего начать", "family_goal": "Начать занятия"}
        ids = schema["properties"]["steps"]["items"]["properties"]["service_id"]["enum"]
        steps = [{"service_id": sid, "priority": "medium", "explanation": text} for sid in ids]
        if extra:
            steps.append({"service_id": extra, "priority": "high", "explanation": text})
        return {"steps": steps}
    return responder


def test_llm_plan_texts(client, fake_llm):
    fake_llm(_plan_responder())
    cid = ready_plan(client, "2", confirm=False)
    v = client.get(f"/api/cases/{cid}", headers=CURATOR).json()
    assert v["plan_meta"]["source"] == "llm"
    steps = {s["service_id"]: s for s in v["steps"]}
    assert set(steps) == EXPECTED["2"]
    assert steps["EDU_PMPK"]["priority"] == "medium"  # приоритет от модели
    assert steps["EDU_TUTOR"]["priority"] is None  # locked — без приоритета
    assert steps["EDU_PMPK"]["explanation"] == "Этот шаг открывает следующий этап маршрута."


def test_llm_extra_service_rejected(client, fake_llm):
    f = fake_llm(_plan_responder(extra="SOC_BENEFIT"))
    cid = ready_plan(client, "2", confirm=False)
    v = client.get(f"/api/cases/{cid}", headers=CURATOR).json()
    assert v["plan_meta"]["source"] == "fallback"
    assert {s["service_id"] for s in v["steps"]} == EXPECTED["2"]
    assert sum(1 for c in f.calls if c["name"] == "case_plan") == 2  # одна повторная попытка


def test_llm_stop_words_replaced(client, fake_llm):
    fake_llm(_plan_responder(text="Врач уточнит диагноз и назначит лечение."))
    cid = ready_plan(client, "1", confirm=False)
    v = client.get(f"/api/cases/{cid}", headers=CURATOR).json()
    assert v["plan_meta"]["source"] == "llm"
    for s in v["steps"]:
        assert s["explanation"] == SERVICES_BY_ID[s["service_id"]]["default_explanation"]
    assert any("стоп-слова" in w for w in v["plan_meta"]["warnings"])


def test_fallback_same_step_set(client, fake_llm):
    for key in ("1", "2", "3"):
        fake_llm(lambda name, *a: LLMError("down") if name == "case_plan" else {"text": "Вопрос?", "family_priority": "x", "family_goal": "y"})
        cid = ready_plan(client, key, confirm=False)
        v = client.get(f"/api/cases/{cid}", headers=CURATOR).json()
        assert v["plan_meta"]["source"] == "fallback"
        assert {s["service_id"] for s in v["steps"]} == EXPECTED[key]


def test_wrong_key_real_client(client):
    """Неверный ключ / недоступный API: оба кейса проходят до конца на кнопках и fallback-плане."""
    from app import llm as llm_mod

    llm_mod.set_llm(LLM("sk-invalid", "gpt-6-luna", base_url="http://127.0.0.1:9/v1"))
    for key in ("1", "2"):
        cid = case_id_by_scenario(client, key)
        r, asked = run_interview(client, cid, key)
        items = client.get(f"/api/cases/{cid}", headers=CURATOR).json()["interview"]["items"]
        assert all(i["source"] == "template" for i in items)
        v = client.post(f"/api/cases/{cid}/plan/generate", headers=PARENT)
        assert v.status_code == 200
        v = client.get(f"/api/cases/{cid}", headers=CURATOR).json()
        assert v["plan_meta"]["source"] == "fallback" and {s["service_id"] for s in v["steps"]} == EXPECTED[key]
        assert client.post(f"/api/cases/{cid}/plan/confirm", headers=CURATOR).status_code == 200


def test_llm_rephrase_unsafe_uses_template(client, fake_llm):
    fake_llm(lambda name, *a: {"text": "Какой диагноз поставили и насколько тяжело?"})
    cid = case_id_by_scenario(client, "2")
    item = client.post(f"/api/cases/{cid}/interview/next", json={}, headers=PARENT).json()["item"]
    assert item["source"] == "template" and is_safe(item["text"])


def test_autofill_stops_at_summary(client):
    cid = case_id_by_scenario(client, "2")
    r = client.post(f"/api/cases/{cid}/interview/autofill", headers=PARENT).json()
    assert r["question_id"] == "12" and r["summary"]["lines"] and not r["done"]
    assert r["progress"]["answered"] == 10
    client.post(f"/api/cases/{cid}/interview/confirm", json={}, headers=PARENT)
    assert client.post(f"/api/cases/{cid}/plan/generate", headers=PARENT).status_code == 200


# --- передача дела ---

def test_handoff(client):
    cid = ready_plan(client, "2", confirm=False)
    assert client.get(f"/api/cases/{cid}/handoff", headers=CURATOR).status_code == 409
    client.post(f"/api/cases/{cid}/plan/confirm", headers=CURATOR)
    assert client.get(f"/api/cases/{cid}/handoff", headers=PARENT).status_code == 403
    assert client.post(f"/api/cases/{cid}/handoff/export", headers=PARENT).status_code == 403
    h = client.get(f"/api/cases/{cid}/handoff", headers=CURATOR).json()
    for key in ("case", "done", "pending", "overdue", "documents", "blockers", "next_deadlines",
                "coverage_by_domain", "gaps", "summary_text"):
        assert key in h, key
    assert h["case"]["stage"] == "socialization" and h["case"]["stage_label"] == "Социализация"
    locked = [s for s in h["pending"] if s["status"] == "locked"]
    assert locked and locked[0]["unlock_hint"] == "после заключения ПМПК"
    assert {s["service_id"] for s in h["overdue"]} == {"EDU_PMPK", "SOC_MSE_REEXAM"}
    assert "Выписка или заключение врача" in h["documents"]["have"]
    assert set(h["coverage_by_domain"]) == set(DOMAINS)
    assert is_safe(h["summary_text"]) and len(re.findall(r"[.!?](?:\s|$)", h["summary_text"])) <= 2
    blob = str(h)
    for ans in SCENARIOS["2"]["answers"].values():
        if isinstance(ans, str) and len(ans) > 30:
            assert ans not in blob  # сырые ответы интервью не попадают
    client.post(f"/api/cases/{cid}/handoff/export", headers=CURATOR)
    audit = [a["action"] for a in client.get(f"/api/cases/{cid}/audit", headers=CURATOR).json()["items"]]
    assert "handoff_exported" in audit and "plan_confirmed" in audit


def test_parent_sees_steps_with_indicators(client):
    cid = ready_plan(client, "2")
    steps = steps_of(client, cid, PARENT)
    assert steps["SOC_MSE_REEXAM"]["indicator"] == "overdue"  # родителю без «эскалации»
    assert steps["EDU_TUTOR"]["indicator"] == "locked"


def test_translation_cache_and_fallback(client, fake_llm):
    # без модели — пусто (фронтенд показывает русский)
    assert client.post("/api/i18n/translate", json={"texts": ["План"]}).json()["translations"] == {}
    f = fake_llm(lambda name, schema, user_input, n: {"items": [{"i": 0, "text": "Жоспар"}, {"i": 1, "text": "Құжаттар"}]})
    r = client.post("/api/i18n/translate", json={"texts": ["План", "Документы"]}).json()
    assert r["translations"] == {"План": "Жоспар", "Документы": "Құжаттар"}
    client.post("/api/i18n/translate", json={"texts": ["План", "Документы"]})
    assert len(f.calls) == 1  # второй раз — из кеша
    fake_llm(lambda *a: LLMError("down"))
    assert client.post("/api/i18n/translate", json={"texts": ["Новое"]}).json()["translations"] == {}
    assert client.post("/api/i18n/translate", json={"lang": "en", "texts": ["x"]}).status_code == 422
