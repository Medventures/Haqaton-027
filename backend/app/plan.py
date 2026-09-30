"""Генерация Case Plan: набор шагов определяет rules.py, LLM пишет только приоритет (для active) и объяснение."""

import json
import logging

from . import config
from .catalog import STAGES
from .interview import answer_text, barriers_of
from .llm import LLMError, get_llm
from .rules import REASONS, Profile, RuleResult, evaluate_all, stage_for
from .safety import find_stop_words

log = logging.getLogger("aqylroute.plan")

PRIORITIES = ("high", "medium", "low")
PRIORITY_ORDER = {p: i for i, p in enumerate(PRIORITIES)}

PLAN_INSTRUCTIONS = f"""Ты помогаешь куратору объяснить семье ребёнка с РАС шаги межведомственного маршрута.
Набор шагов уже определён системой — не добавляй и не убирай шаги, верни ровно те service_id, что даны.
Для каждого шага:
- priority: high / medium / low только для шагов со state=active (учитывай, что для семьи самое трудное и что мешает); для state=locked — null.
- explanation: 1–2 коротких предложения (до {config.MAX_EXPLANATION_LEN} символов) простым языком на «вы»: зачем этот шаг семье и что он даёт. Для заблокированного шага объясни, что его откроет.
Никогда не ставь и не упоминай диагнозы, не оценивай тяжесть, не давай прогнозов, не советуй лечение, терапию или препараты.
Не придумывай сроки, адреса, суммы и документы — их добавит система."""


def plan_schema(service_ids: list[str]) -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["steps"],
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["service_id", "priority", "explanation"],
                    "properties": {
                        "service_id": {"type": "string", "enum": service_ids},
                        "priority": {"type": ["string", "null"], "enum": [*PRIORITIES, None]},
                        "explanation": {"type": "string"},
                    },
                },
            }
        },
    }


def safe_explanation(sid: str, text: str, services: dict[str, dict]) -> tuple[str, str | None]:
    """Нарушение (пусто, стоп-слова, длиннее лимита) → шаблонное объяснение услуги."""
    text = (text or "").strip()
    template = services[sid]["default_explanation"]
    if not text:
        return template, f"{sid}: пустое объяснение заменено шаблонным"
    bad = find_stop_words(text)
    if bad:
        return template, f"{sid}: стоп-слова ({', '.join(bad)}) — объяснение заменено шаблонным"
    if len(text) > config.MAX_EXPLANATION_LEN:
        return template, f"{sid}: объяснение длиннее {config.MAX_EXPLANATION_LEN} символов — заменено шаблонным"
    return text, None


def validate_llm(data: dict, expected: dict[str, RuleResult], services: dict[str, dict]) -> tuple[dict, list[str], list[str]]:
    """Возвращает ({sid: {priority, explanation}}, предупреждения, ошибки).

    Множество service_id должно совпасть с набором кода один в один; иначе ответ отбрасывается целиком.
    """
    warnings: list[str] = []
    steps = data.get("steps") if isinstance(data, dict) else None
    if not isinstance(steps, list):
        return {}, warnings, ["Ответ не содержит массива steps"]
    ids = [s.get("service_id") for s in steps if isinstance(s, dict)]
    if len(ids) != len(steps) or len(ids) != len(set(ids)) or set(ids) != set(expected):
        extra = sorted({str(i) for i in ids} - set(expected))
        missing = sorted(set(expected) - {str(i) for i in ids})
        return {}, warnings, [f"Набор шагов не совпадает с планом кода (лишние: {extra}, нет: {missing})"]
    out = {}
    for s in steps:
        sid = s["service_id"]
        rule = expected[sid]
        prio = s.get("priority")
        if rule.state == "locked":
            prio = None
        elif prio not in PRIORITIES:
            warnings.append(f"{sid}: нет приоритета — взят базовый")
            prio = rule.base_priority
        explanation, warn = safe_explanation(sid, str(s.get("explanation") or ""), services)
        if warn:
            warnings.append(warn)
        out[sid] = {"priority": prio, "explanation": explanation}
    return out, warnings, []


def fallback_texts(expected: dict[str, RuleResult], services: dict[str, dict]) -> dict:
    return {
        sid: {"priority": None if r.state == "locked" else r.base_priority,
              "explanation": services[sid]["default_explanation"]}
        for sid, r in expected.items()
    }


