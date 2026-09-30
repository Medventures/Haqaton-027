"""Генерация Case Plan: модель выбирает услуги из справочника, приоритет и объяснение;
код валидирует и достраивает всё остальное (ответственный, срок, документы, статус, блокер)."""

import json
import logging
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel

from . import config
from .catalog import BASE_SERVICES, TOPIC_LABELS
from .interview import age_text, answer_text
from .llm import LLMError, get_llm
from .safety import find_stop_words

log = logging.getLogger("aqylroute.plan")

PRIORITIES = ("high", "medium", "low")
PRIORITY_ORDER = {p: i for i, p in enumerate(PRIORITIES)}

PLAN_INSTRUCTIONS = f"""Ты помогаешь куратору составить межведомственный маршрут помощи семье ребёнка с особенностями развития (медицина, образование, соцзащита).

На входе: возраст ребёнка, город, ответы родителя из интервью и справочник услуг.
Задача: выбрать из справочника услуги, которые нужны именно этой семье, расположить их в разумном порядке (сначала то, что открывает доступ к следующим шагам) и назначить приоритет high / medium / low.

Правила:
- service_id — строго из справочника. Никаких услуг вне справочника.
- Учитывай возрастные ограничения услуг (min_age_months / max_age_months).
- Каждая услуга не более одного раза. Обычно 6–12 шагов.
- Не включай то, что у семьи уже есть (например, если заключение ПМПК на руках — ПМПК не нужна).
- explanation: 1–2 коротких предложения (до {config.MAX_EXPLANATION_LEN} символов) простым языком на «вы» — зачем этот шаг семье и что он даёт. Опирайся на ответы родителя.
- Никогда не ставь и не упоминай диагнозы, не оценивай тяжесть, не давай прогнозов, не советуй лечение, терапию или препараты.
- Не придумывай сроки, адреса и документы — их добавит система."""


class _StepOut(BaseModel):
    service_id: str
    priority: Literal["high", "medium", "low"]
    explanation: str


class PlanOut(BaseModel):
    steps: list[_StepOut]


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
                        "priority": {"type": "string", "enum": list(PRIORITIES)},
                        "explanation": {"type": "string"},
                    },
                },
            }
        },
    }


def fits_age(svc: dict, months: int | None) -> bool:
    if months is None:
        return True
    if svc.get("min_age_months") is not None and months < svc["min_age_months"]:
        return False
    if svc.get("max_age_months") is not None and months > svc["max_age_months"]:
        return False
    return True


def available_in(svc: dict, city: str | None) -> bool:
    cities = svc.get("available_cities")
    if not cities or not city:
        return True
    return city.strip().lower() in {c.lower() for c in cities}


def due_date_for(base: date, service: dict) -> date:
    """Срок = «сегодня» на момент формирования шага + default_deadline_days. От приоритета не зависит."""
    return base + timedelta(days=int(service["default_deadline_days"]))


def safe_explanation(sid: str, text: str, services: dict[str, dict]) -> tuple[str, str | None]:
    """Возвращает (объяснение, предупреждение). Нарушение → шаблонное объяснение услуги."""
    text = (text or "").strip()
    if not text:
        return services[sid]["default_explanation"], f"{sid}: пустое объяснение заменено шаблонным"
    bad = find_stop_words(text)
    if bad:
        return services[sid]["default_explanation"], f"{sid}: стоп-слова ({', '.join(bad)}) — объяснение заменено шаблонным"
    if len(text) > config.MAX_EXPLANATION_LEN:
        return services[sid]["default_explanation"], f"{sid}: объяснение длиннее {config.MAX_EXPLANATION_LEN} символов — заменено шаблонным"
    return text, None


