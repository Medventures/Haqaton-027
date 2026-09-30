"""«Передача дела»: сводка по кейсу, собранная кодом из шагов плана.

Сырые ответы интервью в сводку не попадают.
"""

from datetime import date

from .catalog import DOMAIN_LABELS, DOMAINS
from .interview import age_months
from .safety import is_safe
from .tracking import BLOCKER_LABELS, fmt


def _brief(s: dict) -> dict:
    return {
        "step_id": s["id"],
        "title": s["title"],
        "agency": s["agency"],
        "domain": s["domain"],
        "owner": s["owner"],
        "due_date": s["due_date"],
        "status": s["status"],
        "days_overdue": s["days_overdue"],
        "completed_at": s["completed_at"],
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
    s1 = (
        f"В маршруте {total} {_plural(total, 'шаг', 'шага', 'шагов')}: выполнено {len(h['done'])}, "
        f"в работе или ожидает {len(h['pending'])}, из них просрочено {len(h['overdue'])}."
    )
    parts = []
    if h["documents"]["missing"]:
        parts.append(f"не отмечено документов: {len(h['documents']['missing'])}")
    if h["blockers"]:
        parts.append(f"открытых блокеров: {len(h['blockers'])}")
    if h["next_deadlines"]:
        nd = h["next_deadlines"][0]
        parts.append(f"ближайший срок {fmt(nd['due_date'])} — «{nd['title']}»")
    s2 = ("Сейчас " + "; ".join(parts) + ".") if parts else "Открытых проблем нет."
    text = f"{s1} {s2}"
    return text if is_safe(text) else s1


def build_handoff(case: dict, steps: list[dict], today: date) -> dict:
    done = [s for s in steps if s["status"] == "done"]
    pending = [s for s in steps if s["status"] != "done"]
    overdue = sorted([s for s in pending if s["overdue"]], key=lambda s: -s["days_overdue"])

    have: dict[str, None] = {}
    missing: dict[str, None] = {}
    for s in steps:
        for d in s["documents"]:
            (have if d["have"] else missing)[d["name"]] = None
    missing_list = [n for n in missing if n not in have]

    blockers = [
        {"step": s["title"], "step_id": s["id"], "blocker": s["blocker"],
         "blocker_label": BLOCKER_LABELS[s["blocker"]], "note": s["blocker_note"]}
        for s in steps
        if s["blocker"] and s["status"] != "done"
    ]
    upcoming = sorted([s for s in pending if not s["overdue"]], key=lambda s: s["due_date"])[:3]

    coverage = {d: {"label": DOMAIN_LABELS[d], "total": 0, "done": 0} for d in DOMAINS}
    for s in steps:
        coverage[s["domain"]]["total"] += 1
        coverage[s["domain"]]["done"] += int(s["status"] == "done")
    gaps = [d for d in DOMAINS if coverage[d]["total"] == 0]

    h = {
        "case": {
            "id": case["id"],
            "alias": case["child_alias"],
            "age_months": age_months(case["birth_date"], today),
            "city": case["city"],
            "language": case["language"],
            "confirmed_at": case["confirmed_at"],
        },
        "as_of": today.isoformat(),
        "done": [_brief(s) for s in done],
        "pending": [_brief(s) for s in pending],
        "overdue": [_brief(s) for s in overdue],
        "documents": {"have": list(have), "missing": missing_list},
        "blockers": blockers,
        "next_deadlines": [_brief(s) for s in upcoming],
        "coverage_by_domain": coverage,
        "gaps": [{"domain": d, "label": DOMAIN_LABELS[d]} for d in gaps],
    }
    h["summary_text"] = summary_text(h)
    return h
