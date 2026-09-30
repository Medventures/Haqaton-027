"""Статусы, разблокировка, сроки, эскалация, уведомления и «Помощь семье». Всё считается кодом при чтении."""

import json
from datetime import date, timedelta

from . import config, db
from .catalog import CHANNELS
from .rules import date_unlock_hint

STATUS_LABELS = {"locked": "заблокирован", "todo": "не начат", "in_progress": "в работе", "done": "выполнен"}
BLOCKERS = ("missing_document", "awaiting_agency", "no_service_in_region", "family_declined", "decision_disputed")
BLOCKER_LABELS = {
    "missing_document": "не хватает документа",
    "awaiting_agency": "ждём ответа ведомства",
    "no_service_in_region": "услуги нет в регионе",
    "family_declined": "семья отказалась",
    "decision_disputed": "не согласны с решением",
}
DISPUTE_HINT = ("Если вы не согласны с решением МСЭ, жалобу подают через eOtinish (по данным команды — в течение месяца), "
                "затем — в суд. Сроки и порядок уточните по официальным источникам.")


def fmt(d: str | date) -> str:
    d = date.fromisoformat(d[:10]) if isinstance(d, str) else d
    return d.strftime("%d.%m.%Y")


def overdue_text(days: int) -> str:
    """«1461 дн.» reads like a bug in the demo; anything past a year is shown as «более года»."""
    return "более года" if days > 365 else f"{days} дн."


def unlocked_explanation(row: dict, services: dict[str, dict], unlock: date | None) -> str:
    """Template text for a step that has just opened (no LLM): the old «what will open it» text is stale."""
    svc = services[row["service_id"]]
    deps = [services[d]["title"] for d in json.loads(row["depends_on"]) if d in services]
    if deps:
        why = "выполнен шаг " + ", ".join(f"«{t}»" for t in deps)
    elif row["service_id"] == "SOC_MSE_REEXAM":
        why = f"до окончания справки МСЭ осталось не больше {config.MSE_LEAD_DAYS} дней"
    elif unlock:
        why = f"наступила дата открытия {fmt(unlock)}"
    else:
        why = "условия выполнены"
    return f"Шаг открыт: {why}. {svc['default_explanation']}"


def overdue_days(due_date: str, status: str, today: date) -> int:
    if status not in ("todo", "in_progress"):
        return 0  # заблокированный и выполненный шаг не бывает просроченным
    return max(0, (today - date.fromisoformat(due_date)).days)


def is_escalated(days_overdue: int) -> bool:
    return days_overdue > config.ESCALATION_AFTER_DAYS


def due_soon_threshold(service: dict) -> int:
    return service.get("due_soon_days") or config.DUE_SOON_DAYS


def step_documents(service: dict, folder: dict[str, dict]) -> list[dict]:
    docs = []
    for doc_id in service["required_documents"]:
        docs.append({**folder[doc_id], "optional": False})
    for doc_id in service.get("optional_documents") or []:
        docs.append({**folder[doc_id], "optional": True})
    return docs


def notify(conn, case_id: int, step_id: int | None, type_: str, audience: str, message: str) -> None:
    """Идемпотентно: один раз на (кейс, шаг, тип, аудитория)."""
    key = f"{case_id}:{step_id or 0}:{type_}:{audience}"
    conn.execute(
        "INSERT OR IGNORE INTO notifications (case_id, step_id, type, audience, message, dedup_key, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (case_id, step_id, type_, audience, message, key, db.now_iso()),
    )


