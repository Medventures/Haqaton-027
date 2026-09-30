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
from .catalog import DOMAIN_LABELS, SCENARIOS, TOPIC_LABELS, TOPICS
from .handoff import build_handoff
from .plan import PRIORITY_ORDER, build_row, build_rows, generate_steps
from .tracking import BLOCKER_LABELS, is_escalated, notification_draft, overdue_days, overdue_reason

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="AqylRoute AI", version="0.2.0", lifespan=lifespan)
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
    c["interview"] = json.loads(c.pop("interview_json"))
    c["plan_meta"] = json.loads(c["plan_meta"]) if c["plan_meta"] else None
    return c


def save_interview(conn, case_id: int, interview: dict) -> None:
    conn.execute("UPDATE cases SET interview_json = ? WHERE id = ?", (json.dumps(interview, ensure_ascii=False), case_id))


def load_steps(conn, case_id: int, today: date) -> list[dict]:
    """Шаги кейса с вычисляемыми overdue / days_overdue / escalated (флаг сохраняется в БД)."""
    rows = conn.execute(
        """SELECT ps.*, s.title, s.agency, s.domain FROM plan_steps ps
           JOIN services s ON s.id = ps.service_id
           WHERE ps.case_id = ? ORDER BY ps.position""",
        (case_id,),
    ).fetchall()
    steps = []
    for r in rows:
        st = dict(r)
        st["documents"] = json.loads(st["documents"])
        st["days_overdue"] = overdue_days(st["due_date"], st["status"], today)
        st["overdue"] = st["days_overdue"] > 0
        esc = is_escalated(st["days_overdue"])
        if esc != bool(st["escalated"]):
            conn.execute("UPDATE plan_steps SET escalated = ? WHERE id = ?", (int(esc), st["id"]))
        st["escalated"] = esc
        st["blocker_label"] = BLOCKER_LABELS.get(st["blocker"]) if st["blocker"] else None
        steps.append(st)
    return steps


def progress_view(c: dict) -> dict:
    items = c["interview"]["items"]
    return {
        "asked": len(items),
        "answered": len([i for i in items if i.get("answer") is not None]),
        "min_questions": config.MIN_QUESTIONS,
        "max_questions": config.MAX_QUESTIONS,
        "covered_topics": iv.covered_topics(items, c),
        "open_topics": iv.open_topics(items, c),
    }


def interview_view(c: dict) -> dict:
    items = c["interview"]["items"]
    return {"items": items, "done": c["interview"]["done"], "pending": iv.pending(items), **progress_view(c)}


def case_summary(c: dict, steps: list[dict], today: date) -> dict:
    confirmed = c["status"] == "confirmed"
    months = iv.age_months(c["birth_date"], today)
    return {
        "id": c["id"],
        "child_alias": c["child_alias"],
        "birth_date": c["birth_date"],
        "age_months": months,
        "age_text": iv.age_text(months),
        "city": c["city"],
        "language": c["language"],
        "scenario": c["scenario"],
        "scenario_summary": SCENARIOS.get(c["scenario"] or "", {}).get("summary"),
        "created_at": c["created_at"],
        "status": c["status"],
        "confirmed_at": c["confirmed_at"],
        "interview_done": c["interview"]["done"],
        "interview_answered": len([i for i in c["interview"]["items"] if i.get("answer") is not None]),
        "steps_total": len(steps),
        "steps_done": len([s for s in steps if s["status"] == "done"]),
        "overdue": len([s for s in steps if s["overdue"]]) if confirmed else 0,
        "escalated": len([s for s in steps if s["escalated"]]) if confirmed else 0,
        "blockers": len([s for s in steps if s["blocker"] and s["status"] != "done"]),
    }


def strip_for_parent(step: dict) -> dict:
    step.pop("escalated", None)
    step.pop("notification", None)
    return step


