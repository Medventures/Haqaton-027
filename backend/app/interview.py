"""Интервью по слотам: 12 вопросов из таблицы команды, условия «когда задаётся» — в коде.

LLM только формулирует вопрос по-человечески и пишет краткие формулировки для сводки.
Вопросы 6, 8, 11 и 12 — фиксированные, на кнопках. Тексты вопросов и ответов не логируются.
"""

import json
import logging
from datetime import date

from . import config
from .catalog import (
    BARRIER_OPTIONS, NO_BARRIERS, NO_RED_FLAGS, QUESTIONS, QUESTIONS_BY_ID, RED_FLAG_OPTIONS, SCENARIOS, SLOT_LABELS,
)
from .llm import LLMError, get_llm
from .rules import Profile, age_months
from .safety import is_safe

log = logging.getLogger("aqylroute.interview")

REPHRASE_INSTRUCTIONS = """Ты помогаешь куратору вести короткое интервью с родителем ребёнка с РАС.
Перефразируй заданный вопрос тепло и просто, на «вы», на русском, не длиннее 30 слов. Можно опереться на прошлые ответы,
но смысл вопроса менять нельзя. Не добавляй новых вопросов. Никогда не называй и не предполагай диагнозы,
не проси оценить ребёнка или степень чего-либо, не давай советов по лечению и прогнозов."""

SUMMARY_INSTRUCTIONS = """Сформулируй кратко (до 15 слов каждое), от лица семьи, без оценок и медицинских терминов:
1) самое трудное для семьи сейчас; 2) цель на 3 месяца. Используй только то, что сказал родитель."""


def answered(items: list[dict]) -> dict[str, object]:
    return {i["qid"]: i["answer"] for i in items if i.get("answer") is not None}


def pending(items: list[dict]) -> dict | None:
    return items[-1] if items and items[-1].get("answer") is None else None


def slots_from(items: list[dict]) -> dict:
    return {QUESTIONS_BY_ID[qid]["slot"]: ans for qid, ans in answered(items).items() if qid != "12"}


def applicable(qid: str, case: dict, answers: dict, today: date) -> bool:
    p = Profile(case, set(), today)
    if qid == "1":
        return p.pmpk_valid
    if qid == "1a":
        return answers.get("1") == "Не получает"
    if qid == "3":
        return p.has_conclusion
    if qid == "4":
        return p.mse_ever
    if qid == "5":
        return p.has_conclusion and p.conclusion_older_than_4m and not p.mse_valid
    return True  # 2, 6–12: всегда


def plan_of_questions(case: dict, items: list[dict], today: date) -> list[str]:
    """Какие вопросы будут заданы при текущих ответах (для прогресса и тестов)."""
    answers = answered(items)
    return [q["id"] for q in QUESTIONS if q["id"] in answers or applicable(q["id"], case, answers, today)]


def next_qid(case: dict, items: list[dict], today: date) -> str | None:
    answers = answered(items)
    for q in QUESTIONS:
        if q["id"] not in answers and applicable(q["id"], case, answers, today):
            return q["id"]
    return None


def normalize_answer(qid: str, answer):
    q = QUESTIONS_BY_ID[qid]
    if q["type"] == "multi":
        vals = answer if isinstance(answer, list) else [answer]
        vals = [str(v).strip() for v in vals if str(v).strip()]
        # «Ничего из этого» / «Ничего не мешает» не сочетаются с другими вариантами.
        exclusive = {NO_RED_FLAGS, NO_BARRIERS}
        if len(vals) > 1:
            vals = [v for v in vals if v not in exclusive]
        return vals
    if isinstance(answer, list):
        answer = "; ".join(str(a) for a in answer)
    return str(answer).strip()


def answer_text(answer) -> str:
    return "; ".join(answer) if isinstance(answer, list) else str(answer)


def red_flags_of(slots: dict) -> list[str]:
    return [v for v in (slots.get("red_flags") or []) if v in RED_FLAG_OPTIONS]


def barriers_of(slots: dict) -> list[str]:
    return [v for v in (slots.get("barriers") or []) if v != NO_BARRIERS]


