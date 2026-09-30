import json
import random

from app.catalog import FOLLOW_UP, SCENARIOS, SERVICES, SERVICES_BY_ID, TOPIC_IDS
from app.llm import LLM, LLMError
from app.plan import generate_steps, validate_plan
from app.safety import is_safe

from .conftest import CURATOR, PARENT, case_id_by_scenario, run_interview

SERVICES_MAP = {s["id"]: {**s} for s in SERVICES}
AGE_A = 51  # 4 года 3 мес.


def _interview_done(key="A"):
    items = [{"topic": t, "question": "?", "answer": a} for t, a in SCENARIOS[key]["answers"].items()]
    return {"items": items, "done": True}


def test_validate_plan_drops_unknown_duplicates_and_wrong_age():
    data = {"steps": [
        {"service_id": "pmpk", "priority": "high", "explanation": "Комиссия определит условия обучения."},
        {"service_id": "made_up", "priority": "high", "explanation": "Нет в справочнике."},
        {"service_id": "pmpk", "priority": "low", "explanation": "Дубль."},
        {"service_id": "school_support", "priority": "low", "explanation": "Школа — не по возрасту."},
    ]}
    steps, warnings, errors = validate_plan(data, SERVICES_MAP, AGE_A)
    assert not errors
    ids = [s["service_id"] for s in steps]
    assert "made_up" not in ids and ids.count("pmpk") == 1 and "school_support" not in ids
    assert ids[:2] == ["case_intake", "single_doc_package"]  # базовый набор добавлен кодом


def test_base_set_goes_first_in_fixed_order():
    data = {"steps": [
        {"service_id": "pmpk", "priority": "high", "explanation": "Комиссия определит условия."},
        {"service_id": "case_intake", "priority": "medium", "explanation": "Куратор — единая точка контакта."},
    ]}
    steps, warnings, _ = validate_plan(data, SERVICES_MAP, AGE_A)
    assert [s["service_id"] for s in steps] == ["case_intake", "single_doc_package", "pmpk"]
    assert steps[0]["priority"] == "medium"  # приоритет модели сохраняется
    assert warnings == ["Добавлен обязательный шаг базового набора: single_doc_package"]


def test_stop_words_are_replaced_with_template():
    data = {"steps": [
        {"service_id": "pmpk", "priority": "high", "explanation": "Врач уточнит диагноз и прогноз."},
        {"service_id": "correction_cabinet", "priority": "high", "explanation": "Терапия рекомендуется при такой тяжести."},
        {"service_id": "parent_support", "priority": "low", "explanation": "а" * 301},
    ]}
    steps, warnings, errors = validate_plan(data, SERVICES_MAP, AGE_A)
    assert not errors
    by_id = {s["service_id"]: s["explanation"] for s in steps}
    for sid in ("pmpk", "correction_cabinet", "parent_support"):
        assert by_id[sid] == SERVICES_BY_ID[sid]["default_explanation"]
    assert sum("заменено шаблонным" in w for w in warnings) == 3


def test_validate_plan_errors():
    assert validate_plan({"steps": [{"service_id": "pmpk", "priority": "urgent", "explanation": "x"}]}, SERVICES_MAP)[2]
    assert validate_plan({"steps": []}, SERVICES_MAP)[2]
    assert validate_plan({"foo": 1}, SERVICES_MAP)[2]


def test_plan_schema_restricts_service_ids(fake_llm):
    good = {"steps": [{"service_id": "pmpk", "priority": "high", "explanation": "Комиссия определит условия."}]}
    f = fake_llm(lambda *a: good)
    steps, meta = generate_steps(_interview_done(), SERVICES_MAP, AGE_A, "Алматы")
    enum = f.calls[0]["schema"]["properties"]["steps"]["items"]["properties"]["service_id"]["enum"]
    assert set(enum) == set(SERVICES_BY_ID)
    assert meta["source"] == "llm" and meta["attempts"] == 1
    assert "возраст_месяцев" in f.calls[0]["input"]


def test_invalid_json_retry_then_success(fake_llm):
    def responder(name, schema, user_input, n):
        if n == 1:
            return LLMError("Model returned invalid JSON")
        return {"steps": [{"service_id": "pmpk", "priority": "high", "explanation": "Комиссия определит условия."}]}

    fake_llm(responder)
    _, meta = generate_steps(_interview_done(), SERVICES_MAP, AGE_A)
    assert meta["source"] == "llm_retry"


def test_two_failures_fall_back_to_base_set(fake_llm):
    f = fake_llm(lambda *a: LLMError("timeout"))
    steps, meta = generate_steps(_interview_done(), SERVICES_MAP, AGE_A)
    assert len(f.calls) == 2 and meta["source"] == "fallback"
    assert {s["id"] for s in SERVICES if s["base"]} <= {s["service_id"] for s in steps}