def case_view(conn, c: dict, role: Role, today: date) -> dict:
    steps = load_steps(conn, c["id"], today)
    out = case_summary(c, steps, today)
    out["interview"] = interview_view(c)
    visible = role == "curator" or c["status"] == "confirmed"
    out["plan_visible"] = visible
    if not visible:
        out.update(steps=[], plan_meta=None, steps_total=0, steps_done=0, blockers=0)
        return out
    if role == "parent":
        out.pop("escalated", None)
        out["plan_meta"] = None
        out["steps"] = [strip_for_parent(s) for s in steps]
        return out
    out["plan_meta"] = c["plan_meta"]
    if c["status"] == "confirmed":
        for s in steps:
            if s["escalated"]:
                s["notification"] = notification_draft(s, c["child_alias"], today)
    out["steps"] = steps
    return out


def plan_base_date(c: dict, today: date) -> date:
    meta = c.get("plan_meta") or {}
    return date.fromisoformat(meta["base_date"]) if meta.get("base_date") else today


def renumber(conn, case_id: int) -> None:
    ids = [r["id"] for r in conn.execute("SELECT id FROM plan_steps WHERE case_id = ? ORDER BY position, id", (case_id,))]
    for pos, sid in enumerate(ids, start=1):
        conn.execute("UPDATE plan_steps SET position = ? WHERE id = ?", (pos, sid))


