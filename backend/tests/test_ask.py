from app import ask as ak
from app import guards
from app.llm import LLMError

from .conftest import CURATOR, PARENT, ready_plan


def _answer(answer="Для ПМПК подайте заявление на eGov и соберите карту 052/у.", ids=("EDU_PMPK",), needs=False):
    def responder(name, schema, user_input, n):
        assert name == "plan_question"
        return {"answer": answer, "step_ids": list(ids), "needs_curator": needs}
    return responder


def _ask(client, cid, message, role=PARENT):
    return client.post(f"/api/cases/{cid}/ask", json={"message": message}, headers=role)


def _no_llm(fake_llm):
    def responder(*_a):
        raise AssertionError("LLM must not be called")
    return fake_llm(responder)


def test_ask_answers_from_case(client, fake_llm):
    cid = ready_plan(client, "2")
    f = fake_llm(_answer())
    r = _ask(client, cid, "Какие документы нужны для ПМПК?").json()
    assert r["source"] == "llm" and r["answer"].startswith("Для ПМПК")
    assert [s["service_id"] for s in r["steps"]] == ["EDU_PMPK"] and r["steps"][0]["step_id"]
    # The model sees only this case: its steps and the question.
    assert "EDU_PMPK" in f.calls[0]["input"] and "Какие документы нужны для ПМПК?" in f.calls[0]["input"]


def test_medical_question_skips_llm(client, fake_llm):
    cid = ready_plan(client, "2")
    f = _no_llm(fake_llm)
    for q in ("Какие лекарства дать ребёнку?", "Какая доза витаминов нужна?", "Как лечить аутизм?", "Қандай дәрі беру керек?"):
        r = _ask(client, cid, q).json()
        assert r["source"] == "guard_medical" and r["answer"] == guards.MEDICAL_TEXT and r["ask_curator"]
    assert f.calls == []


def test_danger_words_raise_alert(client, fake_llm):
    cid = ready_plan(client, "2")
    f = _no_llm(fake_llm)
    r = _ask(client, cid, "У ребёнка судороги, что делать?").json()
    assert r["source"] == "guard_danger" and "112" in r["answer"] and r["curator_notified"]
    assert client.get(f"/api/cases/{cid}", headers=CURATOR).json()["alert"] is True
    notes = client.get("/api/curator/notifications", headers=CURATOR).json()["items"]
    assert any(n["case_id"] == cid and n["kind"] == "safety" for n in notes)
    assert f.calls == []


def test_danger_beats_medical(client):
    cid = ready_plan(client, "2")
    assert _ask(client, cid, "Сильная боль, какое лекарство дать?").json()["source"] == "guard_danger"


def test_danger_words_do_not_match_plain_words(client):
    assert guards.classify("Когда подавать больше документов в больницу?") is None
    assert guards.classify("Где получить справку МСЭ?") is None


def test_invented_service_id_rejected(client, fake_llm):
    cid = ready_plan(client, "2")
    fake_llm(_answer(ids=("EDU_PMPK", "MED_MAGIC_PILL")))
    r = _ask(client, cid, "Что делать дальше?").json()
    assert r["source"] == "fallback" and r["steps"] == [] and r["curator_notified"]
    assert "Обследование на ПМПК" in r["answer"]  # fallback names the nearest step
    notes = client.get("/api/curator/notifications", headers=CURATOR).json()["items"]
    assert any(n["case_id"] == cid and n["kind"] == "need_help" for n in notes)


def test_stop_words_in_answer_rejected(client, fake_llm):
    cid = ready_plan(client, "2")
    fake_llm(_answer(answer="Вашему ребёнку поставлен диагноз, нужна терапия."))
    assert _ask(client, cid, "Что дальше?").json()["source"] == "fallback"


def test_fallback_on_llm_error(client, fake_llm):
    cid = ready_plan(client, "2")
    fake_llm(lambda *a: LLMError("down"))
    r = _ask(client, cid, "Что делать дальше?")
    assert r.status_code == 200 and r.json()["source"] == "fallback" and r.json()["needs_curator"]


def test_rate_limit(client, fake_llm):
    cid = ready_plan(client, "2")
    fake_llm(_answer())
    for _ in range(ak.LIMIT_PER_HOUR):
        assert _ask(client, cid, "Что дальше?").status_code == 200
    assert _ask(client, cid, "Что дальше?").status_code == 429
    # Danger words are answered even over the limit.
    assert _ask(client, cid, "Ребёнок потерялся").json()["source"] == "guard_danger"


def test_context_is_limited(client, fake_llm):
    cid = ready_plan(client, "2")
    f = fake_llm(_answer())
    for i in range(7):
        _ask(client, cid, f"Вопрос номер {i}")
    last = f.calls[-1]["input"]
    assert "Вопрос номер 1" in last and "Вопрос номер 0" not in last  # 5 previous turns only


def test_message_too_long(client):
    cid = ready_plan(client, "2")
    assert _ask(client, cid, "а" * 301).status_code == 422


def test_unconfirmed_plan_hidden_from_model(client, fake_llm):
    cid = ready_plan(client, "2", confirm=False)
    f = fake_llm(_answer(ids=()))
    _ask(client, cid, "Что дальше?")
    assert "EDU_PMPK" not in f.calls[0]["input"]