def validate_plan(data: dict, services: dict[str, dict], months: int | None = None) -> tuple[list[dict], list[str], list[str]]:
    """Возвращает (шаги, предупреждения, ошибки). Ошибки => повтор запроса или запасной план."""
    warnings: list[str] = []
    errors: list[str] = []
    raw_steps = data.get("steps") if isinstance(data, dict) else None
    if not isinstance(raw_steps, list):
        return [], warnings, ["Ответ не содержит массива steps"]
    steps: list[dict] = []
    seen: set[str] = set()
    for idx, raw in enumerate(raw_steps):
        if not isinstance(raw, dict):
            errors.append(f"Шаг {idx + 1}: не объект")
            continue
        sid = raw.get("service_id")
        if sid not in services:
            warnings.append(f"Отброшен шаг вне справочника: {sid!r}")
            continue
        if sid in seen:
            warnings.append(f"Отброшен дубль: {sid}")
            continue
        if not fits_age(services[sid], months):
            warnings.append(f"Отброшен шаг не по возрасту: {sid}")
            continue
        priority = raw.get("priority")
        if priority not in PRIORITIES:
            errors.append(f"{sid}: недопустимый приоритет {priority!r}")
            continue
        explanation, warn = safe_explanation(sid, str(raw.get("explanation") or ""), services)
        if warn:
            warnings.append(warn)
        seen.add(sid)
        steps.append({"service_id": sid, "priority": priority, "explanation": explanation})
    if not steps and not errors:
        errors.append("План пуст")
    if not errors:
        # Базовый набор всегда идёт первым и в фиксированном порядке; недостающие шаги добавляет код.
        by_id = {st["service_id"]: st for st in steps}
        head = []
        for sid in BASE_SERVICES:
            if sid in by_id:
                head.append(by_id[sid])
            elif sid in services:
                head.append({"service_id": sid, "priority": "high", "explanation": services[sid]["default_explanation"]})
                warnings.append(f"Добавлен обязательный шаг базового набора: {sid}")
        steps = head + [st for st in steps if st["service_id"] not in BASE_SERVICES]
    return steps, warnings, errors


def _answers(interview: dict) -> dict:
    return {i["topic"]: i["answer"] for i in interview.get("items", []) if i.get("answer") is not None}


def _as_list(v) -> list[str]:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def rules_plan(interview: dict, services: dict[str, dict], months: int | None, language: str = "ru") -> list[dict]:
    """Детерминированный план по ответам: демо-режим и запасной план при сбое модели.

    Всегда содержит базовый набор; все шаги проходят возрастной фильтр.
    """
    a = _answers(interview)
    concern = answer_text(a.get("main_concern", ""))
    docs = _as_list(a.get("documents_on_hand"))
    help_ = _as_list(a.get("current_help"))
    edu = answer_text(a.get("education", ""))
    acc = answer_text(a.get("accessibility", ""))
    fam = answer_text(a.get("family_support", ""))
    m = months if months is not None else 60

    picked: list[tuple[str, str]] = []

    def add(sid: str, prio: str) -> None:
        if sid in services and sid not in {s for s, _ in picked} and fits_age(services[sid], months):
            picked.append((sid, prio))

    for sid in BASE_SERVICES:
        add(sid, "high")
    if m < 36:
        add("early_intervention", "high")
    if "Медицинские заключения" not in docs:
        add("pediatrician_visit", "high")
        add("specialist_consultation", "high" if "специалист" in concern else "medium")
        add("hearing_vision_check", "medium")
    edu_need = any(k in edu for k in ("Не ходит", "очеред", "без поддержки", "Не учится", "Дома"))
    if "Заключение ПМПК" not in docs:
        add("pmpk", "high" if ("сад" in concern or "школ" in concern or edu_need) else "medium")
    if m >= 84:
        if "на дому" in edu:
            add("home_schooling", "medium")
        elif edu_need:
            add("school_support", "high" if "школ" in concern else "medium")
    elif edu_need:
        add("inclusive_kindergarten", "high" if "сад" in concern else "medium")
    add("correction_cabinet", "high" if "речи" in concern else "medium")
    if "Справка об инвалидности" not in docs:
        add("msek_referral", "medium")
        add("disability_assessment", "high" if "выплат" in concern else "medium")
        add("child_benefit", "medium")
    elif "Получаем пособие" not in help_:
        add("child_benefit", "high")
        add("individual_program", "medium")
    add("daily_skills_training", "high" if "быт" in concern else "medium")
    if "быт" in concern:
        add("day_care_services", "medium")
    if acc and "без трудностей" not in acc:
        add("social_taxi", "medium")
    if "родител" in concern:
        add("parent_support", "high")
    elif fam and "родственники" not in fam:
        add("parent_support", "medium")
    else:
        add("parent_support", "low")
    if language == "kk":
        add("language_support", "low")

    return [
        {"service_id": sid, "priority": prio, "explanation": services[sid]["default_explanation"]}
        for sid, prio in picked
    ]


