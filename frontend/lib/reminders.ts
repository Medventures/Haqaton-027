import { daysWord, fmtDate, lockHint, overdueLabel } from "./format";
import type { CaseView } from "./types";

export interface Reminder {
  key: string;
  tone: "crit" | "warn" | "info" | "ok" | "muted";
  tag: string;
  text: string;
  meta: string;
  stepId?: number;
}

/** Напоминания семьи: считаются из шагов плана и уведомлений (всё уже посчитано сервером). */
export function remindersFor(c: CaseView): Reminder[] {
  const out: Reminder[] = [];
  if (c.alert)
    out.push({
      key: "red-flag",
      tone: "crit",
      tag: "Срочно",
      text: c.red_flag_text ?? "Рекомендуем как можно скорее обратиться к врачу.",
      meta: "Вы сообщили о срочной ситуации или отметили изменения в интервью. Куратор получил отметку «срочно».",
    });
  for (const s of c.steps) {
    if (s.overdue)
      out.push({
        key: `o${s.id}`,
        tone: "crit",
        tag: `Просрочено · ${overdueLabel(s.days_overdue)}`,
        text: s.title,
        meta: `Срок был ${fmtDate(s.due_date)}. Не хватает документов: ${s.docs_missing}. Куратор уже видит этот шаг.`,
        stepId: s.id,
      });
  }
  for (const s of c.steps) {
    if (s.due_soon) {
      const n = c.notifications.find((x) => x.step_id === s.id && x.type === "due_soon");
      out.push({
        key: `s${s.id}`,
        tone: "warn",
        tag: `Срочно · ${s.days_to_due} ${daysWord(s.days_to_due ?? 0)}`,
        text: n?.message ?? `Скоро срок: ${s.title}`,
        meta: `До ${fmtDate(s.due_date)}. Не хватает документов: ${s.docs_missing}.`,
        stepId: s.id,
      });
    }
  }
  for (const s of c.steps) {
    if (s.status === "locked")
      out.push({
        key: `l${s.id}`,
        tone: "muted",
        tag: "Предстоящий шаг",
        text: s.title,
        meta: s.unlock_hint ? `${lockHint(s.unlock_hint)}.` : "Откроется после предыдущих шагов.",
        stepId: s.id,
      });
  }
  return out;
}
