import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone

from . import config
from .catalog import DOC_TYPES, SCENARIOS, SERVICES

SCHEMA_VERSION = 3

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
    available_cities TEXT,
    channel TEXT NOT NULL,
    how_to TEXT NOT NULL,
    egov_url TEXT,
    typical_duration TEXT NOT NULL,
    extra TEXT NOT NULL
);
CREATE TABLE doc_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_alias TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    city TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('ru', 'kk')),
    scenario TEXT,
    intake TEXT NOT NULL,
    profile TEXT NOT NULL,
    interview_json TEXT NOT NULL,
    summary_confirmed INTEGER NOT NULL DEFAULT 0,
    handling_mode TEXT NOT NULL DEFAULT 'system' CHECK (handling_mode IN ('system', 'curator')),
    alert INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'awaiting_curator', 'confirmed')),
    plan_meta TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT
);
CREATE TABLE case_documents (
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL REFERENCES doc_types(id),
    have INTEGER NOT NULL DEFAULT 0,
    issued_at TEXT,
    valid_until TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (case_id, doc_type)
);
CREATE TABLE plan_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    service_id TEXT NOT NULL REFERENCES services(id),
    priority TEXT CHECK (priority IS NULL OR priority IN ('high', 'medium', 'low')),
    base_priority TEXT NOT NULL CHECK (base_priority IN ('high', 'medium', 'low')),
    owner TEXT NOT NULL,
    due_date TEXT NOT NULL,
    due_basis TEXT NOT NULL CHECK (due_basis IN ('default', 'document_expiry', 'age_window', 'rule')),
    depends_on TEXT NOT NULL DEFAULT '[]',
    unlock_date TEXT,
    unlock_hint TEXT NOT NULL DEFAULT '',
    reason_code TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('locked', 'todo', 'in_progress', 'done')),
    explanation TEXT NOT NULL,
    curator_note TEXT NOT NULL DEFAULT '',
    escalated INTEGER NOT NULL DEFAULT 0,
    blocker TEXT CHECK (blocker IS NULL OR blocker IN ('missing_document', 'awaiting_agency', 'no_service_in_region', 'family_declined', 'decision_disputed')),
    blocker_note TEXT NOT NULL DEFAULT '',
    completed_at TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    step_id INTEGER,
    type TEXT NOT NULL CHECK (type IN ('overdue', 'escalation', 'red_flag', 'unlocked', 'due_soon')),
    audience TEXT NOT NULL CHECK (audience IN ('curator', 'parent')),
    message TEXT NOT NULL,
    dedup_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0
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

SERVICE_EXTRA_KEYS = ("optional_documents", "extra_notes", "produces", "executor", "due_soon_days", "default_explanation")


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
        if conn.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
            _drop_all(conn)
            conn.executescript(SCHEMA)
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        sync_catalog(conn)
        if conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0] == 0:
            seed_cases(conn)
            set_demo_today(conn, date.fromisoformat(config.DEMO_SEED_TODAY))


def sync_catalog(conn: sqlite3.Connection) -> None:
    """Справочник и типы документов всегда совпадают с seed в коде."""
    for d in DOC_TYPES:
        conn.execute(
            "INSERT INTO doc_types (id, name, note) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET name = excluded.name, note = excluded.note",
            (d["id"], d["name"], d["note"]),
        )
    for s in SERVICES:
        extra = json.dumps({k: s[k] for k in SERVICE_EXTRA_KEYS}, ensure_ascii=False)
        conn.execute(
            """INSERT INTO services (id, title, agency, domain, description, required_documents, default_deadline_days,
                   responsible, available_cities, channel, how_to, egov_url, typical_duration, extra)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET title=excluded.title, agency=excluded.agency, domain=excluded.domain,
                   description=excluded.description, required_documents=excluded.required_documents,
                   default_deadline_days=excluded.default_deadline_days, responsible=excluded.responsible,
                   available_cities=excluded.available_cities, channel=excluded.channel, how_to=excluded.how_to,
                   egov_url=excluded.egov_url, typical_duration=excluded.typical_duration, extra=excluded.extra""",
            (
                s["id"], s["title"], s["agency"], s["domain"], s["description"],
                json.dumps(s["required_documents"]), s["default_deadline_days"], s["responsible"],
                json.dumps(s["available_cities"], ensure_ascii=False) if s["available_cities"] else None,
                s["channel"], s["how_to"], s["egov_url"], s["typical_duration"], extra,
            ),
        )


