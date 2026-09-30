"""Fixed texts for the «Срочная помощь» panel. No LLM is involved anywhere in this flow.

Rules: no advice on how to calm the child, no methods or therapies, no diagnoses — only emergency numbers,
«the curator is notified» and the nearest step of the plan.

Emergency numbers checked against egov.kz on 2026-09-30:
112 — единый номер вызова экстренных служб (egov.kz/cms/ru/articles/emergency_number_112),
103 — скорая медицинская помощь (egov.kz/cms/ru/services/pass132-3_mz).
"""

KINDS = ("safety", "regression", "benefit_stopped", "need_help")

# Kinds that raise the case alert (red flag at the top of the curator's list).
ALERT_KINDS = ("safety", "regression")

TOP_TEXT = ("Если ребёнок или кто-то рядом в опасности, звоните 112. Скорая помощь: 103. "
            "Не оставляйте ребёнка одного. Это не замена врача.")

PHONES = [
    {"number": "112", "label": "Экстренные службы"},
    {"number": "103", "label": "Скорая помощь"},
]

KIND_LABELS = {
    "safety": "Опасность для ребёнка или окружающих",
    "regression": "Резкие изменения в состоянии ребёнка",
    "benefit_stopped": "Остановили выплату или услугу",
    "need_help": "Нужна помощь куратора",
}

TEXTS = {
    "safety": "Если есть угроза жизни или здоровью, позвоните 112. Куратор уведомлён и свяжется с вами.",
    "regression": "Резкие изменения в состоянии ребёнка важно показать врачу как можно скорее. Куратор уведомлён.",
    "benefit_stopped": "Куратор уведомлён. Пока что подготовьте документы по ближайшему шагу.",
    "need_help": "Куратор уведомлён и свяжется с вами.",
}

NOTE_MAX = 200


def curator_message(kind: str, alias: str, note: str) -> str:
    extra = f" Семья пишет: «{note}»" if note else ""
    return f"Срочно ({alias}): {KIND_LABELS[kind].lower()}.{extra} Свяжитесь с семьёй."
