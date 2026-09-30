import json
import logging
import threading
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, db, llm
from . import interview as iv
from .catalog import (
    CHANNELS, DOMAIN_LABELS, QUESTIONS_BY_ID, SCENARIOS, SLOT_LABELS, STAGES,
)
from .handoff import build_handoff
from .plan import PRIORITY_ORDER, build_rows, generate
from .rules import Profile, age_months, stage_for
from .tracking import (
    BLOCKER_LABELS, agency_letter, build_help, notify, overdue_reason, refresh_steps, unlock_dependents_after_done,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

RED_FLAG_TEXT = "Рекомендуем как можно скорее обратиться к врачу."


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="AqylRoute AI", version="0.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

_case_locks: dict[int, threading.Lock] = {}
_locks_guard = threading.Lock()


def case_lock(case_id: int) -> threading.Lock:
    with _locks_guard:
        return _case_locks.setdefault(case_id, threading.Lock())


# ---------- роли (демо: без пароля, роль в заголовке X-Role) ----------

Role = Literal["parent", "curator"]


def get_role(x_role: str = Header("parent", alias="X-Role")) -> Role:
    if x_role not in ("parent", "curator"):
        raise HTTPException(400, "X-Role должен быть parent или curator")
    return x_role  # type: ignore[return-value]


def require_curator(role: Role = Depends(get_role)) -> Role:
    if role != "curator":
        raise HTTPException(403, "Действие доступно только куратору")
    return role


def require_demo() -> None:
    if not config.DEMO_MODE:
        raise HTTPException(403, "Доступно только в демо-режиме (DEMO_MODE=true)")


# ---------- helpers ----------


def load_case(conn, case_id: int) -> dict:
    row = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Кейс не найден")
    c = dict(row)
    c["intake"] = json.loads(c["intake"])
    c["profile"] = json.loads(c["profile"])
    c["interview"] = json.loads(c.pop("interview_json"))
    c["plan_meta"] = json.loads(c["plan_meta"]) if c["plan_meta"] else None
    c["summary_confirmed"] = bool(c["summary_confirmed"])
    c["alert"] = bool(c["alert"])
    return c


def save_interview(conn, c: dict) -> None:
    """Сохраняет ответы, пересчитывает слоты профиля, красный флаг и режим ведения."""
    items = c["interview"]["items"]
    slots = iv.slots_from(items)
    profile = {**slots, "_short": (c["profile"] or {}).get("_short", {})}
    flags = iv.red_flags_of(slots)
    alert = bool(flags)
    mode = "curator" if iv.barriers_of(slots) else "system"
    conn.execute(
        "UPDATE cases SET interview_json = ?, profile = ?, alert = ?, handling_mode = ?, summary_confirmed = ? WHERE id = ?",
        (json.dumps(c["interview"], ensure_ascii=False), json.dumps(profile, ensure_ascii=False), int(alert), mode,
         int(c["summary_confirmed"]), c["id"]),
    )
    if alert and not c["alert"]:
        notify(conn, c["id"], None, "red_flag", "curator",
               f"Красный флаг ({c['child_alias']}): {'; '.join(flags)}. Нужен контакт с семьёй и врачом.")
        db.audit(conn, c["id"], "red_flag", "system")
    c.update(profile=profile, alert=alert, handling_mode=mode)


def docs_have(conn, case_id: int, today: date) -> set[str]:
    return {k for k, v in db.load_case_documents(conn, case_id, today).items() if v["have"]}


def stage_view(c: dict, today: date) -> dict:
    months = age_months(date.fromisoformat(c["birth_date"]), today)
    stage = stage_for(months)
    years, rest = divmod(months, 12)
    age = f"{years} г. {rest} мес." if years and rest else f"{years} г." if years else f"{months} мес."
    return {"age_months": months, "age_text": age, "stage": stage, "stage_label": STAGES[stage]}


def progress_view(c: dict, today: date) -> dict:
    return iv.progress(c, c["interview"]["items"], today)


def case_summary(c: dict, steps: list[dict], today: date) -> dict:
    confirmed = c["status"] == "confirmed"
    return {
        "id": c["id"],
        "child_alias": c["child_alias"],
        "birth_date": c["birth_date"],
        **stage_view(c, today),
        "city": c["city"],
        "language": c["language"],
        "scenario": c["scenario"],
        "scenario_summary": SCENARIOS.get(c["scenario"] or "", {}).get("summary"),
        "created_at": c["created_at"],
        "status": c["status"],
        "confirmed_at": c["confirmed_at"],
        "alert": c["alert"],
        "handling_mode": c["handling_mode"],
        "summary_confirmed": c["summary_confirmed"],
        "interview_done": c["interview"]["done"],
        "interview_answered": len(iv.answered(c["interview"]["items"])),
        "steps_total": len(steps),
        "steps_done": sum(1 for s in steps if s["status"] == "done"),
        "steps_locked": sum(1 for s in steps if s["status"] == "locked"),
        "overdue": sum(1 for s in steps if s["overdue"]) if confirmed else 0,
        "escalated": sum(1 for s in steps if s["escalated"]) if confirmed else 0,
        "due_soon": sum(1 for s in steps if s["due_soon"]) if confirmed else 0,
        "blockers": sum(1 for s in steps if s["blocker"] and s["status"] != "done"),
    }


def strip_for_parent(step: dict) -> dict:
    step.pop("escalated", None)
    if step.get("indicator") == "escalated":
        step["indicator"] = "overdue"
    return step


def case_view(conn, c: dict, role: Role, today: date) -> dict:
    services = db.load_services(conn)
    steps = refresh_steps(conn, c, services, today)
    out = case_summary(c, steps, today)
    out["intake"] = c["intake"]
    out["interview"] = {"items": c["interview"]["items"], "done": c["interview"]["done"],
                        "pending": iv.pending(c["interview"]["items"]), "progress": progress_view(c, today)}
    out["red_flag_text"] = RED_FLAG_TEXT if c["alert"] else None
    visible = role == "curator" or c["status"] == "confirmed"
    out["plan_visible"] = visible
    if role == "parent":
        out.pop("escalated", None)
        out["plan_meta"] = None
        out["notifications"] = notifications_for(conn, c["id"], "parent")
        if not visible:
            out.update(steps=[], steps_total=0, steps_done=0, steps_locked=0, blockers=0)
            return out
        out["steps"] = [strip_for_parent(s) for s in steps]
        return out
    out["plan_meta"] = c["plan_meta"]
    out["notifications"] = notifications_for(conn, c["id"], "curator")
    for s in steps:
        if s["escalated"] and c["status"] == "confirmed" and services[s["service_id"]].get("executor") == "agency":
            s["notification"] = agency_letter(s, c["child_alias"], today)
    out["steps"] = steps
    return out


def notifications_for(conn, case_id: int, audience: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM notifications WHERE case_id = ? AND audience = ? ORDER BY id DESC", (case_id, audience)
    ).fetchall()
    return [dict(r) for r in rows]


def insert_row(conn, case_id: int, r: dict) -> None:
    conn.execute(
        """INSERT INTO plan_steps (case_id, position, service_id, priority, base_priority, owner, due_date, due_basis,
               depends_on, unlock_date, unlock_hint, reason_code, status, explanation, blocker, blocker_note, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (case_id, r["position"], r["service_id"], r["priority"], r["base_priority"], r["owner"], r["due_date"],
         r["due_basis"], json.dumps(r["depends_on"]), r["unlock_date"], r["unlock_hint"], r["reason_code"],
         r["status"], r["explanation"], r["blocker"], r["blocker_note"], db.now_iso()),
    )


def renumber(conn, case_id: int) -> None:
    ids = [r["id"] for r in conn.execute("SELECT id FROM plan_steps WHERE case_id = ? ORDER BY position, id", (case_id,))]
    for pos, sid in enumerate(ids, start=1):
        conn.execute("UPDATE plan_steps SET position = ? WHERE id = ?", (pos, sid))


def step_row(conn, step_id: int) -> dict:
    row = conn.execute("SELECT * FROM plan_steps WHERE id = ?", (step_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Шаг не найден")
    return dict(row)


def find_step(conn, c: dict, step_id: int, today: date) -> dict:
    services = db.load_services(conn)
    return next(s for s in refresh_steps(conn, c, services, today) if s["id"] == step_id)


# ---------- общие ----------


@app.get("/api/health")
def health():
    with db.tx() as conn:
        today = db.get_today(conn)
    return {"status": "ok", "llm_mode": llm.mode(), "model": config.OPENAI_MODEL if llm.mode() == "openai" else None,
            "today": today.isoformat(), "demo_mode": config.DEMO_MODE}


@app.get("/api/services")
def list_services():
    with db.tx() as conn:
        services = db.load_services(conn)
    return {"services": list(services.values()), "domains": DOMAIN_LABELS, "channels": CHANNELS}


@app.get("/api/doc-types")
def list_doc_types():
    with db.tx() as conn:
        return {"doc_types": list(db.load_doc_types(conn).values())}


@app.get("/api/settings")
def get_settings():
    with db.tx() as conn:
        today = db.get_today(conn)
        is_set = db.demo_today_is_set(conn)
    return {
        "today": today.isoformat(),
        "demo_today": today.isoformat() if is_set else None,
        "real_today": date.today().isoformat(),
        "seed_today": config.DEMO_SEED_TODAY,
        "escalation_after_days": config.ESCALATION_AFTER_DAYS,
        "due_soon_days": config.DUE_SOON_DAYS,
        "llm_mode": llm.mode(),
        "model": config.OPENAI_MODEL if llm.mode() == "openai" else None,
        "demo_mode": config.DEMO_MODE,
        "stages": STAGES,
        "domains": DOMAIN_LABELS,
        "blockers": BLOCKER_LABELS,
        "slot_labels": SLOT_LABELS,
    }


class DemoTodayIn(BaseModel):
    date: str | None = None
    shift_days: int | None = Field(default=None, ge=-3650, le=3650)


@app.post("/api/settings/demo-today")
def set_demo_today(body: DemoTodayIn, _: Role = Depends(require_curator), __: None = Depends(require_demo)):
    with db.tx() as conn:
        if body.shift_days is not None:
            new: date | None = db.get_today(conn) + timedelta(days=body.shift_days)
        elif body.date:
            try:
                new = date.fromisoformat(body.date)
            except ValueError:
                raise HTTPException(400, "Дата должна быть в формате YYYY-MM-DD")
        else:
            new = None  # сброс на реальную дату
        db.set_demo_today(conn, new)
        today = db.get_today(conn)
    return {"today": today.isoformat(), "demo_today": new.isoformat() if new else None}


# ---------- кейсы и анкета Q0 ----------


@app.get("/api/cases")
def list_cases(role: Role = Depends(get_role)):
    """Родитель видит только демо-кейсы (свои кейсы фронтенд помнит сам); куратор — все."""
    with db.tx() as conn:
        today = db.get_today(conn)
        services = db.load_services(conn)
        sql = "SELECT id FROM cases ORDER BY id" if role == "curator" else \
            "SELECT id FROM cases WHERE scenario IS NOT NULL ORDER BY id"
        out = []
        for row in conn.execute(sql).fetchall():
            c = load_case(conn, row["id"])
            v = case_summary(c, refresh_steps(conn, c, services, today), today)
            if role == "parent":
                v.pop("escalated", None)
                if c["status"] != "confirmed":
                    v.update(steps_total=0, steps_done=0, steps_locked=0, blockers=0)
            out.append(v)
    return {"cases": out, "scenarios": {k: {"child_alias": v["child_alias"], "summary": v["summary"]} for k, v in SCENARIOS.items()}}


class IntakeIn(BaseModel):
    has_conclusion: bool = False
    conclusion_date: str | None = None
    dispensary: bool = False
    pmpk_status: Literal["none", "valid", "expired"] = "none"
    pmpk_date: str | None = None
    mse_status: Literal["none", "valid", "expired"] = "none"
    mse_valid_until: str | None = None
    mchat_status: Literal["none", "done"] = "none"
    mchat_date: str | None = None
    pediatrician_visited: bool = False
    documents: list[str] = []


class CaseIn(BaseModel):
    child_alias: str | None = Field(default=None, max_length=60)
    birth_date: str | None = None
    city: str | None = Field(default=None, max_length=60)
    language: Literal["ru", "kk"] | None = None
    intake: IntakeIn | None = None
    scenario: Literal["1", "2", "3"] | None = None


def _check_date(v: str | None, name: str, today: date, future_ok: bool = False) -> None:
    if not v:
        return
    try:
        d = date.fromisoformat(v)
    except ValueError:
        raise HTTPException(400, f"{name}: дата в формате YYYY-MM-DD")
    if not future_ok and d > today:
        raise HTTPException(400, f"{name}: дата не может быть в будущем")


@app.post("/api/cases", status_code=201)
def create_case(body: CaseIn, role: Role = Depends(get_role)):
    sc = SCENARIOS.get(body.scenario) if body.scenario else None
    alias = (body.child_alias or (sc and sc["child_alias"]) or "").strip()
    birth = body.birth_date or (sc and sc["birth_date"])
    city = (body.city or (sc and sc["city"]) or "").strip()
    language = body.language or (sc and sc["language"]) or "ru"
    intake = body.intake.model_dump() if body.intake else (dict(sc["intake"]) if sc else IntakeIn().model_dump())
    if not alias or not birth or not city:
        raise HTTPException(400, "Нужны child_alias, birth_date и city")
    with db.tx() as conn:
        today = db.get_today(conn)
        _check_date(birth, "birth_date", today)
        b = date.fromisoformat(birth)
        if age_months(b, today) >= 18 * 12:
            raise HTTPException(400, "Сервис рассчитан на детей до 18 лет")
        _check_date(intake.get("conclusion_date"), "conclusion_date", today)
        _check_date(intake.get("pmpk_date"), "pmpk_date", today)
        _check_date(intake.get("mse_valid_until"), "mse_valid_until", today, future_ok=True)
        unknown = set(intake.get("documents") or []) - set(db.load_doc_types(conn))
        if unknown:
            raise HTTPException(400, f"Неизвестные типы документов: {sorted(unknown)}")
        if sc and not body.child_alias:
            n = conn.execute("SELECT COUNT(*) FROM cases WHERE child_alias LIKE ?", (alias + "%",)).fetchone()[0]
            alias = alias if n == 0 else f"{alias} ({n + 1})"
        case_id = db.create_case(conn, alias, b.isoformat(), city, language, intake, body.scenario)
        db.audit(conn, case_id, "case_created", role)
        return case_view(conn, load_case(conn, case_id), role, today)


@app.get("/api/cases/{case_id}")
def get_case(case_id: int, role: Role = Depends(get_role)):
    with db.tx() as conn:
        today = db.get_today(conn)
        return case_view(conn, load_case(conn, case_id), role, today)


@app.post("/api/cases/{case_id}/reset")
def reset_case(case_id: int, _: Role = Depends(require_curator), __: None = Depends(require_demo)):
    with case_lock(case_id), db.tx() as conn:
        c = load_case(conn, case_id)
        conn.execute("DELETE FROM plan_steps WHERE case_id = ?", (case_id,))
        conn.execute("DELETE FROM notifications WHERE case_id = ?", (case_id,))
        conn.execute(
            """UPDATE cases SET interview_json = ?, profile = '{}', summary_confirmed = 0, alert = 0,
                   handling_mode = 'system', status = 'draft', plan_meta = NULL, confirmed_at = NULL WHERE id = ?""",
            (json.dumps(db.empty_interview()), case_id),
        )
        # Папку документов восстанавливаем из анкеты Q0.
        conn.execute("DELETE FROM case_documents WHERE case_id = ?", (case_id,))
        dates = {"MED_CONCLUSION": (c["intake"].get("conclusion_date"), None),
                 "PMPK_CONCLUSION": (c["intake"].get("pmpk_date"), None),
                 "MSE_CERT": (None, c["intake"].get("mse_valid_until"))}
        for doc in c["intake"].get("documents") or []:
            issued, valid = dates.get(doc, (None, None))
            db.set_case_document(conn, case_id, doc, True, issued, valid, keep_dates=False)
    return {"ok": True}


# ---------- единая папка документов ----------


@app.get("/api/cases/{case_id}/documents")
def case_documents(case_id: int, role: Role = Depends(get_role)):
    with db.tx() as conn:
        c = load_case(conn, case_id)
        today = db.get_today(conn)
        services = db.load_services(conn)
        folder = db.load_case_documents(conn, case_id, today)
        steps = refresh_steps(conn, c, services, today) if (role == "curator" or c["status"] == "confirmed") else []
    for d in folder.values():
        d["used_in"] = [s["title"] for s in steps if any(x["doc_type"] == d["doc_type"] for x in s["documents"])]
    return {"documents": list(folder.values())}


class DocPatch(BaseModel):
    have: bool
    issued_at: str | None = None
    valid_until: str | None = None


@app.patch("/api/cases/{case_id}/documents/{doc_type}")
def patch_document(case_id: int, doc_type: str, body: DocPatch, role: Role = Depends(get_role)):
    """Документ отмечается один раз и учитывается во всех шагах, где он нужен."""
    with db.tx() as conn:
        load_case(conn, case_id)
        if doc_type not in db.load_doc_types(conn):
            raise HTTPException(404, "Неизвестный тип документа")
        for v, name in ((body.issued_at, "issued_at"), (body.valid_until, "valid_until")):
            if v:
                try:
                    date.fromisoformat(v)
                except ValueError:
                    raise HTTPException(400, f"{name}: дата в формате YYYY-MM-DD")
        db.set_case_document(conn, case_id, doc_type, body.have, body.issued_at, body.valid_until)
        db.audit(conn, case_id, f"document_{'on' if body.have else 'off'}:{doc_type}", role)
        today = db.get_today(conn)
        return db.load_case_documents(conn, case_id, today)[doc_type]


# ---------- интервью ----------


class AnswerIn(BaseModel):
    answer: str | list[str] | None = None


def _question_response(c: dict, item: dict | None, today: date) -> dict:
    items = c["interview"]["items"]
    out = {
        "done": c["interview"]["done"],
        "question_id": item["qid"] if item else None,
        "slot": item["slot"] if item else None,
        "text": item["text"] if item else None,
        "type": item["type"] if item else None,
        "options": item["options"] if item else [],
        "item": item,
        "progress": progress_view(c, today),
        "interview": {"items": items, "done": c["interview"]["done"]},
        "summary": None,
    }
    if item and item["qid"] == "12":
        out["summary"] = iv.summary(c, items)
    return out


def _append_next(conn, c: dict, today: date, use_llm: bool = True) -> dict | None:
    items = c["interview"]["items"]
    qid = iv.next_qid(c, items, today)
    if qid is None:
        c["interview"]["done"] = True
        return None
    if qid == "12" and use_llm:
        c["profile"]["_short"] = iv.short_formulations(items)
    item = iv.make_item(qid, c, items, today, use_llm=use_llm)
    items.append(item)
    return item


def _confirm(conn, c: dict, corrections: dict | None) -> None:
    items = c["interview"]["items"]
    for slot, value in (corrections or {}).items():
        item = next((i for i in items if i["slot"] == slot and i["qid"] != "12"), None)
        if item is None:
            raise HTTPException(400, f"Неизвестный слот: {slot}")
        norm = iv.normalize_answer(item["qid"], value)
        if norm in ("", []):
            raise HTTPException(400, f"Пустое значение для {slot}")
        item["answer"] = norm
        item["corrected"] = True
        if slot in (c["profile"].get("_short") or {}):
            c["profile"]["_short"].pop(slot, None)
    last = iv.pending(items)
    if last is None or last["qid"] != "12":
        raise HTTPException(409, "Сводку можно подтвердить только после всех вопросов")
    last["answer"] = "Да, всё верно"
    c["summary_confirmed"] = True
    c["interview"]["done"] = True
    save_interview(conn, c)
    db.audit(conn, c["id"], "summary_confirmed", "parent")


@app.post("/api/cases/{case_id}/interview/next")
def interview_next(case_id: int, body: AnswerIn | None = None):
    answer = body.answer if body else None
    with case_lock(case_id), db.tx() as conn:
        c = load_case(conn, case_id)
        today = db.get_today(conn)
        items = c["interview"]["items"]
        if c["interview"]["done"]:
            return _question_response(c, None, today)
        p = iv.pending(items)
        if p is not None:
            if answer is None:
                return _question_response(c, p, today)  # перезагрузка страницы
            if p["qid"] == "12":
                _confirm(conn, c, None)
                return _question_response(c, None, today)
            norm = iv.normalize_answer(p["qid"], answer)
            if norm in ("", []):
                raise HTTPException(400, "Ответ не может быть пустым")
            p["answer"] = norm
            save_interview(conn, c)
        item = _append_next(conn, c, today)
        save_interview(conn, c)
        return _question_response(c, item, today)


@app.post("/api/cases/{case_id}/interview/autofill")
def interview_autofill(case_id: int, _: None = Depends(require_demo)):
    """«Заполнить демо-ответами»: ответы из сида кейса до сводки (вопрос 12 подтверждает родитель)."""
    with case_lock(case_id), db.tx() as conn:
        c = load_case(conn, case_id)
        if not c["scenario"]:
            raise HTTPException(400, "Демо-ответы есть только у синтетических кейсов")
        today = db.get_today(conn)
        answers = iv.autofill_answers(c["scenario"])
        items = c["interview"]["items"]
        if c["interview"]["done"]:
            return _question_response(c, None, today)
        for _i in range(20):
            p = iv.pending(items)
            if p is None:
                p = _append_next(conn, c, today, use_llm=False)
                if p is None:
                    break
            if p["qid"] == "12":
                c["profile"]["_short"] = iv.short_formulations(items)
                break
            q = QUESTIONS_BY_ID[p["qid"]]
            p["answer"] = iv.normalize_answer(p["qid"], answers.get(p["qid"], q["options"][0] if q["options"] else "—"))
            p["autofilled"] = True
        save_interview(conn, c)
        return _question_response(c, iv.pending(items), today)


@app.get("/api/cases/{case_id}/summary")
def get_summary(case_id: int):
    with db.tx() as conn:
        c = load_case(conn, case_id)
    return iv.summary(c, c["interview"]["items"])


class ConfirmIn(BaseModel):
    corrections: dict[str, str | list[str]] | None = None


@app.post("/api/cases/{case_id}/interview/confirm")
def interview_confirm(case_id: int, body: ConfirmIn | None = None):
    with case_lock(case_id), db.tx() as conn:
        c = load_case(conn, case_id)
        if not c["summary_confirmed"]:
            _confirm(conn, c, body.corrections if body else None)
        return {"summary_confirmed": True, "summary": iv.summary(c, c["interview"]["items"])}


# ---------- план ----------


class GenerateIn(BaseModel):
    force: bool = False


@app.post("/api/cases/{case_id}/plan/generate")
def plan_generate(case_id: int, body: GenerateIn | None = None, role: Role = Depends(get_role)):
    force = bool(body and body.force)
    with case_lock(case_id):
        with db.tx() as conn:
            c = load_case(conn, case_id)
            services = db.load_services(conn)
            today = db.get_today(conn)
            have = docs_have(conn, case_id, today)
        if not c["summary_confirmed"]:
            raise HTTPException(409, "Сначала подтвердите сводку интервью")
        if c["status"] == "confirmed" and not (force and role == "curator"):
            raise HTTPException(409, "План уже подтверждён куратором")
        if c["status"] == "awaiting_curator" and not (force and role == "curator"):
            with db.tx() as conn:
                return case_view(conn, c, role, today)

        p = Profile(c, have, today)
        expected, texts, meta = generate(p, services)
        rows = build_rows(expected, texts, services, p)
        meta.update(generated_at=db.now_iso(), base_date=today.isoformat(), steps=len(rows),
                    rules=[r.to_dict() for r in expected.values()])
        with db.tx() as conn:
            conn.execute("DELETE FROM plan_steps WHERE case_id = ?", (case_id,))
            conn.execute("DELETE FROM notifications WHERE case_id = ? AND type != 'red_flag'", (case_id,))
            for r in rows:
                insert_row(conn, case_id, r)
            conn.execute("UPDATE cases SET status = 'awaiting_curator', plan_meta = ?, confirmed_at = NULL WHERE id = ?",
                         (json.dumps(meta, ensure_ascii=False), case_id))
            db.audit(conn, case_id, f"plan_generated:{meta['source']}", role)
            return case_view(conn, load_case(conn, case_id), role, today)


@app.post("/api/cases/{case_id}/plan/confirm")
def plan_confirm(case_id: int, role: Role = Depends(require_curator)):
    with case_lock(case_id), db.tx() as conn:
        c = load_case(conn, case_id)
        if c["status"] == "draft":
            raise HTTPException(409, "План ещё не сформирован")
        if not conn.execute("SELECT 1 FROM plan_steps WHERE case_id = ?", (case_id,)).fetchone():
            raise HTTPException(409, "В плане нет шагов")
        if c["status"] == "awaiting_curator":
            conn.execute("UPDATE cases SET status = 'confirmed', confirmed_at = ? WHERE id = ?", (db.now_iso(), case_id))
            db.audit(conn, case_id, "plan_confirmed", role)
        today = db.get_today(conn)
        return case_view(conn, load_case(conn, case_id), role, today)


class StepIn(BaseModel):
    service_id: str
    priority: Literal["high", "medium", "low"] = "medium"


@app.post("/api/cases/{case_id}/steps", status_code=201)
def add_step(case_id: int, body: StepIn, role: Role = Depends(require_curator)):
    """Куратор добавляет шаг — только из справочника."""
    with case_lock(case_id), db.tx() as conn:
        c = load_case(conn, case_id)
        if c["status"] == "draft":
            raise HTTPException(409, "Сначала сформируйте план")
        services = db.load_services(conn)
        if body.service_id not in services:
            raise HTTPException(400, "Услуги нет в справочнике")
        if conn.execute("SELECT 1 FROM plan_steps WHERE case_id = ? AND service_id = ?", (case_id, body.service_id)).fetchone():
            raise HTTPException(409, "Этот шаг уже есть в плане")
        today = db.get_today(conn)
        svc = services[body.service_id]
        pos = conn.execute("SELECT COALESCE(MAX(position), 0) + 1 FROM plan_steps WHERE case_id = ?", (case_id,)).fetchone()[0]
        from .plan import owner_for
        insert_row(conn, case_id, {
            "position": pos, "service_id": svc["id"], "priority": body.priority, "base_priority": body.priority,
            "owner": owner_for(svc, c["profile"]), "due_date": (today + timedelta(days=svc["default_deadline_days"])).isoformat(),
            "due_basis": "default", "depends_on": [], "unlock_date": None, "unlock_hint": "", "reason_code": "curator_added",
            "status": "todo", "explanation": svc["default_explanation"], "blocker": None, "blocker_note": "",
        })
        db.audit(conn, case_id, f"step_added:{body.service_id}", role)
        return case_view(conn, load_case(conn, case_id), role, today)


@app.delete("/api/steps/{step_id}")
def delete_step(step_id: int, role: Role = Depends(require_curator)):
    with db.tx() as conn:
        row = step_row(conn, step_id)
        conn.execute("DELETE FROM notifications WHERE step_id = ?", (step_id,))
        conn.execute("DELETE FROM plan_steps WHERE id = ?", (step_id,))
        renumber(conn, row["case_id"])
        db.audit(conn, row["case_id"], f"step_removed:{row['service_id']}", role)
        today = db.get_today(conn)
        return case_view(conn, load_case(conn, row["case_id"]), role, today)


class StepPatch(BaseModel):
    status: Literal["todo", "in_progress", "done"] | None = None
    priority: Literal["high", "medium", "low"] | None = None
    blocker: Literal["missing_document", "awaiting_agency", "no_service_in_region", "family_declined", "decision_disputed"] | None = None
    blocker_note: str | None = Field(default=None, max_length=500)
    curator_note: str | None = Field(default=None, max_length=1000)


@app.patch("/api/steps/{step_id}")
def patch_step(step_id: int, body: StepPatch, role: Role = Depends(get_role)):
    sent = body.model_fields_set
    if not sent:
        raise HTTPException(400, "Нечего обновлять")
    with db.tx() as conn:
        row = step_row(conn, step_id)
        c = load_case(conn, row["case_id"])
        today = db.get_today(conn)
        services = db.load_services(conn)
        refresh_steps(conn, c, services, today)  # сначала актуализируем блокировки по дате
        row = step_row(conn, step_id)
        if role == "parent":
            if c["status"] != "confirmed":
                raise HTTPException(404, "Шаг не найден")
            if sent & {"curator_note", "priority"}:
                raise HTTPException(403, "Комментарий и приоритет меняет только куратор")
        fields: dict = {}
        if "status" in sent and body.status is not None:
            if row["status"] == "locked":
                raise HTTPException(409, f"Шаг заблокирован: {row['unlock_hint'] or 'ждёт предыдущих шагов'}")
            fields["status"] = body.status
            fields["completed_at"] = today.isoformat() if body.status == "done" else None
        if "priority" in sent and body.priority is not None:
            fields["base_priority"] = body.priority
            if row["status"] != "locked":
                fields["priority"] = body.priority
        if "blocker" in sent:
            fields["blocker"] = body.blocker
            if body.blocker is None and "blocker_note" not in sent:
                fields["blocker_note"] = ""
        if "blocker_note" in sent:
            fields["blocker_note"] = (body.blocker_note or "").strip()
        if "curator_note" in sent:
            fields["curator_note"] = (body.curator_note or "").strip()
        fields["updated_at"] = db.now_iso()
        cols = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE plan_steps SET {cols} WHERE id = ?", (*fields.values(), step_id))
        if fields.get("status") == "done":
            unlock_dependents_after_done(conn, c, services, today, row)
            db.audit(conn, c["id"], f"step_done:{row['service_id']}", role)
        step = find_step(conn, c, step_id, today)
        return strip_for_parent(step) if role == "parent" else step


@app.get("/api/steps/{step_id}/help")
def step_help(step_id: int, role: Role = Depends(get_role)):
    """Панель «Помощь семье»: чек-лист недостающих документов, что сделать, блокеры, шаблон сообщения."""
    with db.tx() as conn:
        row = step_row(conn, step_id)
        c = load_case(conn, row["case_id"])
        if role == "parent" and c["status"] != "confirmed":
            raise HTTPException(404, "Шаг не найден")
        today = db.get_today(conn)
        services = db.load_services(conn)
        step = find_step(conn, c, step_id, today)
        help_ = build_help(step, services[step["service_id"]], c["child_alias"], today)
    if role == "parent":
        help_.pop("agency_letter", None)
    return help_


# ---------- куратор ----------


@app.get("/api/curator/cases")
def curator_cases(_: Role = Depends(require_curator)):
    with db.tx() as conn:
        today = db.get_today(conn)
        services = db.load_services(conn)
        out = []
        for row in conn.execute("SELECT id FROM cases ORDER BY id").fetchall():
            c = load_case(conn, row["id"])
            s = case_summary(c, refresh_steps(conn, c, services, today), today)
            s["unread"] = conn.execute("SELECT COUNT(*) FROM notifications WHERE case_id = ? AND audience = 'curator' AND read = 0",
                                       (c["id"],)).fetchone()[0]
            out.append(s)
    order = {"awaiting_curator": 0, "confirmed": 1, "draft": 2}
    out.sort(key=lambda x: (not x["alert"], order[x["status"]], -x["escalated"], -x["overdue"], x["id"]))
    return {"today": today.isoformat(), "cases": out}


@app.get("/api/curator/overdue")
def curator_overdue(_: Role = Depends(require_curator)):
    with db.tx() as conn:
        today = db.get_today(conn)
        services = db.load_services(conn)
        overdue, due_soon, blocked = [], [], []
        for row in conn.execute("SELECT id FROM cases WHERE status = 'confirmed' ORDER BY id").fetchall():
            c = load_case(conn, row["id"])
            for s in refresh_steps(conn, c, services, today):
                s.update(case_id=c["id"], case_alias=c["child_alias"])
                if s["overdue"]:
                    s["reason"] = overdue_reason(s)
                    if s["escalated"] and services[s["service_id"]].get("executor") == "agency":
                        s["notification"] = agency_letter(s, c["child_alias"], today)
                    overdue.append(s)
                elif s["due_soon"]:
                    due_soon.append(s)
                elif s["blocker"] and s["status"] != "done":
                    blocked.append(s)
    overdue.sort(key=lambda s: (-s["days_overdue"], PRIORITY_ORDER.get(s["priority"] or "low", 2)))
    due_soon.sort(key=lambda s: s["days_to_due"])
    return {
        "today": today.isoformat(),
        "escalation_after_days": config.ESCALATION_AFTER_DAYS,
        "overdue_count": len(overdue),
        "escalated_count": sum(1 for s in overdue if s["escalated"]),
        "items": overdue,
        "due_soon": due_soon,
        "blocked": blocked,
    }


@app.get("/api/curator/notifications")
def curator_notifications(_: Role = Depends(require_curator)):
    with db.tx() as conn:
        # уведомления создаются при чтении — сначала актуализируем все подтверждённые кейсы
        today = db.get_today(conn)
        services = db.load_services(conn)
        for row in conn.execute("SELECT id FROM cases WHERE status = 'confirmed'").fetchall():
            refresh_steps(conn, load_case(conn, row["id"]), services, today)
        rows = conn.execute(
            """SELECT n.*, c.child_alias AS case_alias FROM notifications n JOIN cases c ON c.id = n.case_id
               WHERE n.audience = 'curator' ORDER BY n.read, n.id DESC"""
        ).fetchall()
    items = [dict(r) for r in rows]
    return {"unread": sum(1 for n in items if not n["read"]), "items": items}


class ReadIn(BaseModel):
    ids: list[int] | None = None


@app.post("/api/curator/notifications/read")
def read_notifications(body: ReadIn, _: Role = Depends(require_curator)):
    with db.tx() as conn:
        if body.ids:
            conn.executemany("UPDATE notifications SET read = 1 WHERE id = ?", [(i,) for i in body.ids])
        else:
            conn.execute("UPDATE notifications SET read = 1 WHERE audience = 'curator'")
    return {"ok": True}


@app.get("/api/cases/{case_id}/handoff")
def get_handoff(case_id: int, _: Role = Depends(require_curator)):
    with db.tx() as conn:
        c = load_case(conn, case_id)
        if c["status"] != "confirmed":
            raise HTTPException(409, "Передача дела доступна только для подтверждённого плана")
        today = db.get_today(conn)
        services = db.load_services(conn)
        steps = refresh_steps(conn, c, services, today)
        return build_handoff(c, steps, db.load_case_documents(conn, case_id, today), today)


@app.post("/api/cases/{case_id}/handoff/export")
def export_handoff(case_id: int, role: Role = Depends(require_curator)):
    with db.tx() as conn:
        c = load_case(conn, case_id)
        if c["status"] != "confirmed":
            raise HTTPException(409, "Передача дела доступна только для подтверждённого плана")
        db.audit(conn, case_id, "handoff_exported", role)
    return {"ok": True}


@app.get("/api/cases/{case_id}/audit")
def case_audit(case_id: int, _: Role = Depends(require_curator)):
    with db.tx() as conn:
        load_case(conn, case_id)
        rows = conn.execute("SELECT * FROM audit_log WHERE case_id = ? ORDER BY id DESC", (case_id,)).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.post("/api/demo/reset")
def demo_reset(_: Role = Depends(require_curator), __: None = Depends(require_demo)):
    db.reset_demo()
    return {"ok": True}