def refresh_steps(conn, case: dict, services: dict[str, dict], today: date) -> list[dict]:
    """Снимает блокировки, считает overdue / due_soon / escalated, пишет уведомления. Возвращает шаги для API."""
    rows = [dict(r) for r in conn.execute("SELECT * FROM plan_steps WHERE case_id = ? ORDER BY position", (case["id"],))]
    by_sid = {r["service_id"]: r for r in rows}
    confirmed = case["status"] == "confirmed"
    alias = case["child_alias"]

    for r in rows:
        deps = json.loads(r["depends_on"])
        deps_done = all(by_sid[d]["status"] == "done" for d in deps if d in by_sid)
        unlock = date.fromisoformat(r["unlock_date"]) if r["unlock_date"] else None
        date_ok = unlock is None or unlock <= today
        svc = services[r["service_id"]]
        if r["status"] == "locked" and deps_done and date_ok:
            r["status"] = "todo"
            r["priority"] = r["priority"] or r["base_priority"]
            if r["due_basis"] == "default":
                r["due_date"] = (today + timedelta(days=svc["default_deadline_days"])).isoformat()
            r["explanation"], r["unlock_hint"] = unlocked_explanation(r, services, unlock), ""
            conn.execute("UPDATE plan_steps SET status = 'todo', priority = ?, due_date = ?, explanation = ?, unlock_hint = '', "
                         "updated_at = ? WHERE id = ?",
                         (r["priority"], r["due_date"], r["explanation"], db.now_iso(), r["id"]))
            if deps and confirmed:
                notify(conn, case["id"], r["id"], "unlocked", "curator",
                       f"Открыт шаг «{svc['title']}» ({alias}): срок {fmt(r['due_date'])}.")
        elif r["status"] == "todo" and not deps and unlock and today < unlock:
            # Шаг открылся по дате, а дату демо вернули назад — снова «предстоящий».
            r["status"], r["priority"] = "locked", None
            r["unlock_hint"] = date_unlock_hint(r["service_id"], unlock, date.fromisoformat(r["due_date"]))
            r["explanation"] = svc["default_explanation"]
            conn.execute("UPDATE plan_steps SET status = 'locked', priority = NULL, unlock_hint = ?, explanation = ?, "
                         "updated_at = ? WHERE id = ?", (r["unlock_hint"], r["explanation"], db.now_iso(), r["id"]))

    folder = db.load_case_documents(conn, case["id"], today)
    out = []
    for r in rows:
        svc = services[r["service_id"]]
        st = dict(r)
        st["depends_on"] = json.loads(r["depends_on"])
        st.update(title=svc["title"], agency=svc["agency"], domain=svc["domain"], channel=svc["channel"],
                  channel_label=CHANNELS.get(svc["channel"], svc["channel"]), responsible=svc["responsible"],
                  how_to=svc["how_to"], typical_duration=svc["typical_duration"], egov_url=svc["egov_url"])
        st["documents"] = step_documents(svc, folder)
        st["docs_missing"] = sum(1 for d in st["documents"] if not d["have"] and not d["optional"])
        active = st["status"] in ("todo", "in_progress")
        st["days_to_due"] = (date.fromisoformat(st["due_date"]) - today).days if st["status"] != "done" else None
        st["days_overdue"] = overdue_days(st["due_date"], st["status"], today)
        st["overdue"] = st["days_overdue"] > 0
        st["due_soon"] = active and 0 <= st["days_to_due"] <= due_soon_threshold(svc)
        esc = is_escalated(st["days_overdue"])
        if esc != bool(r["escalated"]):
            conn.execute("UPDATE plan_steps SET escalated = ? WHERE id = ?", (int(esc), r["id"]))
        st["escalated"] = esc
        st["indicator"] = ("done" if st["status"] == "done" else "locked" if st["status"] == "locked"
                           else "escalated" if esc else "overdue" if st["overdue"] else "due_soon" if st["due_soon"] else "ok")
        st["blocker_label"] = BLOCKER_LABELS.get(st["blocker"]) if st["blocker"] else None
        if confirmed:
            if st["overdue"]:
                notify(conn, case["id"], st["id"], "overdue", "curator",
                       f"Просрочен шаг «{svc['title']}» ({alias}): {overdue_text(st['days_overdue'])}")
            if esc:
                notify(conn, case["id"], st["id"], "escalation", "curator",
                       f"Эскалация: «{svc['title']}» ({alias}) просрочен на {overdue_text(st['days_overdue'])}")
            if st["due_soon"]:
                notify(conn, case["id"], st["id"], "due_soon", "curator",
                       f"Скоро срок: «{svc['title']}» ({alias}) — до {fmt(st['due_date'])}.")
                parent_msg = (f"Срок справки МСЭ истекает {fmt(st['due_date'])}: соберите документы"
                              if st["service_id"] == "SOC_MSE_REEXAM"
                              else f"Скоро срок шага «{svc['title']}»: {fmt(st['due_date'])}")
                notify(conn, case["id"], st["id"], "due_soon", "parent", parent_msg)
        out.append(st)
    return out