def _rephrase(qid: str, case: dict, items: list[dict], today: date) -> tuple[str, str]:
    q = QUESTIONS_BY_ID[qid]
    llm = get_llm()
    if llm is None or not q["llm"]:
        return q["text"], "template"
    payload = {
        "ребёнок": {"возраст_месяцев": age_months(date.fromisoformat(case["birth_date"]), today), "город": case["city"]},
        "прошлые_ответы": [{"вопрос": i["text"], "ответ": answer_text(i["answer"])} for i in items if i.get("answer") is not None],
        "вопрос": q["text"],
        "варианты_ответа": q["options"],
    }
    schema = {
        "type": "object", "additionalProperties": False, "required": ["text"],
        "properties": {"text": {"type": "string"}},
    }
    try:
        data = llm.structured("interview_question", schema, REPHRASE_INSTRUCTIONS, json.dumps(payload, ensure_ascii=False))
    except LLMError as e:
        log.warning("rephrase failed for q%s: %s", qid, e)
        return q["text"], "template"
    text = str(data.get("text") or "").strip()
    if not text or len(text) > 300 or not is_safe(text):
        log.warning("rephrase rejected for q%s", qid)
        return q["text"], "template"
    return text, "llm"


def summary(case: dict, items: list[dict]) -> dict:
    """Сводка по слотам для вопроса 12 «Правильно ли я понял?» — собирает код."""
    slots = slots_from(items)
    short = (case.get("profile") or {}).get("_short") or {}
    lines = []
    for q in QUESTIONS:
        slot = q["slot"]
        if q["id"] == "12" or slot not in slots:
            continue
        value = answer_text(slots[slot])
        if slot in ("family_priority", "family_goal") and short.get(slot):
            value = short[slot]
        lines.append({"slot": slot, "question_id": q["id"], "label": SLOT_LABELS[slot], "value": value,
                      "raw": slots[slot], "options": q["options"], "type": q["type"]})
    flags = red_flags_of(slots)
    return {
        "lines": lines,
        "red_flags": flags,
        "handling_mode": "curator" if barriers_of(slots) else "system",
        "confirmed": bool(case.get("summary_confirmed")),
    }


def short_formulations(items: list[dict]) -> dict:
    """LLM пишет краткие формулировки ответов 7 и 10 для сводки; без LLM — исходный текст."""
    slots = slots_from(items)
    base = {k: slots.get(k) for k in ("family_priority", "family_goal") if slots.get(k)}
    llm = get_llm()
    if llm is None or not base:
        return {}
    schema = {
        "type": "object", "additionalProperties": False, "required": ["family_priority", "family_goal"],
        "properties": {"family_priority": {"type": "string"}, "family_goal": {"type": "string"}},
    }
    try:
        data = llm.structured("summary_short", schema, SUMMARY_INSTRUCTIONS, json.dumps(base, ensure_ascii=False))
    except LLMError as e:
        log.warning("summary formulation failed: %s", e)
        return {}
    return {k: v.strip() for k, v in data.items() if k in base and v and len(v) <= 200 and is_safe(v)}


def make_item(qid: str, case: dict, items: list[dict], today: date, use_llm: bool = True) -> dict:
    q = QUESTIONS_BY_ID[qid]
    if qid == "12":
        text, source = "Правильно ли я понял? Проверьте сводку и поправьте, если нужно.", "template"
    elif use_llm:
        text, source = _rephrase(qid, case, items, today)
    else:
        text, source = q["text"], "template"
    return {"qid": qid, "slot": q["slot"], "text": text, "type": q["type"], "options": list(q["options"]),
            "answer": None, "source": source, "n": len(items) + 1}


def autofill_answers(scenario_key: str) -> dict:
    return SCENARIOS[scenario_key]["answers"]


def progress(case: dict, items: list[dict], today: date) -> dict:
    planned = plan_of_questions(case, items, today)
    return {
        "asked": len(items),
        "answered": len(answered(items)),
        "expected_total": len(planned),
        "max_questions": config.MAX_QUESTIONS,
        "min_questions": config.MIN_QUESTIONS,
        "planned": planned,
    }


__all__ = [
    "BARRIER_OPTIONS", "answered", "pending", "slots_from", "applicable", "plan_of_questions", "next_qid",
    "normalize_answer", "answer_text", "red_flags_of", "barriers_of", "summary", "short_formulations", "make_item",
    "autofill_answers", "progress",
]
