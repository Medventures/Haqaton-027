"""FAQ built from the catalog and the step's own data. Nothing is invented: a question without data is skipped."""

from . import faq_texts as ft
from .tracking import fmt


def _names(docs: list[dict]) -> str:
    return ", ".join(d["name"] for d in docs)


def step_items(step: dict, service: dict) -> list[dict]:
    items = []

    def add(key: str, answer: str | None) -> None:
        answer = (answer or "").strip()
        if answer:
            items.append({"q": ft.STEP_QUESTIONS[key], "a": answer})

    add("what", service.get("description"))
    if step.get("how_to"):
        channel = f" Канал: {step['channel_label']}." if step.get("channel_label") else ""
        add("where", f"{step['how_to']}{channel}")
    required = [d for d in step["documents"] if not d["optional"]]
    optional = [d for d in step["documents"] if d["optional"]]
    parts = []
    if [d for d in required if d["have"]]:
        parts.append(f"Уже есть: {_names([d for d in required if d['have']])}.")
    if [d for d in required if not d["have"]]:
        parts.append(f"Не хватает: {_names([d for d in required if not d['have']])}.")
    if optional:
        parts.append(f"Если есть: {_names(optional)}.")
    add("docs", " ".join(parts))
    add("duration", step.get("typical_duration"))
    if step["status"] == "locked":
        add("locked", step.get("unlock_hint") or step.get("explanation"))
    elif step.get("overdue"):
        add("overdue", f"Срок был {fmt(step['due_date'])}. {step.get('explanation') or ''}")
    return items


def build(steps: list[dict], services: dict[str, dict]) -> dict:
    return {
        "general": ft.GENERAL,
        "by_step": [{"step_id": s["id"], "service_id": s["service_id"], "title": s["title"],
                     "items": step_items(s, services[s["service_id"]])} for s in steps],
    }
