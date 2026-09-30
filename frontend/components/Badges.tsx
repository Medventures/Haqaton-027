import { BLOCKER_LABEL, CASE_STATUS_LABEL, DOMAIN_LABEL, STAGE_LABEL, daysWord, overdueLabel } from "@/lib/format";
import type { Agency, Blocker, CaseStatus, Domain, Priority, Stage, Step } from "@/lib/types";

export type Tone = "ok" | "warn" | "crit" | "info" | "muted" | "accent" | "urgent";

export function Chip({ tone = "muted", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={`chip-s tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

const PRIO: Record<Priority, [string, Tone]> = {
  high: ["Высокий", "warn"],
  medium: ["Средний", "info"],
  low: ["Плановый", "muted"],
};

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  return <Chip tone={PRIO[priority][1]}>{PRIO[priority][0]}</Chip>;
}

export function AgencyBadge({ agency }: { agency: Agency }) {
  return <span className="step-agency">{agency[0].toUpperCase() + agency.slice(1)}</span>;
}

export function DomainBadge({ domain }: { domain: Domain }) {
  return <Chip tone="accent">{DOMAIN_LABEL[domain]}</Chip>;
}

/** Статус шага по индикатору, как в прототипе: выполнено / срочно / просрочено / заблокирован. */
export function StepStatusChip({ step, forParent }: { step: Step; forParent?: boolean }) {
  const d = step.days_overdue;
  switch (step.indicator) {
    case "done":
      return <Chip tone="ok">Выполнено</Chip>;
    case "locked":
      return <Chip tone="muted">🔒 Заблокирован</Chip>;
    case "escalated":
      return forParent ? (
        <Chip tone="crit">
          Просрочено · {overdueLabel(d)}
        </Chip>
      ) : (
        <Chip tone="urgent">
          Эскалация · {overdueLabel(d)}
        </Chip>
      );
    case "overdue":
      return (
        <Chip tone="crit">
          Просрочено · {overdueLabel(d)}
        </Chip>
      );
    case "due_soon":
      return (
        <Chip tone="warn">
          Срочно · {step.days_to_due === 0 ? "сегодня" : `${step.days_to_due} ${daysWord(step.days_to_due ?? 0)}`}
        </Chip>
      );
    default:
      return step.status === "in_progress" ? <Chip tone="info">В работе</Chip> : <Chip tone="muted">Не начат</Chip>;
  }
}

const CASE_TONE: Record<CaseStatus, Tone> = { draft: "muted", awaiting_curator: "warn", confirmed: "ok" };

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return <Chip tone={CASE_TONE[status]}>{CASE_STATUS_LABEL[status]}</Chip>;
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <Chip tone="accent">Этап: {STAGE_LABEL[stage]}</Chip>;
}

export function EscalatedBadge() {
  return <Chip tone="urgent">Эскалация</Chip>;
}

export function BlockerBadge({ blocker }: { blocker: Blocker }) {
  return <Chip tone="warn">⛔ {BLOCKER_LABEL[blocker]}</Chip>;
}

export function AlertBadge() {
  return <Chip tone="urgent">⚠ Красный флаг</Chip>;
}
