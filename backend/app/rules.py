"""Детерминированное ядро плана.

Для каждой услуги evaluate(profile, today) возвращает state (active | locked | hidden), срок и его основание,
зависимости, дату открытия, базовый приоритет и reason_code. LLM не добавляет и не убирает шаги.
"""

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from . import config
from .catalog import EDUCATION_OPTIONS, IPAR_OPTIONS, SERVICES, SERVICES_BY_ID

REASONS = {
    "no_conclusion_no_pediatrician": "Нет заключения врача и не было визита к педиатру.",
    "mchat_window": "Возраст в окне скрининга 16–30 месяцев, скрининг ещё не проходили.",
    "mchat_after_pediatrician": "Скрининг доступен после консультации педиатра.",
    "mchat_too_early": "Скрининг проводится с 16 месяцев.",
    "conclusion_not_on_hand": "Заключение врача есть, но на руках его нет.",
    "followup_needed": "Следующий визит к врачу не назначен или выполнять назначения трудно.",
    "mse_ref_needed": "Справки МСЭ не было, заключению врача больше 4 месяцев, направления нет.",
    "mse_after_referral": "Освидетельствование возможно после направления из поликлиники.",
    "mse_referral_ready": "Направление на МСЭ уже выдано.",
    "pmpk_missing": "Есть заключение врача, а ПМПК не пройдена или истекла.",
    "mse_expired": "Справка МСЭ истекла.",
    "mse_expiring": "Справка МСЭ скоро истекает.",
    "mse_expiring_preview": "Справка МСЭ истекает в ближайшие месяцы.",
    "tutor_after_pmpk": "Ребёнок в школе без тьютора; тьютор назначается по заключению ПМПК.",
    "tutor_needed": "Ребёнок в школе без тьютора, заключение ПМПК действует.",
    "adapted_program_needed": "Ребёнок в обычном классе, заключение ПМПК действует.",
    "spec_class_needed": "Ребёнок школьного возраста дома, заключение ПМПК действует.",
    "rehab_not_received": "Рекомендованные ПМПК занятия не получаются.",
    "ipar_item_missing": "Справка МСЭ действует, а эта мера по ИПР ещё не получена.",
}


@dataclass
class RuleResult:
    service_id: str
    state: str  # active | locked
    due_date: date
    due_basis: str  # default | document_expiry | age_window | rule
    base_priority: str
    reason_code: str
    depends_on: list[str] = field(default_factory=list)
    unlock_date: date | None = None
    unlock_hint: str | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["due_date"] = self.due_date.isoformat()
        d["unlock_date"] = self.unlock_date.isoformat() if self.unlock_date else None
        d["reason"] = REASONS.get(self.reason_code, "")
        return d


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    raise ValueError("bad date")


def age_months(birth: date, today: date) -> int:
    months = (today.year - birth.year) * 12 + (today.month - birth.month)
    if today.day < birth.day:
        months -= 1
    return max(0, months)


def stage_for(months: int) -> str:
    if months < 36:
        return "early"
    if months < 84:
        return "correction"
    return "socialization"


def _d(v) -> date | None:
    return date.fromisoformat(v) if v else None


