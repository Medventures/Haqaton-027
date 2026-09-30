"""«Услуги»: demo directory of organizations. Synthetic names, no contacts, ratings or prices; no LLM.

The directory never recommends a specialist or a method and is not personalised by diagnosis:
filters are only city, type and a catalog service_id.
TODO(verify): the service_id mapping per provider type is a demo assumption; the real directory comes from the region.
"""

import json

TYPES = {
    "club": "Кружок",
    "speech_therapist": "Логопед",
    "defectologist": "Дефектолог",
    "center": "Центр",
}

# Catalog services a provider type can appear under in «Где получить». State services (ПМПК, МСЭ, поликлиника) are
# never mapped to private organizations.
TYPE_SERVICES = {
    "club": [],
    "speech_therapist": ["EDU_REHAB"],
    "defectologist": ["EDU_REHAB"],
    "center": ["EDU_REHAB", "SOC_SOCIAL_SERVICES"],
}

DESCRIPTIONS = {
    "club": "Демо-запись. Групповые занятия по интересам для детей.",
    "speech_therapist": "Демо-запись. Индивидуальные занятия с логопедом.",
    "defectologist": "Демо-запись. Индивидуальные занятия с дефектологом.",
    "center": "Демо-запись. Групповые и индивидуальные занятия со специалистами.",
}

_SEED = {
    "Кызылорда": [("center", "Демо-центр «Радуга»"), ("speech_therapist", "Демо-кабинет логопеда «Слово»"),
                  ("defectologist", "Демо-кабинет дефектолога «Шаг»"), ("club", "Демо-кружок «Солнышко»")],
    "Петропавловск": [("center", "Демо-центр «Мост»"), ("speech_therapist", "Демо-кабинет логопеда «Звук»"),
                      ("defectologist", "Демо-кабинет дефектолога «Опора»"), ("club", "Демо-кружок «Палитра»"),
                      ("center", "Демо-центр «Вместе»")],
    "Шымкент": [("center", "Демо-центр «Радуга»"), ("speech_therapist", "Демо-кабинет логопеда «Речь»"),
                ("defectologist", "Демо-кабинет дефектолога «Ступени»"), ("club", "Демо-кружок «Мастерская»")],
}

SEED = [
    {"name": f"{name} ({city})", "type": t, "city": city, "service_ids": TYPE_SERVICES[t],
     "description": DESCRIPTIONS[t], "contact": None, "is_demo": True}
    for city, rows in _SEED.items() for t, name in rows
]

SCHEMA = """CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('club', 'speech_therapist', 'defectologist', 'center')),
    city TEXT NOT NULL,
    service_ids TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 200),
    contact TEXT,
    is_demo INTEGER NOT NULL DEFAULT 1
)"""


def ensure(conn) -> None:
    """Created next to the main schema without a version bump, so existing data stays. Seeded once."""
    conn.execute(SCHEMA)
    if conn.execute("SELECT COUNT(*) FROM providers").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO providers (name, type, city, service_ids, description, contact, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(p["name"], p["type"], p["city"], json.dumps(p["service_ids"]), p["description"], p["contact"], int(p["is_demo"]))
             for p in SEED],
        )


def _row(r) -> dict:
    d = dict(r)
    d["service_ids"] = json.loads(d["service_ids"])
    d["is_demo"] = bool(d["is_demo"])
    d["type_label"] = TYPES[d["type"]]
    return d


def search(conn, city: str | None = None, type_: str | None = None, service_id: str | None = None) -> list[dict]:
    rows = [_row(r) for r in conn.execute("SELECT * FROM providers")]
    if city:
        rows = [p for p in rows if p["city"].casefold() == city.strip().casefold()]
    if type_:
        rows = [p for p in rows if p["type"] == type_]
    if service_id:
        rows = [p for p in rows if service_id in p["service_ids"]]
    return sorted(rows, key=lambda p: (p["name"].casefold(), p["id"]))


def cities(conn) -> list[str]:
    return sorted({r["city"] for r in conn.execute("SELECT DISTINCT city FROM providers")}, key=str.casefold)


def where_to_get(conn, city: str, service_id: str, limit: int = 3) -> list[dict]:
    return search(conn, city=city, service_id=service_id)[:limit]