def _plan_input(interview: dict, services: dict[str, dict], months: int | None, city: str | None) -> str:
    qa = [
        {"тема": TOPIC_LABELS.get(i["topic"], "уточнение"), "вопрос": i["question"], "ответ": answer_text(i["answer"])}
        for i in interview.get("items", [])
        if i.get("answer") is not None
    ]
    catalog = [
        {
            "id": s["id"],
            "название": s["title"],
            "ведомство": s["agency"],
            "область": s["domain"],
            "описание": s["description"],
            "min_age_months": s["min_age_months"],
            "max_age_months": s["max_age_months"],
        }
        for s in services.values()
    ]
    child = {"возраст_месяцев": months, "возраст": age_text(months) if months is not None else None, "город": city}
    return json.dumps({"ребёнок": child, "интервью": qa, "справочник_услуг": catalog}, ensure_ascii=False)


def generate_steps(interview: dict, services: dict[str, dict], months: int | None = None,
                   city: str | None = None, language: str = "ru") -> tuple[list[dict], dict]:
    """Возвращает (шаги без дат, meta). Демо не ломается: при любой ошибке — запасной план."""
    llm = get_llm()
    meta: dict = {"attempts": 0, "warnings": [], "errors": []}
    if llm is None:
        meta.update(source="rules", model=None)
        return rules_plan(interview, services, months, language), meta

    meta["model"] = llm.model
    base_input = _plan_input(interview, services, months, city)
    schema = plan_schema(list(services.keys()))
    user_input = base_input
    for attempt in (1, 2):
        meta["attempts"] = attempt
        try:
            data = llm.structured("case_plan", schema, PLAN_INSTRUCTIONS, user_input, model_cls=PlanOut)
        except LLMError as e:
            meta["errors"].append(f"Попытка {attempt}: {e}")
            continue
        steps, warnings, errors = validate_plan(data, services, months)
        meta["warnings"].extend(warnings)
        if not errors:
            meta["source"] = "llm" if attempt == 1 else "llm_retry"
            return steps, meta
        meta["errors"].extend(f"Попытка {attempt}: {err}" for err in errors)
        user_input = base_input + "\n\nПредыдущий ответ отклонён проверкой: " + "; ".join(errors) + \
            ". Исправь и верни план заново, соблюдая все правила."
    log.warning("plan generation fell back after %d attempts", meta["attempts"])
    meta["source"] = "fallback"
    return rules_plan(interview, services, months, language), meta


def build_row(position: int, service: dict, priority: str, explanation: str, base: date, city: str | None) -> dict:
    """Код достраивает шаг: ответственный, документы, срок, статус и блокер по городу."""
    in_city = available_in(service, city)
    return {
        "position": position,
        "service_id": service["id"],
        "priority": priority,
        "owner": service["responsible"],
        "due_date": due_date_for(base, service).isoformat(),
        "documents": [{"name": d, "have": False} for d in service["required_documents"]],
        "status": "todo",
        "explanation": explanation,
        "blocker": None if in_city else "no_service_in_region",
        "blocker_note": "" if in_city else f"Услуга недоступна в городе {city}. Нужна альтернатива или выезд.",
    }


def build_rows(steps: list[dict], services: dict[str, dict], base: date, city: str | None = None) -> list[dict]:
    return [
        build_row(pos, services[st["service_id"]], st["priority"], st["explanation"], base, city)
        for pos, st in enumerate(steps, start=1)
    ]