def seed_cases(conn: sqlite3.Connection) -> None:
    for key, sc in SCENARIOS.items():
        case_id = create_case(conn, sc["child_alias"], sc["birth_date"], sc["city"], sc["language"], sc["intake"], key)
        audit(conn, case_id, "case_created", "seed")


def create_case(conn, child_alias: str, birth_date: str, city: str, language: str, intake: dict,
                scenario: str | None) -> int:
    cur = conn.execute(
        """INSERT INTO cases (child_alias, birth_date, city, language, scenario, intake, profile, interview_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)""",
        (child_alias, birth_date, city, language, scenario, json.dumps(intake, ensure_ascii=False),
         json.dumps(empty_interview()), now_iso()),
    )
    case_id = cur.lastrowid
    # Единая папка: документы из анкеты Q0; сроки справок берутся из анкеты.
    dates = {
        "MED_CONCLUSION": (intake.get("conclusion_date"), None),
        "PMPK_CONCLUSION": (intake.get("pmpk_date"), None),
        "MSE_CERT": (None, intake.get("mse_valid_until")),
    }
    for doc in intake.get("documents") or []:
        issued, valid = dates.get(doc, (None, None))
        conn.execute(
            "INSERT OR REPLACE INTO case_documents (case_id, doc_type, have, issued_at, valid_until, updated_at) "
            "VALUES (?, ?, 1, ?, ?, ?)",
            (case_id, doc, issued, valid, now_iso()),
        )
    return case_id


def audit(conn, case_id: int | None, action: str, actor: str | None) -> None:
    conn.execute("INSERT INTO audit_log (case_id, action, actor, at) VALUES (?, ?, ?, ?)", (case_id, action, actor, now_iso()))


def reset_demo() -> None:
    with tx() as conn:
        for t in ("notifications", "plan_steps", "case_documents", "cases", "audit_log"):
            conn.execute(f"DELETE FROM {t}")
        conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('cases', 'plan_steps', 'audit_log', 'notifications')")
        seed_cases(conn)
        set_demo_today(conn, date.fromisoformat(config.DEMO_SEED_TODAY))


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
        "INSERT INTO settings (key, value) VALUES ('demo_today', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (d.isoformat(),),
    )


def load_services(conn: sqlite3.Connection) -> dict[str, dict]:
    out = {}
    for r in conn.execute("SELECT * FROM services ORDER BY rowid"):
        d = dict(r)
        d["required_documents"] = json.loads(d["required_documents"])
        d["available_cities"] = json.loads(d["available_cities"]) if d["available_cities"] else None
        d.update(json.loads(d.pop("extra")))
        out[d["id"]] = d
    return out


def load_doc_types(conn: sqlite3.Connection) -> dict[str, dict]:
    return {r["id"]: dict(r) for r in conn.execute("SELECT * FROM doc_types ORDER BY rowid")}


def load_case_documents(conn, case_id: int, today: date) -> dict[str, dict]:
    """Папка документов кейса: для каждого doc_type — have с учётом срока действия."""
    rows = {r["doc_type"]: dict(r) for r in conn.execute("SELECT * FROM case_documents WHERE case_id = ?", (case_id,))}
    out = {}
    for dt in load_doc_types(conn).values():
        r = rows.get(dt["id"])
        valid_until = r["valid_until"] if r else None
        expired = bool(valid_until) and date.fromisoformat(valid_until) < today
        out[dt["id"]] = {
            "doc_type": dt["id"],
            "name": dt["name"],
            "note": dt["note"],
            "marked": bool(r and r["have"]),
            "have": bool(r and r["have"]) and not expired,
            "expired": bool(r and r["have"]) and expired,
            "issued_at": r["issued_at"] if r else None,
            "valid_until": valid_until,
        }
    return out


def set_case_document(conn, case_id: int, doc_type: str, have: bool, issued_at: str | None = None,
                      valid_until: str | None = None, keep_dates: bool = True) -> None:
    row = conn.execute("SELECT * FROM case_documents WHERE case_id = ? AND doc_type = ?", (case_id, doc_type)).fetchone()
    if row and keep_dates:
        issued_at = issued_at if issued_at is not None else row["issued_at"]
        valid_until = valid_until if valid_until is not None else row["valid_until"]
    conn.execute(
        "INSERT OR REPLACE INTO case_documents (case_id, doc_type, have, issued_at, valid_until, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (case_id, doc_type, int(have), issued_at, valid_until, now_iso()),
    )