def test_ten_runs_always_valid_and_in_catalog(fake_llm):
    """Капризная модель: мусорные id, дубли, стоп-слова, сбои — план всегда валиден и безопасен."""
    rng = random.Random(42)
    ids = list(SERVICES_BY_ID)

    def responder(name, schema, user_input, n):
        if rng.random() < 0.15:
            return LLMError("network")
        steps = []
        for _ in range(rng.randint(0, 9)):
            steps.append({
                "service_id": rng.choice(ids + ["unknown_service", "psychiatrist_pills"]),
                "priority": rng.choice(["high", "medium", "low"]),
                "explanation": rng.choice(["Поможет получить место в саду.", "Нужно лечение.", "Прогноз хороший."]),
            })
        return {"steps": steps}

    fake_llm(responder)
    for _ in range(10):
        steps, _ = generate_steps(_interview_done(), SERVICES_MAP, AGE_A)
        json.dumps(steps)
        assert steps
        assert all(s["service_id"] in SERVICES_BY_ID for s in steps)
        assert all(s["priority"] in ("high", "medium", "low") for s in steps)
        assert all(is_safe(s["explanation"]) for s in steps)
        assert len({s["service_id"] for s in steps}) == len(steps)


def test_wrong_key_real_client_falls_back(client):
    """Неверный ключ / недоступный API: настоящий клиент OpenAI падает, сценарий проходит на fallback."""
    from app import llm as llm_mod

    llm_mod.set_llm(LLM("sk-invalid", "gpt-6-luna", base_url="http://127.0.0.1:9/v1"))
    cid = case_id_by_scenario(client, "A")
    r, asked = run_interview(client, cid, "A")
    assert r["done"] and 8 <= asked <= 12
    assert all(i["source"] == "template" for i in r["interview"]["items"])
    view = client.post(f"/api/cases/{cid}/plan/generate", headers=CURATOR).json()
    assert view["plan_meta"]["source"] == "fallback" and len(view["steps"]) >= 5
    assert client.post(f"/api/cases/{cid}/plan/confirm", headers=CURATOR).json()["status"] == "confirmed"


def test_llm_interview_adaptive_and_bounded(client, fake_llm):
    """Модель, которая всегда хочет уточнять, всё равно укладывается в 12 и закрывает все темы."""

    def responder(name, schema, user_input, n):
        allowed = schema["properties"]["topic"]["enum"]
        topic = FOLLOW_UP if FOLLOW_UP in allowed else allowed[0]
        return {"question": f"Вопрос {n}?", "type": "text", "options": [], "topic": topic, "done": True}

    fake_llm(responder)
    cid = case_id_by_scenario(client, "A")
    r, asked = run_interview(client, cid, "A")
    assert asked == 12
    assert set(r["progress"]["covered_topics"]) == set(TOPIC_IDS)
    items = r["interview"]["items"]
    assert all(i["source"] == "llm" for i in items)
    assert sum(1 for i in items if i["topic"] == FOLLOW_UP) == 3


def test_llm_interview_unsafe_question_uses_template(client, fake_llm):
    def responder(name, schema, user_input, n):
        topic = schema["properties"]["topic"]["enum"][0]
        return {"question": "Оцените тяжесть и какой диагноз?", "type": "text", "options": [], "topic": topic, "done": False}

    fake_llm(responder)
    cid = case_id_by_scenario(client, "B")
    item = client.post(f"/api/cases/{cid}/interview/next", json={}, headers=PARENT).json()["item"]
    assert item["source"] == "template" and is_safe(item["question"])


def test_full_path_with_llm_plan(client, fake_llm):
    def responder(name, schema, user_input, n):
        if name == "interview_question":
            topic = schema["properties"]["topic"]["enum"][0]
            return {"question": "Расскажите, пожалуйста?", "type": "text", "options": [], "topic": topic, "done": False}
        return {"steps": [
            {"service_id": "specialist_consultation", "priority": "high", "explanation": "Заключение нужно для комиссии."},
            {"service_id": "pmpk", "priority": "high", "explanation": "Комиссия определит условия в саду."},
            {"service_id": "hallucinated", "priority": "low", "explanation": "..."},
        ]}

    fake_llm(responder)
    cid = case_id_by_scenario(client, "A")
    run_interview(client, cid, "A")
    view = client.post(f"/api/cases/{cid}/plan/generate", headers=CURATOR).json()
    assert view["plan_meta"]["source"] == "llm"
    assert [s["service_id"] for s in view["steps"]] == ["case_intake", "single_doc_package", "specialist_consultation", "pmpk"]
    assert any("hallucinated" in w for w in view["plan_meta"]["warnings"])
