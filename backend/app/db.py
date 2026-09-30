import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone

from . import config
from .catalog import SCENARIOS, SERVICES

SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE services (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    agency TEXT NOT NULL CHECK (agency IN ('медицина', 'образование', 'соцзащита')),
    domain TEXT NOT NULL CHECK (domain IN ('health', 'communication', 'education', 'daily_skills', 'accessibility', 'family_support')),
    description TEXT NOT NULL,
    required_documents TEXT NOT NULL,
    default_deadline_days INTEGER NOT NULL,
    responsible TEXT NOT NULL,
    min_age_months INTEGER,
    max_age_months INTEGER,
    available_cities TEXT,
    base INTEGER NOT NULL DEFAULT 0,
    default_explanation TEXT NOT NULL
);
CREATE TABLE cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_alias TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    city TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('ru', 'kk')),
    scenario TEXT,
    interview_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'awaiting_curator', 'confirmed')),
    plan_meta TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT
);
CREATE TABLE plan_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    service_id TEXT NOT NULL REFERENCES services(id),
    priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
    owner TEXT NOT NULL,
    due_date TEXT NOT NULL,
    documents TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    explanation TEXT NOT NULL,
    curator_note TEXT NOT NULL DEFAULT '',
    escalated INTEGER NOT NULL DEFAULT 0,
    blocker TEXT CHECK (blocker IS NULL OR blocker IN ('missing_document', 'awaiting_agency', 'no_service_in_region', 'family_declined')),
    blocker_note TEXT NOT NULL DEFAULT '',
    completed_at TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER,
    action TEXT NOT NULL,
    actor TEXT,
    at TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def tx():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def empty_interview() -> dict:
    return {"items": [], "done": False}


def _drop_all(conn: sqlite3.Connection) -> None:
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    conn.execute("PRAGMA foreign_keys = OFF")
    for t in tables:
        conn.execute(f'DROP TABLE IF EXISTS "{t}"')
    conn.execute("PRAGMA foreign_keys = ON")


def init_db() -> None:
    """Миграция по спецификации: при смене версии схемы БД пересоздаётся из seed."""
    os.makedirs(os.path.dirname(os.path.abspath(config.DB_PATH)), exist_ok=True)
    with tx() as conn:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version != SCHEMA_VERSION:
            _drop_all(conn)
            conn.executescript(SCHEMA)
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        sync_services(conn)
        if conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0] == 0:
            seed_cases(conn)


def sync_services(conn: sqlite3.Connection) -> None:
    """Справочник всегда совпадает с seed в коде."""
    for s in SERVICES:
        conn.execute(
            """INSERT INTO services (id, title, agency, domain, description, required_documents,
                   default_deadline_days, responsible, min_age_months, max_age_months, available_cities,
                   base, default_explanation)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET title=excluded.title, agency=excluded.agency,
                   domain=excluded.domain, description=excluded.description,
                   required_documents=excluded.required_documents,
                   default_deadline_days=excluded.default_deadline_days, responsible=excluded.responsible,
                   min_age_months=excluded.min_age_months, max_age_months=excluded.max_age_months,
                   available_cities=excluded.available_cities, base=excluded.base,
                   default_explanation=excluded.default_explanation""",
            (
                s["id"], s["title"], s["agency"], s["domain"], s["description"],
                json.dumps(s["required_documents"], ensure_ascii=False),
                s["default_deadline_days"], s["responsible"], s["min_age_months"], s["max_age_months"],
                json.dumps(s["available_cities"], ensure_ascii=False) if s["available_cities"] else None,
                int(s["base"]), s["default_explanation"],
            ),
        )


def seed_cases(conn: sqlite3.Connection) -> None:
    for key, sc in SCENARIOS.items():
        case_id = create_case(conn, sc["child_alias"], sc["birth_date"], sc["city"], sc["language"], key)
        audit(conn, case_id, "case_created", "seed")


def create_case(conn, child_alias: str, birth_date: str, city: str, language: str, scenario: str | None) -> int:
    cur = conn.execute(
        """INSERT INTO cases (child_alias, birth_date, city, language, scenario, interview_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (child_alias, birth_date, city, language, scenario,
         json.dumps(empty_interview(), ensure_ascii=False), now_iso()),
    )
    return cur.lastrowid


def audit(conn, case_id: int | None, action: str, actor: str | None) -> None:
    conn.execute(
        "INSERT INTO audit_log (case_id, action, actor, at) VALUES (?, ?, ?, ?)",
        (case_id, action, actor, now_iso()),
    )


def reset_demo() -> None:
    with tx() as conn:
        conn.execute("DELETE FROM plan_steps")
        conn.execute("DELETE FROM cases")
        conn.execute("DELETE FROM audit_log")
        conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('cases', 'plan_steps', 'audit_log')")
        conn.execute("DELETE FROM settings WHERE key = 'demo_today'")
        seed_cases(conn)


def get_today(conn: sqlite3.Connection) -> date:
    """«Сегодня» = settings.demo_today, если задана, иначе реальная дата."""
    row = conn.execute("SELECT value FROM settings WHERE key = 'demo_today'").fetchone()
    return date.fromisoformat(row["value"]) if row else date.today()


def demo_today_is_set(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM settings WHERE key = 'demo_today'").fetchone() is not None


def set_demo_today(conn: sqlite3.Connection, d: date | None) -> None:
    if d is None:
        conn.execute("DELETE FROM settings WHERE key = 'demo_today'")
        return
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('demo_today', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (d.isoformat(),),
    )


def load_services(conn: sqlite3.Connection) -> dict[str, dict]:
    out = {}
    for r in conn.execute("SELECT * FROM services ORDER BY rowid"):
        d = dict(r)
        d["required_documents"] = json.loads(d["required_documents"])
        d["available_cities"] = json.loads(d["available_cities"]) if d["available_cities"] else None
        d["base"] = bool(d["base"])
        out[d["id"]] = d
    return out