def _llm_input(expected: dict[str, RuleResult], services: dict[str, dict], p: Profile) -> str:
    slots = p.slots
    return json.dumps({
        "этап": STAGES[stage_for(p.months)],
        "возраст_месяцев": p.months,
        "самое_трудное": answer_text(slots.get("family_priority", "")),
        "что_мешает": barriers_of(slots),
        "цель_на_3_месяца": answer_text(slots.get("family_goal", "")),
        "шаги": [
            {"service_id": sid, "название": services[sid]["title"], "state": r.state,
             "почему": REASONS.get(r.reason_code, ""), "что_откроет": r.unlock_hint}
            for sid, r in expected.items()
        ],
    }, ensure_ascii=False)


def generate(p: Profile, services: dict[str, dict]) -> tuple[dict[str, RuleResult], dict, dict]:
    """Возвращает (набор правил, тексты {sid: {priority, explanation}}, meta). Демо не ломается."""
    expected = evaluate_all(p)
    meta: dict = {"attempts": 0, "warnings": [], "errors": [], "service_ids": list(expected)}
    llm = get_llm()
    if llm is None or not expected:
        meta.update(source="rules", model=None)
        return expected, fallback_texts(expected, services), meta

    meta["model"] = llm.model
    base_input = _llm_input(expected, services, p)
    schema = plan_schema(list(expected))
    user_input = base_input
    for attempt in (1, 2):
        meta["attempts"] = attempt
        try:
            data = llm.structured("case_plan", schema, PLAN_INSTRUCTIONS, user_input)
        except LLMError as e:
            meta["errors"].append(f"Попытка {attempt}: {e}")
            continue
        texts, warnings, errors = validate_llm(data, expected, services)
        meta["warnings"].extend(warnings)
        if not errors:
            meta["source"] = "llm" if attempt == 1 else "llm_retry"
            return expected, texts, meta
        meta["errors"].extend(f"Попытка {attempt}: {e}" for e in errors)
        user_input = base_input + "\n\nПредыдущий ответ отклонён: " + "; ".join(errors) + ". Верни ровно заданный набор шагов."
    log.warning("plan texts fell back after %d attempts", meta["attempts"])
    meta["source"] = "fallback"
    return expected, fallback_texts(expected, services), meta


def owner_for(service: dict, slots: dict) -> str:
    if service.get("executor") == "family":
        who = answer_text(slots.get("family_owner") or "").strip()
        return f"Семья ({who.lower()})" if who else "Семья"
    return service["responsible"]


def blocking_ids(expected: dict[str, RuleResult]) -> set[str]:
    """Steps that a locked step waits for: they always get high priority, whatever the model said."""
    return {d for r in expected.values() if r.state == "locked" for d in r.depends_on if d in expected}


def build_rows(expected: dict[str, RuleResult], texts: dict, services: dict[str, dict], p: Profile) -> list[dict]:
    """Код проставляет ответственного, срок, статус, зависимости и блокер по городу.

    Order: high-priority and overdue steps first, blocking steps first among them, locked steps last.
    """
    order = {sid: i for i, sid in enumerate(services)}
    blocking = blocking_ids(expected)
    prio = {sid: "high" if sid in blocking and r.state == "active" else texts[sid]["priority"]
            for sid, r in expected.items()}

    def rank(sid: str) -> tuple:
        r = expected[sid]
        urgent = prio[sid] == "high" or r.due_date < p.today
        return (not urgent, sid not in blocking, PRIORITY_ORDER[prio[sid] or "low"], order[sid])

    active = sorted((sid for sid, r in expected.items() if r.state == "active"), key=rank)
    locked = [sid for sid, r in expected.items() if r.state == "locked"]
    rows = []
    for pos, sid in enumerate(active + locked, start=1):
        r, svc = expected[sid], services[sid]
        cities = svc.get("available_cities")
        in_city = not cities or (p.city or "").lower() in {c.lower() for c in cities}
        rows.append({
            "position": pos,
            "service_id": sid,
            "priority": prio[sid],
            "base_priority": r.base_priority,
            "owner": owner_for(svc, p.slots),
            "due_date": r.due_date.isoformat(),
            "due_basis": r.due_basis,
            "depends_on": r.depends_on,
            "unlock_date": r.unlock_date.isoformat() if r.unlock_date else None,
            "unlock_hint": r.unlock_hint or "",
            "reason_code": r.reason_code,
            "status": "locked" if r.state == "locked" else "todo",
            "explanation": texts[sid]["explanation"],
            "blocker": None if in_city else "no_service_in_region",
            "blocker_note": "" if in_city else f"Услуги нет в городе {p.city}",
        })
    return rows
