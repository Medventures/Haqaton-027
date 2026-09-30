"""Адаптивное интервью: код ведёт учёт тем и лимитов, модель формулирует следующий вопрос.

Тексты вопросов и ответов не логируются.
"""

import json
import logging
from datetime import date

from . import config
from .catalog import (
    CONCERN_TOPIC_ORDER,
    FOLLOW_UP,
    MOCK_FOLLOW_UPS,
    QUESTION_TEMPLATES,
    SCENARIOS,
    TOPIC_IDS,
    TOPIC_LABELS,
)
from .llm import LLMError, get_llm
from .safety import is_safe

log = logging.getLogger("aqylroute.interview")

INTERVIEW_INSTRUCTIONS = """Ты — доброжелательный помощник куратора. Ты проводишь короткое интервью с родителем ребёнка с особенностями развития, чтобы собрать маршрут помощи через медицину, образование и соцзащиту.

Правила:
- Задай РОВНО ОДИН следующий вопрос простым языком, на «вы», на русском, не длиннее 25 слов.
- topic выбирай только из allowed_topics. "follow_up" — уточнение к последнему ответу, только если оно действительно нужно для маршрута.
- Учитывай возраст ребёнка и уже данные ответы: следующий вопрос должен логично из них вытекать. Не повторяй уже заданные вопросы.
- Про общение, поведение и ощущения проси рассказать своими словами (type=text, пустой options).
- Для остальных тем можно предложить 2–6 коротких вариантов (type=single или multi).
- Никогда не ставь, не предполагай и не называй диагнозы. Не проси оценить ребёнка, степень или тяжесть чего-либо. Не давай прогнозов и советов по лечению или терапии.
- Не спрашивай ФИО, ИИН, адрес, телефон и другие персональные данные.
- Поле done всегда false — завершение интервью решает система."""


def age_months(birth_date: str, today: date) -> int:
    b = date.fromisoformat(birth_date)
    months = (today.year - b.year) * 12 + (today.month - b.month)
    if today.day < b.day:
        months -= 1
    return max(0, months)


def age_text(months: int) -> str:
    years, rest = divmod(months, 12)
    if years == 0:
        return f"{months} мес."
    return f"{years} г. {rest} мес." if rest else f"{years} г."


def _answered(items: list[dict]) -> list[dict]:
    return [i for i in items if i.get("answer") is not None]


def covered_topics(items: list[dict], case: dict) -> list[str]:
    done = {i["topic"] for i in _answered(items)}
    if case.get("birth_date") and case.get("city"):
        done.add("age_city")  # закрыто формой создания кейса
    return [t for t in TOPIC_IDS if t in done]


def open_topics(items: list[dict], case: dict) -> list[str]:
    covered = set(covered_topics(items, case))
    return [t for t in TOPIC_IDS if t not in covered]


def pending(items: list[dict]) -> dict | None:
    return items[-1] if items and items[-1].get("answer") is None else None


def allowed_topics(items: list[dict], case: dict) -> list[str]:
    """Темы, которые можно спросить следующим вопросом, не нарушая лимит 12."""
    asked = len(items)
    remaining_budget = config.MAX_QUESTIONS - asked
    opened = open_topics(items, case)
    allowed = list(opened)
    last_is_follow_up = bool(items) and items[-1]["topic"] == FOLLOW_UP
    if items and not last_is_follow_up and remaining_budget - 1 >= len(opened):
        allowed.append(FOLLOW_UP)
    if not opened and asked < config.MIN_QUESTIONS:
        allowed = [FOLLOW_UP]
    return allowed


def should_finish(items: list[dict], case: dict) -> bool:
    asked = len(_answered(items))
    if asked >= config.MAX_QUESTIONS:
        return True
    return not open_topics(items, case) and asked >= config.MIN_QUESTIONS


def normalize_answer(answer) -> str | list[str]:
    if isinstance(answer, list):
        return [str(a).strip() for a in answer if str(a).strip()]
    return str(answer).strip()


def answer_text(answer) -> str:
    return "; ".join(answer) if isinstance(answer, list) else str(answer)


def question_schema(allowed: list[str]) -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["question", "type", "options", "topic", "done"],
        "properties": {
            "question": {"type": "string"},
            "type": {"type": "string", "enum": ["single", "multi", "text"]},
            "options": {"type": "array", "items": {"type": "string"}},
            "topic": {"type": "string", "enum": allowed},
            "done": {"type": "boolean"},
        },
    }


def template_for(topic: str, months: int | None) -> dict:
    tpl = QUESTION_TEMPLATES[topic]
    q = {"question": tpl["question"], "type": tpl["type"], "options": list(tpl["options"]), "topic": topic}
    variants = tpl.get("by_age")
    if variants and months is not None:
        key = "under3" if months < 36 else "school" if months >= 84 else None
        if key and key in variants:
            q.update(question=variants[key]["question"], options=list(variants[key]["options"]))
    return q


