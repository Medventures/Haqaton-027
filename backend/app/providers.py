"""«Услуги»: demo directory of organizations. Synthetic names, no contacts, ratings or prices; no LLM.

The directory never recommends a specialist or a method and is not personalised by diagnosis:
filters are only city, type and a catalog service_id.
TODO(verify): the service_id mapping per provider type is a demo assumption; the real directory comes from the region.
"""

import json

TYPES = {
    "center": "Центр",
    "speech_therapist": "Логопед",
    "defectologist": "Дефектолог",
    "psychologist": "Психолог",
    "club": "Кружок",
    "sport": "Спорт",
    "parents": "Родительское объединение",
}

# Catalog services a provider type can appear under in «Где получить». State services (ПМПК, МСЭ, поликлиника) are
# never mapped to private organizations.
TYPE_SERVICES = {
    "center": ["EDU_REHAB", "SOC_SOCIAL_SERVICES"],
    "speech_therapist": ["EDU_REHAB"],
    "defectologist": ["EDU_REHAB"],
    "psychologist": ["EDU_REHAB"],
    "club": [],
    "sport": [],
    "parents": [],
}

PREFIX = {
    "center": "Центр развития",
    "speech_therapist": "Кабинет логопеда",
    "defectologist": "Кабинет дефектолога",
    "psychologist": "Кабинет психолога",
    "club": "Кружок",
    "sport": "Секция адаптивного спорта",
    "parents": "Родительское объединение",
}

DESCRIPTIONS = {
    "center": "Групповые и индивидуальные занятия со специалистами.",
    "speech_therapist": "Индивидуальные занятия с логопедом.",
    "defectologist": "Индивидуальные занятия с дефектологом.",
    "psychologist": "Консультации психолога для детей и родителей.",
    "club": "Групповые занятия по интересам: рисование, лепка, музыка.",
    "sport": "Физкультура и плавание в небольших группах.",
    "parents": "Встречи родителей и обмен опытом.",
}

# Fictional names (synthetic data): every card carries the «Демо-данные» badge.
NAMES = {
    "center": ["Радуга", "Мост", "Горизонт", "Бірлік", "Нұр", "Жұлдыз", "Шаг вперёд", "Ступени", "Вместе"],
    "speech_therapist": ["Звук", "Слово", "Речь", "Сөз", "Голос", "Азбука", "Әліппе", "Буква", "Диалог"],
    "defectologist": ["Опора", "Мозаика", "Тірек", "Пазл", "Кубик", "Лесенка", "Қадам", "Шаг", "Ключ"],
    "psychologist": ["Равновесие", "Тепло", "Гармония", "Жылу", "Доверие", "Сенім", "Берег", "Причал", "Маяк"],
    "club": ["Палитра", "Солнышко", "Мастерская", "Күн", "Ладошки", "Оригами", "Карандаш", "Шеберхана", "Акварель"],
    "sport": ["Волна", "Старт", "Дельфин", "Жүзу", "Мяч", "Батыр", "Спринт", "Тұлпар", "Олимп"],
    "parents": ["Қамқор", "Рука помощи", "Дос", "Родители рядом", "Бірге", "Круг", "Шаңырақ", "Мейірім", "Вместе"],
}
SECOND_CENTER = ["Алматы", "Астана", "Шымкент"]  # bigger cities get one more center
CITIES = ["Алматы", "Астана", "Шымкент", "Караганда", "Актобе", "Павлодар", "Өскемен", "Кызылорда", "Петропавловск"]


def _seed() -> list[dict]:
    out = []
    for ci, city in enumerate(CITIES):
        kinds = list(TYPES) + (["center"] if city in SECOND_CENTER else [])
        for ki, t in enumerate(kinds):
            n = NAMES[t][(ci + ki * 3 + (4 if ki >= len(TYPES) else 0)) % len(NAMES[t])]
            out.append({"name": f"{PREFIX[t]} «{n}»", "type": t, "city": city, "service_ids": TYPE_SERVICES[t],
                        "description": DESCRIPTIONS[t], "contact": None, "is_demo": True})
    return out


SEED = _seed()

# No CHECK on type: types are validated by the API, so new types do not need a table rebuild.
SCHEMA = """CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    city TEXT NOT NULL,
    service_ids TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 200),
    contact TEXT,
    is_demo INTEGER NOT NULL DEFAULT 1
)"""


def ensure(conn) -> None:
    """Created next to the main schema without a version bump. Demo rows follow SEED: when the seed changes,
    only is_demo rows are replaced (the table holds nothing else, and no other table refers to provider ids)."""
    old = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'providers'").fetchone()
    if old and "CHECK (type IN" in old[0]:
        conn.execute("DROP TABLE providers")  # first version limited the types
    conn.execute(SCHEMA)
    have = {(r[0], r[1], r[2]) for r in conn.execute("SELECT name, city, type FROM providers WHERE is_demo = 1")}
    if have == {(p["name"], p["city"], p["type"]) for p in SEED}:
        return
    conn.execute("DELETE FROM providers WHERE is_demo = 1")
    conn.executemany(
        "INSERT INTO providers (name, type, city, service_ids, description, contact, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(p["name"], p["type"], p["city"], json.dumps(p["service_ids"]), p["description"], p["contact"], int(p["is_demo"]))
         for p in SEED],
    )


def _row(r) -> dict:
    d = dict(r)
    d["service_ids"] = json.loads(d["service_ids"])
    d["is_demo"] = bool(d["is_demo"])
    d["type_label"] = TYPES.get(d["type"], d["type"])
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
