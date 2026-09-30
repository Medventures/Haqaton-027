"""Имитация получения документов из госсистем (демо).

Реальных запросов нет: «ответ госсистем» собирается из синтетических данных кейса (анкета Q0 и папка документов).
Медицинские сведения не запрашиваются — заключение врача показывается как добавленное вручную.
"""

from datetime import date

from .tracking import fmt

SOURCES = [
    {"key": "gbd", "short": "ГБД ФЛ", "name": "ГБД физических лиц",
     "what": "ФИО, ИИН и дата рождения ребёнка, подтверждение, что вы его законный представитель"},
    {"key": "nobd", "short": "НОБД", "name": "НОБД, модуль ПМПК",
     "what": "Заключение ПМПК, рекомендации, срок действия; справки о курсах коррекции"},
    {"key": "mse", "short": "МСЭ", "name": "Система МСЭ МТСЗН",
     "what": "Инвалидность и её срок, индивидуальная программа (ИПР)"},
    {"key": "portal", "short": "Портал", "name": "Портал социальных услуг",
     "what": "Заказы средств реабилитации, санатория и спецсоцуслуг"},
]
NOT_REQUESTED = "Медицинские записи и диагнозы из систем Минздрава. Заключение врача вы можете добавить сами."

# Какие документы «приходят» из ГБД ФЛ при согласии.
GBD_DOCS = ("BIRTH_CERT", "ID_PARENT")


def _validity(valid_until: str | None, today: date) -> tuple[str, str]:
    if not valid_until:
        return "Бессрочно", "muted"
    days = (date.fromisoformat(valid_until) - today).days
    if days < 0:
        return f"Истекла {fmt(valid_until)} · {abs(days)} дн. назад", "crit"
    if days <= 30:
        return f"До {fmt(valid_until)} · осталось {days} дн.", "warn"
    return f"До {fmt(valid_until)} · ещё {days} дн.", "ok"


def build_rows(case: dict, folder: dict[str, dict], today: date) -> list[dict]:
    i = case["intake"]
    rows: list[dict] = []

    def row(doc, source, issued, validity, tone, detail):
        rows.append({"doc": doc, "source": source, "issued": fmt(issued) if issued else "—",
                     "validity": validity, "tone": tone, "detail": detail})

    row("Свидетельство о рождении", "ГБД ФЛ", case["birth_date"], "Бессрочно", "muted",
        f"{case['child_alias']}, дата рождения {fmt(case['birth_date'])}")
    row("Удостоверение личности родителя", "ГБД ФЛ", None, "Действует", "muted", "Законный представитель подтверждён")

    if i.get("pmpk_status") == "valid":
        row("Заключение ПМПК", "НОБД", i.get("pmpk_date"), "Действует", "ok", "Рекомендации по условиям обучения")
    elif i.get("pmpk_status") == "expired":
        row("Заключение ПМПК", "НОБД", i.get("pmpk_date"), "Истекло", "crit", "Нужно пройти комиссию повторно")
    else:
        row("Заключение ПМПК", "НОБД", None, "—", "muted", "Сведений не найдено")

    if i.get("mse_status") in ("valid", "expired"):
        validity, tone = _validity(i.get("mse_valid_until"), today)
        row("Справка МСЭ об инвалидности", "МСЭ", None, validity, tone, "Категория «ребёнок с инвалидностью»")
        if folder.get("IPR_EXTRACT", {}).get("marked"):
            row("Индивидуальная программа (ИПР)", "МСЭ", None, validity, tone, "Положенные меры и средства")
    else:
        row("Справка МСЭ об инвалидности", "МСЭ", None, "—", "muted", "Сведений не найдено")

    row("Заказы на Портале соцуслуг", "Портал", None, "—", "muted", "Заказов не найдено")

    if i.get("has_conclusion"):
        on_hand = folder.get("MED_CONCLUSION", {}).get("marked")
        row("Заключение врача", "Вручную", i.get("conclusion_date"), "Бессрочно", "muted",
            "Добавлено семьёй" if on_hand else "Есть со слов семьи, на руках нет")
    return rows