def _concern(items: list[dict]) -> str | None:
    for i in _answered(items):
        if i["topic"] == "main_concern":
            return answer_text(i["answer"])
    return None


def _template_question(items: list[dict], allowed: list[str], months: int | None) -> dict:
    """Детерминированный адаптивный вопрос (демо-режим и запасной вариант при сбое модели)."""
    answered = _answered(items)
    last = answered[-1] if answered else None
    if last and FOLLOW_UP in allowed:
        for fu in MOCK_FOLLOW_UPS:
            already = any(i.get("follow_up_of") == fu["after_topic"] for i in items)
            ans = last["answer"] if isinstance(last["answer"], list) else [last["answer"]]
            if last["topic"] == fu["after_topic"] and not already and set(ans) & set(fu["when_any"]):
                return {
                    "question": fu["question"],
                    "type": fu["type"],
                    "options": list(fu["options"]),
                    "topic": FOLLOW_UP,
                    "follow_up_of": fu["after_topic"],
                }
    topics = [t for t in allowed if t != FOLLOW_UP]
    if not topics:
        return {
            "question": "Есть ли что-то ещё, что куратору важно знать о ситуации семьи?",
            "type": "text",
            "options": [],
            "topic": FOLLOW_UP,
        }
    # Сначала главная забота, затем темы, которые из неё вытекают, затем остальные по порядку.
    preferred = ["main_concern"] + CONCERN_TOPIC_ORDER.get(_concern(items) or "", [])
    topic = next((t for t in preferred if t in topics), topics[0])
    return template_for(topic, months)


def _llm_question(items: list[dict], allowed: list[str], case: dict, months: int | None) -> dict | None:
    llm = get_llm()
    if llm is None:
        return None
    history = [
        {"topic": i["topic"], "question": i["question"], "answer": answer_text(i["answer"])}
        for i in _answered(items)
    ]
    payload = {
        "child": {"age": age_text(months) if months is not None else None, "city": case.get("city")},
        "covered_topics": [TOPIC_LABELS[t] for t in covered_topics(items, case)],
        "history": history,
        "allowed_topics": [{"id": t, "label": TOPIC_LABELS.get(t, "уточнение к последнему ответу")} for t in allowed],
        "question_number": len(items) + 1,
        "max_questions": config.MAX_QUESTIONS,
    }
    try:
        data = llm.structured(
            "interview_question",
            question_schema(allowed),
            INTERVIEW_INSTRUCTIONS,
            json.dumps(payload, ensure_ascii=False),
        )
    except LLMError as e:
        log.warning("interview LLM failed, using template: %s", e)
        return None
    q = str(data.get("question", "")).strip()
    qtype = data.get("type")
    topic = data.get("topic")
    options = [str(o).strip() for o in data.get("options") or [] if str(o).strip()][:8]
    if not q or topic not in allowed or qtype not in ("single", "multi", "text"):
        log.warning("interview LLM output rejected: bad structure (topic=%s, type=%s)", topic, qtype)
        return None
    if not is_safe(q) or not all(is_safe(o) for o in options):
        log.warning("interview LLM output rejected: stop words (topic=%s)", topic)
        return None
    if qtype != "text" and len(options) < 2:
        qtype, options = "text", []
    if qtype == "text":
        options = []
    return {"question": q, "type": qtype, "options": options, "topic": topic}


def next_question(items: list[dict], case: dict, today: date) -> tuple[dict, str]:
    months = age_months(case["birth_date"], today) if case.get("birth_date") else None
    allowed = allowed_topics(items, case)
    q = _llm_question(items, allowed, case, months)
    if q is not None:
        return q, "llm"
    return _template_question(items, allowed, months), "template"


def autofill(items: list[dict], case: dict, scenario_key: str, today: date) -> list[dict]:
    """«Заполнить демо-ответами»: оставшиеся темы закрываются ответами синтетического сценария."""
    sc = SCENARIOS[scenario_key]
    months = age_months(case["birth_date"], today) if case.get("birth_date") else None
    p = pending(items)
    if p is not None:
        p["answer"] = sc["answers"].get(p["topic"], sc["follow_up_answer"])
        p["autofilled"] = True
    for topic in open_topics(items, case):
        if topic not in sc["answers"]:
            continue
        q = template_for(topic, months)
        q.update(n=len(items) + 1, answer=sc["answers"][topic], source="template", autofilled=True,
                 topic_label=TOPIC_LABELS[topic])
        items.append(q)
    return items
