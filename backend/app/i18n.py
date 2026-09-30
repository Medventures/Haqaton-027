"""Перевод интерфейса на казахский: LLM переводит строки один раз, результат кешируется в SQLite.

При сбое модели возвращаются исходные (русские) строки и в кеш ничего не пишется — показываем ru.
"""

import json
import logging
from concurrent.futures import ThreadPoolExecutor

from . import db
from .llm import LLMError, get_llm

log = logging.getLogger("aqylroute.i18n")

MAX_TEXTS = 300
MAX_LEN = 600
CHUNK = 40

INSTRUCTIONS = """Ты переводишь интерфейс веб-сервиса поддержки семей детей с РАС с русского на казахский язык (кириллица).
Правила:
- Переводи каждую строку отдельно, по смыслу, простым вежливым языком, обращение на «Сіз».
- Сохраняй числа, даты, знаки препинания, эмодзи, символы «·», «→», «—» и кавычки «».
- Не переводи и не меняй: AqylRoute, AI, eGov, SMS, M-CHAT-R, ИИН, названия форм (031/у, 052/у).
- Аббревиатуры: ПМПК → ПМПК; МСЭ → МӘС; ИПР/ИПАР → ЖОБ; ЭЦП → ЭЦҚ; ВКК → ДКК; ГБД ФЛ → ЖТ МДҚ; НОБД → ҰБДҚ.
- Ведомства: медицина → медицина, образование → білім беру, соцзащита → әлеуметтік қорғау.
- Не добавляй пояснений, не объединяй и не разбивай строки. Если строку переводить не нужно, верни её как есть."""


def ensure_table(conn) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS translations (lang TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL, "
        "PRIMARY KEY (lang, src))"
    )


def _llm_translate(texts: list[str], lang: str) -> dict[str, str]:
    llm = get_llm()
    if llm is None:
        return {}
    schema = {
        "type": "object", "additionalProperties": False, "required": ["items"],
        "properties": {"items": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["i", "text"],
            "properties": {"i": {"type": "integer"}, "text": {"type": "string"}},
        }}},
    }
    payload = json.dumps({"target": "kk", "items": [{"i": i, "text": t} for i, t in enumerate(texts)]}, ensure_ascii=False)
    try:
        data = llm.structured("ui_translation", schema, INSTRUCTIONS, payload)
    except LLMError as e:
        log.warning("translation failed: %s", e)
        return {}
    out = {}
    for item in data.get("items") or []:
        i, text = item.get("i"), str(item.get("text") or "").strip()
        if isinstance(i, int) and 0 <= i < len(texts) and text:
            out[texts[i]] = text
    return out


def translate(texts: list[str], lang: str) -> dict[str, str]:
    texts = [t for t in dict.fromkeys(texts) if t and len(t) <= MAX_LEN][:MAX_TEXTS]
    if lang != "kk" or not texts:
        return {}
    with db.tx() as conn:
        ensure_table(conn)
        found = {}
        for t in texts:
            row = conn.execute("SELECT dst FROM translations WHERE lang = ? AND src = ?", (lang, t)).fetchone()
            if row:
                found[t] = row["dst"]
    missing = [t for t in texts if t not in found]
    chunks = [missing[k:k + CHUNK] for k in range(0, len(missing), CHUNK)]
    if chunks:
        # Пачки переводятся параллельно, чтобы первый показ страницы на казахском не ждал их по очереди.
        with ThreadPoolExecutor(max_workers=min(4, len(chunks))) as pool:
            results = list(pool.map(lambda ch: _llm_translate(ch, lang), chunks))
        got = {k: v for r in results for k, v in r.items()}
        if got:
            with db.tx() as conn:
                conn.executemany("INSERT OR REPLACE INTO translations (lang, src, dst) VALUES (?, ?, ?)",
                                 [(lang, s, d) for s, d in got.items()])
        found.update(got)
    return found
