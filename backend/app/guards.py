"""Pre-LLM filter for «Вопрос по плану». Pure regexes, no model call.

danger  → fixed text about 112 and an urgent(kind=safety) request to the curator;
medical → fixed refusal: diagnoses, medicines, doses, treatment and behaviour advice are for a doctor.
TODO(verify): the Kazakh word lists need a native speaker review.
"""

import re

DANGER_PATTERNS = [
    # ru
    r"\bбол(ь|и|ит|ят|ью|ей|ело|ела)\b", r"\bболезненн", r"агресси", r"самоповрежд", r"(бь[её]т|ранит|режет|кусает) себя",
    r"судорог", r"припад", r"потерял(ся|ась|ись)", r"\bпропал(а|и)?\b", r"не дышит", r"задыха", r"травм",
    r"кровотеч", r"\bкровь\b", r"отравил", r"суицид", r"\bупал(а)?\b", r"ожог", r"без сознания", r"\bопасн",
    # kk
    r"ауырады", r"\bауру", r"агрессия", r"құрыс", r"\bталма", r"жоғалып кетті", r"\bжоғалды", r"өзін-өзі",
    r"жарақат", r"тұншығ", r"қан кет", r"улан", r"есінен тан", r"қауіп",
]

MEDICAL_PATTERNS = [
    # ru
    r"диагноз", r"лекарств", r"препарат", r"таблетк", r"\bдоз(а|у|ы|е|ировк)", r"лечени", r"\bлечить", r"вылечить",
    r"\bлечат", r"терапи", r"витамин", r"\bукол", r"нейролептик", r"антидепрессант", r"успокоительн", r"\bбад\b",
    r"как успокоить", r"истерик", r"это аутизм", r"какая степень", r"прогноз",
    # kk
    r"диагноз", r"\bдәрі", r"дәрумен", r"\bемде", r"\bемі\b", r"таблетка", r"\bекпе", r"қалай тынышта",
]

_DANGER_RE = re.compile("|".join(DANGER_PATTERNS), re.IGNORECASE)
_MEDICAL_RE = re.compile("|".join(MEDICAL_PATTERNS), re.IGNORECASE)

DANGER_TEXT = ("Если ребёнку или кому-то рядом угрожает опасность, звоните 112, скорая помощь — 103. "
               "Не оставляйте ребёнка одного. Куратор уведомлён и свяжется с вами.")
MEDICAL_TEXT = "Это вопрос к врачу. Я объясняю только шаги маршрута."
LIMIT_TEXT = "Слишком много вопросов за час. Попробуйте позже или напишите куратору."


def classify(message: str) -> str | None:
    """'danger' | 'medical' | None. Danger wins: it must never be answered by the model."""
    if _DANGER_RE.search(message):
        return "danger"
    if _MEDICAL_RE.search(message):
        return "medical"
    return None