class Profile:
    """Факты кейса: анкета Q0, слоты интервью и документы на руках (с учётом срока действия)."""

    def __init__(self, case: dict, docs_have: set[str], today: date):
        self.today = today
        self.birth = date.fromisoformat(case["birth_date"])
        self.city = case.get("city")
        self.months = age_months(self.birth, today)
        i = case.get("intake") or {}
        self.has_conclusion = bool(i.get("has_conclusion"))
        self.conclusion_date = _d(i.get("conclusion_date"))
        self.pmpk_status = i.get("pmpk_status") or "none"
        self.mse_status = i.get("mse_status") or "none"
        self.mse_valid_until = _d(i.get("mse_valid_until"))
        self.mchat_done = (i.get("mchat_status") or "none") == "done"
        self.pediatrician_visited = bool(i.get("pediatrician_visited"))
        self.docs_have = docs_have
        self.slots = case.get("profile") or {}

    @property
    def pmpk_valid(self) -> bool:
        return self.pmpk_status == "valid"

    @property
    def mse_ever(self) -> bool:
        return self.mse_status != "none"

    @property
    def mse_valid(self) -> bool:
        if not self.mse_ever or self.mse_status == "expired":
            return False
        return self.mse_valid_until is None or self.mse_valid_until >= self.today

    @property
    def conclusion_older_than_4m(self) -> bool:
        return bool(self.conclusion_date) and add_months(self.conclusion_date, 4) < self.today

    def slot(self, name):
        return self.slots.get(name)

    @property
    def education_code(self) -> str | None:
        v = self.slot("education_setting")
        for code, label in EDUCATION_OPTIONS.items():
            if v == label:
                return code
        return None


def _default_due(sid: str, today: date) -> date:
    return today + timedelta(days=SERVICES_BY_ID[sid]["default_deadline_days"])


def _active(sid, p, prio, reason, due=None, basis="default") -> RuleResult:
    return RuleResult(sid, "active", due or _default_due(sid, p.today), basis, prio, reason)


def _locked(sid, p, prio, reason, *, depends_on=None, unlock_date=None, due=None, basis="default", hint=None) -> RuleResult:
    return RuleResult(sid, "locked", due or _default_due(sid, p.today), basis, prio, reason,
                      depends_on or [], unlock_date, hint)