def unlock_dependents_after_done(conn, case: dict, services: dict[str, dict], today: date, done_step: dict) -> None:
    """При выполнении шага: документы, которые он даёт, попадают в папку; зависимые шаги пересчитываются."""
    svc = services[done_step["service_id"]]
    # The step is done, so its overdue / escalation alerts no longer need the curator's attention.
    conn.execute("UPDATE notifications SET read = 1 WHERE step_id = ? AND type IN ('overdue', 'escalation')",
                 (done_step["id"],))
    for doc in svc.get("produces") or []:
        db.set_case_document(conn, case["id"], doc, True, issued_at=today.isoformat(), valid_until=None, keep_dates=False)
    refresh_steps(conn, case, services, today)


def overdue_reason(step: dict) -> str:
    if step.get("blocker"):
        note = f": {step['blocker_note']}" if step.get("blocker_note") else ""
        return f"Препятствие — {BLOCKER_LABELS[step['blocker']]}{note}"
    missing = [d["name"] for d in step.get("documents", []) if not d["have"] and not d["optional"]]
    if missing:
        return f"Срок истёк; не хватает документов: {', '.join(missing[:3])}{'…' if len(missing) > 3 else ''}"
    return "Срок истёк, шаг не выполнен"


def agency_letter(step: dict, case_alias: str, today: date) -> dict:
    """Черновик уведомления руководителю ведомства. Реальная отправка не выполняется."""
    body = (
        f"Руководителю ведомства ({step['agency']}).\n\n"
        f"По межведомственному маршруту «{case_alias}» просрочен шаг «{step['title']}».\n"
        f"Ответственная организация: {step['responsible']}.\n"
        f"Срок: {fmt(step['due_date'])}, просрочка: {overdue_text(step['days_overdue'])} (на {fmt(today)}).\n"
        f"Причина: {overdue_reason(step)}.\n\n"
        f"Просим назначить исполнителя и сообщить куратору новую дату выполнения.\nКуратор семьи"
    )
    return {"to": f"Руководителю организации «{step['responsible']}»",
            "subject": f"Просрочен шаг маршрута семьи: {step['title']}", "body": body, "sent": False}


def family_message(step: dict, missing: list[dict]) -> str:
    when = (f"срок прошёл {fmt(step['due_date'])}" if step["overdue"] else f"срок — до {fmt(step['due_date'])}")
    docs = "; ".join(d["name"] for d in missing) or "все документы на месте"
    return (f"Здравствуйте! По шагу «{step['title']}» {when}. Что понадобится: {docs}. {step['how_to']} "
            f"Если что-то мешает, напишите куратору — поможем.")


def build_help(step: dict, service: dict, case_alias: str, today: date) -> dict:
    """Панель «Помощь семье»: чек-лист недостающего, что сделать, блокеры, шаблон сообщения (без LLM)."""
    missing = [d for d in step["documents"] if not d["have"] and not d["optional"]]
    have = [d for d in step["documents"] if d["have"]]
    optional_missing = [d for d in step["documents"] if d["optional"] and not d["have"]]
    notes = list(service.get("extra_notes") or [])
    help_ = {
        "step_id": step["id"],
        "service_id": step["service_id"],
        "title": step["title"],
        "status": step["status"],
        "indicator": step["indicator"],
        "due_date": step["due_date"],
        "days_to_due": step["days_to_due"],
        "days_overdue": step["days_overdue"],
        "what_to_do": service["how_to"],
        "description": service["description"],
        "channel": step["channel_label"],
        "typical_duration": service["typical_duration"],
        "egov_url": service["egov_url"],
        "checklist": missing,
        "have": have,
        "optional_missing": optional_missing,
        "notes": notes,
        "blocker": {"code": step["blocker"], "label": step["blocker_label"], "note": step["blocker_note"]} if step["blocker"] else None,
        "dispute_hint": DISPUTE_HINT if step["blocker"] == "decision_disputed" else None,
        "family_message": family_message(step, missing),
        "agency_letter": agency_letter(step, case_alias, today) if step["escalated"] and service.get("executor") == "agency" else None,
    }
    return help_
