"""«Передача дела»: сводка по кейсу, собранная кодом из шагов плана. Сырые ответы интервью не попадают."""

from datetime import date

from .catalog import DOMAIN_LABELS, DOMAINS, STAGES
from .rules import age_months, stage_for
from .safety import is_safe
from .tracking import BLOCKER_LABELS, fmt


def _brief(s: dict) -> dict:
    return {
        "step_id": s["id"], "service_id": s["service_id"], "title": s["title"], "agency": s["agency"],
        "domain": s["domain"], "owner": s["owner"], "due_date": s["due_date"], "status": s["status"],
        "days_overdue": s["days_overdue"], "completed_at": s["completed_at"], "unlock_hint": s["unlock_hint"],
    }


def _plural(n: int, one: str, few: str, many: str) -> str:
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11:
        return one
    if 2 <= n10 <= 4 and not 12 <= n100 <= 14:
        return few
    return many


def summary_text(h: dict) -> str:
    total = len(h["done"]) + len(h["pending"])
    locked = sum(1 for s in h["pending"] if s["status"] == "locked")
    s1 = (f"Этап «{h['case']['stage_label']}», в маршруте {total} {_plural(total, 'шаг', 'шага', 'шагов')}: "
          f"выполнено {len(h['done'])}, ожидает {len(h['pending'])} (из них заблокировано {locked}), "
          f"просрочено {len(h['overdue'])}.")
    parts = []
    if h["documents"]["missing"]:
        parts.append(f"не хватает документов: {len(h['documents']['missing'])}")
    if h["blockers"]:
        parts.append(f"препятствий: {len(h['blockers'])}")
    if h["next_deadlines"]:
        nd = h["next_deadlines"][0]
        parts.append(f"ближайший срок {fmt(nd['due_date'])} — «{nd['title']}»")
    s2 = ("Сейчас " + "; ".join(parts) + ".") if parts else "Открытых проблем нет."
    text = f"{s1} {s2}"
    return text if is_safe(text) else s1


def build_handoff(case: dict, steps: list[dict], folder: dict[str, dict], today: date) -> dict:
    done = [s for s in steps if s["status"] == "done"]
    pending = [s for s in steps if s["status"] != "done"]
    overdue = sorted([s for s in pending if s["overdue"]], key=lambda s: -s["days_overdue"])

    needed = []
    for s in steps:
        for d in s["documents"]:
            if not d["optional"] and d["doc_type"] not in needed:
                needed.append(d["doc_type"])
    have = [folder[d]["name"] for d in needed if folder[d]["have"]]
    missing = [folder[d]["name"] + (" (истёк срок)" if folder[d]["expired"] else "") for d in needed if not folder[d]["have"]]

    blockers = [
        {"step": s["title"], "step_id": s["id"], "blocker": s["blocker"],
         "blocker_label": BLOCKER_LABELS[s["blocker"]], "note": s["blocker_note"]}
        for s in steps if s["blocker"] and s["status"] != "done"
    ]
    upcoming = sorted([s for s in pending if s["status"] != "locked" and not s["overdue"]], key=lambda s: s["due_date"])[:3]

    coverage = {d: {"label": DOMAIN_LABELS[d], "total": 0, "done": 0} for d in DOMAINS}
    for s in steps:
        coverage[s["domain"]]["total"] += 1
        coverage[s["domain"]]["done"] += int(s["status"] == "done")
    gaps = [d for d in DOMAINS if coverage[d]["total"] == 0]

    months = age_months(date.fromisoformat(case["birth_date"]), today)
    stage = stage_for(months)
    h = {
        "case": {
            "id": case["id"], "alias": case["child_alias"], "age_months": months, "city": case["city"],
            "language": case["language"], "confirmed_at": case["confirmed_at"],
            "stage": stage, "stage_label": STAGES[stage], "handling_mode": case["handling_mode"], "alert": bool(case["alert"]),
        },
        "as_of": today.isoformat(),
        "done": [_brief(s) for s in done],
        "pending": [_brief(s) for s in pending],
        "overdue": [_brief(s) for s in overdue],
        "documents": {"have": have, "missing": missing},
        "blockers": blockers,
        "next_deadlines": [_brief(s) for s in upcoming],
        "coverage_by_domain": coverage,
        "gaps": [{"domain": d, "label": DOMAIN_LABELS[d]} for d in gaps],
    }
    h["summary_text"] = summary_text(h)
    return h