def evaluate_all(p: Profile) -> dict[str, RuleResult]:
    """Все услуги со state active или locked (hidden не возвращаются), в порядке справочника."""
    out: dict[str, RuleResult] = {}
    t = p.today

    # MED_PEDIATRICIAN
    if not p.has_conclusion and not p.pediatrician_visited:
        out["MED_PEDIATRICIAN"] = _active("MED_PEDIATRICIAN", p, "high", "no_conclusion_no_pediatrician")

    # MED_MCHAT: окно 16–30 месяцев
    if not p.has_conclusion and not p.mchat_done and p.months <= 30:
        window_end = add_months(p.birth, 30)
        opens = add_months(p.birth, 16)
        deps = ["MED_PEDIATRICIAN"] if "MED_PEDIATRICIAN" in out else []
        too_early = p.months < 16
        if deps or too_early:
            if deps:
                hint = f"после консультации педиатра, скрининг возможен до {window_end.isoformat()}"
                reason = "mchat_after_pediatrician"
            else:
                hint = f"скрининг возможен с {opens.isoformat()} до {window_end.isoformat()}"
                reason = "mchat_too_early"
            out["MED_MCHAT"] = _locked("MED_MCHAT", p, "medium", reason, depends_on=deps,
                                       unlock_date=opens if too_early else None, due=window_end,
                                       basis="age_window", hint=hint)
        else:
            out["MED_MCHAT"] = _active("MED_MCHAT", p, "medium", "mchat_window", due=window_end, basis="age_window")

    # MED_CONCLUSION_COPY
    if p.has_conclusion and "MED_CONCLUSION" not in p.docs_have:
        out["MED_CONCLUSION_COPY"] = _active("MED_CONCLUSION_COPY", p, "high", "conclusion_not_on_hand")

    # MED_FOLLOWUP
    followup = p.slot("med_followup")
    if p.has_conclusion and followup and followup != "Визит назначен, назначения выполняем":
        out["MED_FOLLOWUP"] = _active("MED_FOLLOWUP", p, "medium", "followup_needed")

    # MED_MSE_REF и SOC_MSE (первичное). Если справка была — только SOC_MSE_REEXAM, без дублей.
    if not p.mse_ever and p.has_conclusion and p.conclusion_older_than_4m:
        if p.slot("mse_ref_status") == "Да, направление выдали":
            out["SOC_MSE"] = _active("SOC_MSE", p, "high", "mse_referral_ready")
        else:
            out["MED_MSE_REF"] = _active("MED_MSE_REF", p, "high", "mse_ref_needed")
            out["SOC_MSE"] = _locked("SOC_MSE", p, "high", "mse_after_referral", depends_on=["MED_MSE_REF"],
                                     hint="после направления из поликлиники и заключения ВКК")

    # MED_REHAB — в каталоге, правило пока скрыто (P2).

    # EDU_PMPK
    if p.has_conclusion and p.pmpk_status in ("none", "expired"):
        due = (p.conclusion_date or t) + timedelta(days=config.PMPK_DUE_AFTER_DIAGNOSIS_DAYS)
        out["EDU_PMPK"] = _active("EDU_PMPK", p, "high", "pmpk_missing", due=due, basis="rule")

    # EDU_TUTOR, EDU_ADAPTED_PROGRAM, EDU_SPEC_CLASS, EDU_REHAB
    edu = p.education_code
    if edu == "school_regular" and p.has_conclusion:
        if p.pmpk_valid:
            out["EDU_TUTOR"] = _active("EDU_TUTOR", p, "high", "tutor_needed")
        elif "EDU_PMPK" in out:
            out["EDU_TUTOR"] = _locked("EDU_TUTOR", p, "high", "tutor_after_pmpk", depends_on=["EDU_PMPK"],
                                       hint="после заключения ПМПК")
    if edu == "school_regular" and p.pmpk_valid:
        out["EDU_ADAPTED_PROGRAM"] = _active("EDU_ADAPTED_PROGRAM", p, "medium", "adapted_program_needed")
    if edu == "home" and p.pmpk_valid and p.months >= 84:
        out["EDU_SPEC_CLASS"] = _active("EDU_SPEC_CLASS", p, "medium", "spec_class_needed")
    rehab = p.slot("rehab_status")
    if p.pmpk_valid and rehab in ("Не получает", "Получает часть занятий"):
        out["EDU_REHAB"] = _active("EDU_REHAB", p, "high" if rehab == "Не получает" else "medium", "rehab_not_received")

    # SOC_MSE_REEXAM: по сроку действия справки
    if p.mse_ever and p.mse_valid_until:
        days_left = (p.mse_valid_until - t).days
        if days_left < 0:
            out["SOC_MSE_REEXAM"] = _active("SOC_MSE_REEXAM", p, "high", "mse_expired",
                                            due=p.mse_valid_until, basis="document_expiry")
        elif days_left <= config.MSE_LEAD_DAYS:
            out["SOC_MSE_REEXAM"] = _active("SOC_MSE_REEXAM", p, "high", "mse_expiring",
                                            due=p.mse_valid_until, basis="document_expiry")
        elif days_left <= config.MSE_PREVIEW_DAYS:
            opens = p.mse_valid_until - timedelta(days=config.MSE_LEAD_DAYS)
            out["SOC_MSE_REEXAM"] = _locked(
                "SOC_MSE_REEXAM", p, "high", "mse_expiring_preview", unlock_date=opens, due=p.mse_valid_until,
                basis="document_expiry",
                hint=f"станет срочным с {opens.isoformat()}, за {config.MSE_LEAD_DAYS} дней до окончания справки")
    elif p.mse_status == "expired":
        out["SOC_MSE_REEXAM"] = _active("SOC_MSE_REEXAM", p, "high", "mse_expired")

    # SOC_*: только при действующей справке МСЭ и если мера по ИПР ещё не получена
    items = p.slot("ipar_items")
    if p.mse_valid and items is not None:
        got = set(items if isinstance(items, list) else [items])
        for sid, label in IPAR_OPTIONS.items():
            if label not in got:
                out[sid] = _active(sid, p, "medium", "ipar_item_missing")

    order = {s["id"]: i for i, s in enumerate(SERVICES)}
    return dict(sorted(out.items(), key=lambda kv: order[kv[0]]))