def insert_row(conn, case_id: int, r: dict) -> None:
    conn.execute(
        """INSERT INTO plan_steps (case_id, position, service_id, priority, owner, due_date, documents, status,
               explanation, blocker, blocker_note, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (case_id, r["position"], r["service_id"], r["priority"], r["owner"], r["due_date"],
         json.dumps(r["documents"], ensure_ascii=False), r["status"], r["explanation"],
         r["blocker"], r["blocker_note"], db.now_iso()),
    )


# ---------- общие ----------


@app.get("/api/health")
def health():
    with db.tx() as conn:
        today = db.get_today(conn)
    return {
        "status": "ok",
        "llm_mode": llm.mode(),
        "model": config.OPENAI_MODEL if llm.mode() == "openai" else None,
        "today": today.isoformat(),
        "demo_mode": config.DEMO_MODE,
    }


@app.get("/api/services")
def list_services():
    with db.tx() as conn:
        services = db.load_services(conn)
    return {"services": list(services.values()), "domains": DOMAIN_LABELS}


@app.get("/api/settings")
def get_settings():
    with db.tx() as conn:
        today = db.get_today(conn)
        is_set = db.demo_today_is_set(conn)
    return {
        "today": today.isoformat(),
        "demo_today": today.isoformat() if is_set else None,
        "real_today": date.today().isoformat(),
        "escalation_after_days": config.ESCALATION_AFTER_DAYS,
        "llm_mode": llm.mode(),
        "model": config.OPENAI_MODEL if llm.mode() == "openai" else None,
        "demo_mode": config.DEMO_MODE,
        "topics": TOPICS,
        "domains": DOMAIN_LABELS,
        "blockers": BLOCKER_LABELS,
    }


class DemoTodayIn(BaseModel):
    date: str | None = None
    shift_days: int | None = Field(default=None, ge=-365, le=365)


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


# ---------- кейсы ----------


@app.get("/api/cases")
def list_cases(role: Role = Depends(get_role)):
    """Родитель видит только демо-кейсы (свои созданные кейсы фронтенд помнит сам); куратор — все."""
    with db.tx() as conn:
        today = db.get_today(conn)
        sql = "SELECT id FROM cases ORDER BY id" if role == "curator" else \
            "SELECT id FROM cases WHERE scenario IS NOT NULL ORDER BY id"
        out = []
        for row in conn.execute(sql).fetchall():
            c = load_case(conn, row["id"])
            v = case_summary(c, load_steps(conn, c["id"], today), today)
            if role == "parent":
                v.pop("escalated", None)
                if c["status"] != "confirmed":
                    v.update(steps_total=0, steps_done=0, blockers=0)
            out.append(v)
    return {"cases": out, "scenarios": {k: {"child_alias": v["child_alias"], "summary": v["summary"]} for k, v in SCENARIOS.items()}}


class CaseIn(BaseModel):
    child_alias: str | None = Field(default=None, max_length=60)
    birth_date: str | None = None
    city: str | None = Field(default=None, max_length=60)
    language: Literal["ru", "kk"] | None = None
    scenario: Literal["A", "B"] | None = None


@app.post("/api/cases", status_code=201)
def create_case(body: CaseIn, role: Role = Depends(get_role)):
    sc = SCENARIOS.get(body.scenario) if body.scenario else None
    alias = (body.child_alias or (sc and sc["child_alias"]) or "").strip()
    birth = body.birth_date or (sc and sc["birth_date"])
    city = (body.city or (sc and sc["city"]) or "").strip()
    language = body.language or (sc and sc["language"]) or "ru"
    if not alias or not birth or not city:
        raise HTTPException(400, "Нужны child_alias, birth_date и city")
    try:
        b = date.fromisoformat(birth)
    except ValueError:
        raise HTTPException(400, "birth_date должна быть в формате YYYY-MM-DD")
    with db.tx() as conn:
        today = db.get_today(conn)
        months = iv.age_months(b.isoformat(), today)
        if b > today:
            raise HTTPException(400, "Дата рождения не может быть в будущем")
        if months >= 18 * 12:
            raise HTTPException(400, "Сервис рассчитан на детей до 18 лет")
        if sc and not body.child_alias:
            n = conn.execute("SELECT COUNT(*) FROM cases WHERE child_alias LIKE ?", (alias + "%",)).fetchone()[0]
            alias = alias if n == 0 else f"{alias} ({n + 1})"
        case_id = db.create_case(conn, alias, b.isoformat(), city, language, body.scenario)
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
        load_case(conn, case_id)
        conn.execute("DELETE FROM plan_steps WHERE case_id = ?", (case_id,))
        conn.execute(
            "UPDATE cases SET interview_json = ?, status = 'draft', plan_meta = NULL, confirmed_at = NULL WHERE id = ?",
            (json.dumps(db.empty_interview()), case_id),
        )
    return {"ok": True}


# ---------- интервью ----------


class AnswerIn(BaseModel):
    answer: str | list[str] | None = None


def _next_response(c: dict, question: dict | None) -> dict:
    return {
        "done": c["interview"]["done"],
        "question": question["question"] if question else None,
        "topic": question["topic"] if question else None,
        "options": question["options"] if question else [],
        "item": question,
        "progress": progress_view(c),
        "interview": interview_view(c),
    }


@app.post("/api/cases/{case_id}/interview/next")
def interview_next(case_id: int, body: AnswerIn | None = None):
    answer = body.answer if body else None
    with case_lock(case_id):
        with db.tx() as conn:
            c = load_case(conn, case_id)
            today = db.get_today(conn)
        items = c["interview"]["items"]
        if c["interview"]["done"]:
            return _next_response(c, None)

        p = iv.pending(items)
        if p is not None:
            if answer is None:
                # Повторный запрос без ответа (перезагрузка страницы) — вернуть текущий вопрос.
                return _next_response(c, p)
            ans = iv.normalize_answer(answer)
            if ans == "" or ans == []:
                raise HTTPException(400, "Ответ не может быть пустым")
            p["answer"] = ans

        if iv.should_finish(items, c):
            c["interview"]["done"] = True
            with db.tx() as conn:
                save_interview(conn, case_id, c["interview"])
            return _next_response(c, None)

        # Ответ сохраняется до обращения к модели, чтобы не потеряться при сбое.
        with db.tx() as conn:
            save_interview(conn, case_id, c["interview"])
        q, source = iv.next_question(items, c, today)
        q.update(n=len(items) + 1, answer=None, source=source, topic_label=TOPIC_LABELS.get(q["topic"], "Уточнение"))
        items.append(q)
        with db.tx() as conn:
            save_interview(conn, case_id, c["interview"])
        return _next_response(c, q)


@app.post("/api/cases/{case_id}/interview/autofill")
def interview_autofill(case_id: int, _: None = Depends(require_demo)):
    with case_lock(case_id), db.tx() as conn:
        c = load_case(conn, case_id)
        if not c["scenario"]:
            raise HTTPException(400, "Демо-ответы есть только у синтетических кейсов")
        if not c["interview"]["done"]:
            iv.autofill(c["interview"]["items"], c, c["scenario"], db.get_today(conn))
            c["interview"]["done"] = True
            save_interview(conn, case_id, c["interview"])
        return _next_response(c, None)


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
        if not c["interview"]["done"]:
            raise HTTPException(409, "Интервью ещё не завершено")
        if c["status"] == "confirmed" and not (force and role == "curator"):
            raise HTTPException(409, "План уже подтверждён куратором")
        if c["status"] == "awaiting_curator" and not (force and role == "curator"):
            with db.tx() as conn:  # черновик уже есть — не перегенерируем
                return case_view(conn, c, role, today)

        months = iv.age_months(c["birth_date"], today)
        steps, meta = generate_steps(c["interview"], services, months, c["city"], c["language"])
        rows = build_rows(steps, services, today, c["city"])
        meta.update(generated_at=db.now_iso(), base_date=today.isoformat(), steps=len(rows))
        with db.tx() as conn:
            conn.execute("DELETE FROM plan_steps WHERE case_id = ?", (case_id,))
            for r in rows:
                insert_row(conn, case_id, r)
            conn.execute(
                "UPDATE cases SET status = 'awaiting_curator', plan_meta = ?, confirmed_at = NULL WHERE id = ?",
                (json.dumps(meta, ensure_ascii=False), case_id),
            )
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
        base = plan_base_date(c, today) if c["status"] == "awaiting_curator" else today
        insert_row(conn, case_id, build_row(pos, svc, body.priority, svc["default_explanation"], base, c["city"]))
        db.audit(conn, case_id, f"step_added:{body.service_id}", role)
        return case_view(conn, load_case(conn, case_id), role, today)


@app.delete("/api/steps/{step_id}")
def delete_step(step_id: int, role: Role = Depends(require_curator)):
    with db.tx() as conn:
        row = conn.execute("SELECT case_id, service_id FROM plan_steps WHERE id = ?", (step_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Шаг не найден")
        conn.execute("DELETE FROM plan_steps WHERE id = ?", (step_id,))
        renumber(conn, row["case_id"])
        db.audit(conn, row["case_id"], f"step_removed:{row['service_id']}", role)
        today = db.get_today(conn)
        return case_view(conn, load_case(conn, row["case_id"]), role, today)


class DocIn(BaseModel):
    name: str
    have: bool


class StepPatch(BaseModel):
    status: Literal["todo", "in_progress", "done"] | None = None
    priority: Literal["high", "medium", "low"] | None = None
    blocker: Literal["missing_document", "awaiting_agency", "no_service_in_region", "family_declined"] | None = None
    blocker_note: str | None = Field(default=None, max_length=500)
    curator_note: str | None = Field(default=None, max_length=1000)
    documents: list[DocIn] | None = None


@app.patch("/api/steps/{step_id}")
def patch_step(step_id: int, body: StepPatch, role: Role = Depends(get_role)):
    sent = body.model_fields_set
    if not sent:
        raise HTTPException(400, "Нечего обновлять")
    with db.tx() as conn:
        row = conn.execute("SELECT * FROM plan_steps WHERE id = ?", (step_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Шаг не найден")
        c = load_case(conn, row["case_id"])
        today = db.get_today(conn)
        if role == "parent":
            if c["status"] != "confirmed":
                raise HTTPException(404, "Шаг не найден")
            if sent & {"curator_note", "priority"}:
                raise HTTPException(403, "Комментарий и приоритет меняет только куратор")

        fields: dict = {}
        if "status" in sent and body.status is not None:
            fields["status"] = body.status
            fields["completed_at"] = today.isoformat() if body.status == "done" else None
        if "priority" in sent and body.priority is not None:
            fields["priority"] = body.priority
        if "blocker" in sent:
            fields["blocker"] = body.blocker
            if body.blocker is None and "blocker_note" not in sent:
                fields["blocker_note"] = ""
        if "blocker_note" in sent:
            fields["blocker_note"] = (body.blocker_note or "").strip()
        if "curator_note" in sent:
            fields["curator_note"] = (body.curator_note or "").strip()
        if "documents" in sent and body.documents is not None:
            # Документ либо есть у семьи, либо нет — отметка синхронизируется во всех шагах кейса.
            marks = {d.name: d.have for d in body.documents}
            for r in conn.execute("SELECT id, documents FROM plan_steps WHERE case_id = ?", (c["id"],)).fetchall():
                docs = json.loads(r["documents"])
                changed = False
                for d in docs:
                    if d["name"] in marks and d["have"] != marks[d["name"]]:
                        d["have"] = marks[d["name"]]
                        changed = True
                if changed:
                    conn.execute("UPDATE plan_steps SET documents = ?, updated_at = ? WHERE id = ?",
                                 (json.dumps(docs, ensure_ascii=False), db.now_iso(), r["id"]))
        if fields:
            fields["updated_at"] = db.now_iso()
            cols = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE plan_steps SET {cols} WHERE id = ?", (*fields.values(), step_id))
        step = next(s for s in load_steps(conn, c["id"], today) if s["id"] == step_id)
        return strip_for_parent(step) if role == "parent" else step


# ---------- куратор ----------


@app.get("/api/curator/cases")
def curator_cases(_: Role = Depends(require_curator)):
    with db.tx() as conn:
        today = db.get_today(conn)
        out = []
        for row in conn.execute("SELECT id FROM cases ORDER BY id").fetchall():
            c = load_case(conn, row["id"])
            out.append(case_summary(c, load_steps(conn, c["id"], today), today))
    order = {"awaiting_curator": 0, "confirmed": 1, "draft": 2}
    out.sort(key=lambda x: (order[x["status"]], -x["escalated"], -x["overdue"], x["id"]))
    return {"today": today.isoformat(), "cases": out}


@app.get("/api/curator/overdue")
def curator_overdue(_: Role = Depends(require_curator)):
    with db.tx() as conn:
        today = db.get_today(conn)
        overdue, blocked = [], []
        for row in conn.execute("SELECT id FROM cases WHERE status = 'confirmed' ORDER BY id").fetchall():
            c = load_case(conn, row["id"])
            for s in load_steps(conn, c["id"], today):
                s.update(case_id=c["id"], case_alias=c["child_alias"])
                if s["overdue"]:
                    s["reason"] = overdue_reason(s)
                    if s["escalated"]:
                        s["notification"] = notification_draft(s, c["child_alias"], today)
                    overdue.append(s)
                elif s["blocker"] and s["status"] != "done":
                    blocked.append(s)
    overdue.sort(key=lambda s: (-s["days_overdue"], PRIORITY_ORDER[s["priority"]]))
    return {
        "today": today.isoformat(),
        "escalation_after_days": config.ESCALATION_AFTER_DAYS,
        "overdue_count": len(overdue),
        "escalated_count": len([s for s in overdue if s["escalated"]]),
        "items": overdue,
        "blocked": blocked,
    }


@app.get("/api/cases/{case_id}/handoff")
def get_handoff(case_id: int, _: Role = Depends(require_curator)):
    with db.tx() as conn:
        c = load_case(conn, case_id)
        if c["status"] != "confirmed":
            raise HTTPException(409, "Передача дела доступна только для подтверждённого плана")
        today = db.get_today(conn)
        return build_handoff(c, load_steps(conn, case_id, today), today)


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
