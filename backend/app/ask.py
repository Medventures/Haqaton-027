"""«Вопрос по плану»: the model explains only this family's route, from this case's data only.

Order: guards (no LLM) → hourly limit → model with a strict JSON schema → post-check of the answer.
Any failure gives a fixed fallback answer; the model never decides what the family must do medically.
"""

import json
import logging
from datetime import datetime, timedelta, timezone

from .llm import LLMError, get_llm
from .safety import find_stop_words
from .tracking import fmt

log = logging.getLogger("aqylroute.ask")

MESSAGE_MAX = 300
ANSWER_MAX = 400
LIMIT_PER_HOUR = 10
CONTEXT_TURNS = 5

INSTRUCTIONS = f"""Ты — Луна, помощник по маршруту семьи ребёнка с РАС в Казахстане. Ты не врач.
Отвечай только про шаги этого маршрута: что за шаг, зачем он, какие документы собрать, куда и как подать, какие сроки.
Используй только данные кейса из входа (шаги, статусы, сроки, документы, how_to). Не придумывай адреса, телефоны,
ссылки, суммы, сроки и документы. Если ответа в данных нет — скажи, что уточнит куратор, и поставь needs_curator=true.
Никогда не ставь и не обсуждай диагнозы, не советуй лечение, терапию, препараты, дозы и приёмы поведения.
answer: до {ANSWER_MAX} символов, простым языком на «вы», на языке вопроса (русский или казахский).
step_ids: service_id шагов, о которых ответ (только из входа), или пустой список."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "step_ids", "needs_curator"],
    "properties": {
        "answer": {"type": "string"},
        "step_ids": {"type": "array", "items": {"type": "string"}},
        "needs_curator": {"type": "boolean"},
    },
}


def over_limit(conn, case_id: int) -> bool:
    since = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(microsecond=0).isoformat()
    n = conn.execute("SELECT COUNT(*) FROM ask_log WHERE case_id = ? AND at >= ? AND source IN ('llm', 'fallback')",
                     (case_id, since)).fetchone()[0]
    return n >= LIMIT_PER_HOUR


def history(conn, case_id: int) -> list[dict]:
    rows = conn.execute("SELECT message, answer FROM ask_log WHERE case_id = ? ORDER BY id DESC LIMIT ?",
                        (case_id, CONTEXT_TURNS)).fetchall()
    return [{"вопрос": r["message"], "ответ": r["answer"]} for r in reversed(rows)]


def case_context(steps: list[dict], plan_visible: bool) -> dict:
    return {
        "план_подтверждён": plan_visible,
        "шаги": [{
            "service_id": s["service_id"],
            "название": s["title"],
            "статус": s["status"],
            "срок": fmt(s["due_date"]),
            "просрочен": s["overdue"],
            "что_сделать": s["how_to"],
            "канал": s["channel_label"],
            "не_хватает_документов": [d["name"] for d in s["documents"] if not d["have"] and not d["optional"]],
            "что_откроет": s.get("unlock_hint") or None,
        } for s in steps],
    }


def fallback_answer(steps: list[dict]) -> str:
    active = [s for s in steps if s["status"] in ("todo", "in_progress")]
    if active:
        s = min(active, key=lambda x: (not x["overdue"], x["due_date"]))
        return (f"Сейчас не получается ответить. Ближайший шаг: «{s['title']}», срок {fmt(s['due_date'])}. "
                f"Если нужно, напишите куратору.")
    return "Сейчас не получается ответить. Если нужно, напишите куратору."


def ask_model(message: str, steps: list[dict], plan_visible: bool, turns: list[dict],
              allowed: set[str]) -> tuple[dict | None, str | None]:
    """Returns (answer dict, error). None answer means «use the fallback»."""
    llm = get_llm()
    if llm is None:
        return None, "model unavailable"
    payload = json.dumps({"кейс": case_context(steps, plan_visible), "предыдущие_реплики": turns, "вопрос": message},
                         ensure_ascii=False)
    try:
        data = llm.structured("plan_question", SCHEMA, INSTRUCTIONS, payload)
    except LLMError as e:
        log.warning("ask failed: %s", e)
        return None, "model error"
    answer = str(data.get("answer") or "").strip()
    ids = data.get("step_ids") or []
    if not answer:
        return None, "empty answer"
    if not isinstance(ids, list) or any(not isinstance(i, str) or i not in allowed for i in ids):
        return None, "unknown step ids"
    if find_stop_words(answer):
        return None, "stop words"
    if len(answer) > ANSWER_MAX:
        answer = answer[:ANSWER_MAX - 1].rstrip() + "…"
    return {"answer": answer, "step_ids": list(dict.fromkeys(ids)), "needs_curator": bool(data.get("needs_curator"))}, None

