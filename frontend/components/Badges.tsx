import { BLOCKER_LABEL, CASE_STATUS_LABEL, DOMAIN_LABEL, PRIORITY_LABEL, STAGE_LABEL, STATUS_LABEL, daysWord } from "@/lib/format";
import type { Agency, Blocker, CaseStatus, Domain, Indicator, Priority, Stage, StepStatus } from "@/lib/types";

const AGENCY_CLASS: Record<Agency, string> = {
  медицина: "agency-med",
  образование: "agency-edu",
  соцзащита: "agency-soc",
};

export function AgencyBadge({ agency }: { agency: Agency }) {
  return <span className={`badge ${AGENCY_CLASS[agency]}`}>{agency}</span>;
}

export function DomainBadge({ domain }: { domain: Domain }) {
  return <span className="badge domain">{DOMAIN_LABEL[domain]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  return <span className={`badge prio-${priority}`}>Приоритет: {PRIORITY_LABEL[priority].toLowerCase()}</span>;
}

export function StatusBadge({ status }: { status: StepStatus }) {
  return (
    <span className={`badge status-${status}`}>
      {status === "locked" ? "🔒 " : ""}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`badge case-${status}`}>{CASE_STATUS_LABEL[status]}</span>;
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`badge stage stage-${stage}`}>Этап: {STAGE_LABEL[stage]}</span>;
}

export function IndicatorBadge({ indicator, days, daysToDue }: { indicator: Indicator; days: number; daysToDue: number | null }) {
  if (indicator === "escalated") return <span className="badge ind-escalated">Эскалация · просрочено {days} {daysWord(days)}</span>;
  if (indicator === "overdue") return <span className="badge ind-overdue">Просрочено на {days} {daysWord(days)}</span>;
  if (indicator === "due_soon" && daysToDue !== null)
    return (
      <span className="badge ind-due_soon">
        Срочно · {daysToDue === 0 ? "срок сегодня" : `осталось ${daysToDue} ${daysWord(daysToDue)}`}
      </span>
    );
  return null;
}

export function OverdueBadge({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <span className="badge ind-overdue">
      Просрочено на {days} {daysWord(days)}
    </span>
  );
}

export function EscalatedBadge() {
  return <span className="badge ind-escalated">Эскалация</span>;
}

export function BlockerBadge({ blocker }: { blocker: Blocker }) {
  return <span className="badge blocker">⛔ {BLOCKER_LABEL[blocker]}</span>;
}

export function AlertBadge() {
  return <span className="badge ind-escalated">⚠ Красный флаг</span>;
}
