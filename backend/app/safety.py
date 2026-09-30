"""Проверка текстов: никаких диагнозов, оценок тяжести, прогнозов и рекомендаций терапии."""

import re

from .config import STOP_PATTERNS

_STOP_RE = re.compile("|".join(STOP_PATTERNS), re.IGNORECASE | re.UNICODE)


def find_stop_words(text: str) -> list[str]:
    return sorted({m.group(0).lower() for m in _STOP_RE.finditer(text or "")})


def is_safe(text: str) -> bool:
    return not find_stop_words(text)
