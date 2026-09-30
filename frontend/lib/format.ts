import type { Blocker, CaseStatus, Domain, Priority, StepStatus } from "./types";

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

export const STATUS_LABEL: Record<StepStatus, string> = {
  locked: "Заблокирован",
  todo: "Не начат",
  in_progress: "В работе",
  done: "Выполнен",
};

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  draft: "Интервью",
  awaiting_curator: "Ждёт куратора",
  confirmed: "План подтверждён",
};

export const DOMAIN_LABEL: Record<Domain, string> = {
  health: "Здоровье",
  communication: "Общение и речь",
  education: "Обучение",
  daily_skills: "Бытовые навыки",
  accessibility: "Доступность среды",
  family_support: "Поддержка семьи",
};

export const BLOCKER_LABEL: Record<Blocker, string> = {
  missing_document: "Не хватает документа",
  awaiting_agency: "Ждём ответа ведомства",
  no_service_in_region: "Услуги нет в регионе",
  family_declined: "Семья отказалась",
  decision_disputed: "Не согласны с решением",
};

export const STAGE_LABEL = {
  early: "Раннее вмешательство",
  correction: "Коррекция",
  socialization: "Социализация",
} as const;

export const LANGUAGE_LABEL = { ru: "Русский", kk: "Қазақша" } as const;

export const SOURCE_LABEL: Record<string, string> = {
  llm: "AI (с первой попытки)",
  llm_retry: "AI (со второй попытки)",
  fallback: "Запасной план (AI недоступен или ответ не прошёл проверку)",
  rules: "Правила (демо-режим без ключа OpenAI)",
};

export const AUDIT_LABEL: Record<string, string> = {
  case_created: "Кейс создан",
  plan_confirmed: "План подтверждён",
  handoff_exported: "Передача дела экспортирована",
  summary_confirmed: "Сводка интервью подтверждена",
  red_flag: "Красный флаг в интервью",
};

export function auditLabel(action: string): string {
  if (AUDIT_LABEL[action]) return AUDIT_LABEL[action];
  const [kind, arg] = action.split(":");
  if (kind === "plan_generated") return `План сформирован (${SOURCE_LABEL[arg]?.split(" (")[0] ?? arg})`;
  if (kind === "step_added") return `Добавлен шаг: ${arg}`;
  if (kind === "step_removed") return `Удалён шаг: ${arg}`;
  if (kind === "step_done") return `Выполнен шаг: ${arg}`;
  if (kind === "document_on") return `Документ отмечен: ${arg}`;
  if (kind === "document_off") return `Документ снят: ${arg}`;
  return action;
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

export function daysWord(n: number): string {
  return plural(n, "день", "дня", "дней");
}

export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);
}

export function ageText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} ${plural(m, "месяц", "месяца", "месяцев")}`;
  return `${y} ${plural(y, "год", "года", "лет")}${m ? ` ${m} мес.` : ""}`;
}

export function answerText(a: string | string[] | null): string {
  if (a === null) return "—";
  return Array.isArray(a) ? a.join("; ") : a;
}
