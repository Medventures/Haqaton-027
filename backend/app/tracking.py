"""Просрочки, эскалация, блокеры. Всё считает код при чтении относительно «сегодня»."""

from datetime import date

from . import config

STATUS_LABELS = {"todo": "не начат", "in_progress": "в работе", "done": "выполнен"}
BLOCKERS = ("missing_document", "awaiting_agency", "no_service_in_region", "family_declined")
BLOCKER_LABELS = {
    "missing_document": "не хватает документа",
    "awaiting_agency": "ждём ответа ведомства",
    "no_service_in_region": "услуги нет в регионе",
    "family_declined": "семья отказалась",
}


def overdue_days(due_date: str, status: str, today: date) -> int:
    if status == "done":
        return 0
    return max(0, (today - date.fromisoformat(due_date)).days)


def is_escalated(days_overdue: int) -> bool:
    return days_overdue > config.ESCALATION_AFTER_DAYS


def overdue_reason(step: dict) -> str:
    if step.get("blocker"):
        note = f": {step['blocker_note']}" if step.get("blocker_note") else ""
        return f"Блокер — {BLOCKER_LABELS[step['blocker']]}{note}"
    missing = [d["name"] for d in step.get("documents", []) if not d["have"]]
    if missing:
        return f"Срок истёк; не отмечены документы: {', '.join(missing[:3])}{'…' if len(missing) > 3 else ''}"
    return "Срок истёк, шаг не выполнен"


def fmt(d: str | date) -> str:
    d = date.fromisoformat(d[:10]) if isinstance(d, str) else d
    return d.strftime("%d.%m.%Y")


def notification_draft(step: dict, case_alias: str, today: date) -> dict:
    """Черновик уведомления руководителю ведомства. Реальная отправка не выполняется."""
    subject = f"Просрочен шаг маршрута семьи: {step['title']}"
    body = (
        f"Руководителю ведомства ({step['agency']}).\n\n"
        f"По межведомственному маршруту «{case_alias}» просрочен шаг «{step['title']}».\n"
        f"Ответственный: {step['owner']}.\n"
        f"Срок: {fmt(step['due_date'])}, просрочка: {step['days_overdue']} дн. (на {fmt(today)}).\n"
        f"Текущий статус: {STATUS_LABELS.get(step['status'], step['status'])}.\n"
        f"Причина: {overdue_reason(step)}.\n\n"
        f"Просим назначить исполнителя и сообщить куратору новую дату выполнения.\n"
        f"Куратор семьи"
    )
    return {"to": f"Руководителю организации «{step['owner']}»", "subject": subject, "body": body, "sent": False}
