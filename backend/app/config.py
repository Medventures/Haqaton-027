import os


def _load_dotenv() -> None:
    """Подхватывает .env из корня репозитория (ключи только там, не в коде)."""
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    for path in (os.path.join(root, ".env"), os.path.join(root, "backend", ".env")):
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
# Относительный DB_PATH считается от папки backend/ (DB_PATH=./data/app.db -> backend/data/app.db).
DB_PATH = os.path.join(BACKEND_DIR, os.getenv("DB_PATH") or "./data/app.db")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-6-luna")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL") or None
OPENAI_TIMEOUT_S = float(os.getenv("OPENAI_TIMEOUT_S", "60"))
OPENAI_TEMPERATURE = float(os.getenv("OPENAI_TEMPERATURE", "0.2"))

DEMO_MODE = _bool("DEMO_MODE", True)

# Интервью
MIN_QUESTIONS = 8
MAX_QUESTIONS = 12

# План
MAX_EXPLANATION_LEN = 300
# Эскалация: просрочка больше N дней.
ESCALATION_AFTER_DAYS = int(os.getenv("ESCALATION_AFTER_DAYS", os.getenv("ESCALATION_DAYS", "3")))
# Срок ПМПК после заключения врача (значение подтверждает Асем).
PMPK_DUE_AFTER_DIAGNOSIS_DAYS = int(os.getenv("PMPK_DUE_AFTER_DIAGNOSIS_DAYS", "365"))
# Переосвидетельствование МСЭ: за сколько дней до окончания справки шаг становится срочным / виден как предстоящий.
MSE_LEAD_DAYS = int(os.getenv("MSE_LEAD_DAYS", "30"))
MSE_PREVIEW_DAYS = int(os.getenv("MSE_PREVIEW_DAYS", "90"))
# «Скоро срок»: 0 ≤ days_to_due ≤ N (для услуг с due_soon_days — своё значение).
DUE_SOON_DAYS = int(os.getenv("DUE_SOON_DAYS", "7"))
# Дата демо по умолчанию: от неё посчитаны даты синтетических кейсов.
DEMO_SEED_TODAY = os.getenv("DEMO_SEED_TODAY", "2026-09-30")

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

# Стоп-слова (регулярные выражения, без учёта регистра). «РАС» и «аутизм» не входят — это предметная область.
# Объяснение с совпадением
# заменяется шаблонным; вопрос интервью — шаблонным вопросом.
STOP_PATTERNS = [
    # диагнозы и медицинские ярлыки
    r"диагноз",
    r"диагностир",
    r"синдром",
    r"\bf\s?\d{2}",
    r"патолог",
    r"заболеван",
    r"болезн",
    r"отставани[ея] в развитии",
    r"нарушени[ея] развития",
    # оценки тяжести и прогнозы
    r"прогноз",
    r"тяжест",
    r"тяж[её]л",
    r"выраженност",
    r"степен[ьи] (тяжести|выраженности|нарушени)",
    r"л[её]гк(ая|ой|ую) форм",
    r"инвалидизир",
    # лечение и терапия
    r"лечени",
    r"\bлечить",
    r"\bлечат",
    r"лекарств",
    r"препарат",
    r"таблет",
    r"дозиров",
    r"\bдоз[аыу]\b",
    r"\bмг\b",
    r"медикамент",
    r"витамин",
    r"терапи",
    r"рекомендуем\w* (занятия|курс|метод)",
]
