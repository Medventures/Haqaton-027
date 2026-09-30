"use client";

import { useState } from "react";
import {
  AgencyBadge,
  BlockerBadge,
  DomainBadge,
  EscalatedBadge,
  OverdueBadge,
  PriorityBadge,
  StatusBadge,
} from "./Badges";
import { BLOCKER_LABEL, PRIORITY_LABEL, STATUS_LABEL, daysUntil, daysWord, fmtDate } from "@/lib/format";
import type { Blocker, Doc, Priority, Role, Step, StepStatus } from "@/lib/types";

export interface StepPatch {
  status?: StepStatus;
  priority?: Priority;
  blocker?: Blocker | null;
  blocker_note?: string;
  curator_note?: string;
  documents?: Doc[];
}

interface Props {
  step: Step;
  role: Role;
  today: string;
  editable: boolean;
  onPatch?: (id: number, patch: StepPatch) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}

const STATUSES = Object.keys(STATUS_LABEL) as StepStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as Priority[];
const BLOCKERS = Object.keys(BLOCKER_LABEL) as Blocker[];

export function StepCard({ step, role, today, editable, onPatch, onDelete }: Props) {
  const [note, setNote] = useState(step.curator_note);
  const [blockerNote, setBlockerNote] = useState(step.blocker_note);
  const [saving, setSaving] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const left = daysUntil(step.due_date, today);
  const isCurator = role === "curator";

  async function patch(p: StepPatch) {
    if (!onPatch) return;
    setSaving(true);
    try {
      await onPatch(step.id, p);
    } finally {
      setSaving(false);
    }
  }

  const cls = [
    "step",
    step.status === "done" ? "step-done" : "",
    step.overdue ? "step-overdue" : "",
    step.blocker && step.status !== "done" ? "step-blocked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const haveCount = step.documents.filter((d) => d.have).length;

  return (
    <article className={cls}>
      <div className="step-num" aria-hidden>
        {step.status === "done" ? "✓" : step.position}
      </div>
      <div className="step-body">
        <div className="step-head">
          <div className="row between gap-sm">
            <h3 className="step-title">{step.title}</h3>
            {isCurator && editable && onDelete && (
              <button
                className="icon-btn"
                title="Удалить шаг из плана"
                aria-label="Удалить шаг"
                disabled={saving}
                onClick={() => confirm(`Удалить шаг «${step.title}» из плана?`) && onDelete(step.id)}
              >
                ✕
              </button>
            )}
          </div>
          <div className="row gap-xs wrap">
            <AgencyBadge agency={step.agency} />
            <DomainBadge domain={step.domain} />
            <PriorityBadge priority={step.priority} />
            <StatusBadge status={step.status} />
            <OverdueBadge days={step.days_overdue} />
            {isCurator && step.escalated && <EscalatedBadge />}
            {step.blocker && step.status !== "done" && <BlockerBadge blocker={step.blocker} />}
          </div>
        </div>

        <p className="step-why">
          <span className="label">Зачем это нужно:</span> {step.explanation}
        </p>

        {step.blocker && step.blocker_note && step.status !== "done" && (
          <div className="blocker-note">
            <b>Препятствие:</b> {step.blocker_note}
          </div>
        )}

        <dl className="step-meta">
          <div>
            <dt>Ответственный</dt>
            <dd>{step.owner}</dd>
          </div>
          <div>
            <dt>Срок</dt>
            <dd className={step.overdue ? "text-danger" : ""}>
              {fmtDate(step.due_date)}
              {step.status === "done" && step.completed_at && (
                <span className="muted small"> · выполнено {fmtDate(step.completed_at)}</span>
              )}
              {step.status !== "done" && !step.overdue && (
                <span className="muted small"> · {left === 0 ? "сегодня" : `осталось ${left} ${daysWord(left)}`}</span>
              )}
            </dd>
          </div>
          <div className="span-2">
            <dt>
              Документы · есть {haveCount} из {step.documents.length}
            </dt>
            <dd>
              <ul className="doc-checks">
                {step.documents.map((d) => (
                  <li key={d.name}>
                    <label className={`doc-check ${d.have ? "have" : ""}`}>
                      <input
                        type="checkbox"
                        checked={d.have}
                        disabled={!editable || saving}
                        onChange={(e) => patch({ documents: [{ name: d.name, have: e.target.checked }] })}
                      />
                      <span>{d.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>

        {!isCurator && step.curator_note && (
          <div className="note">
            <span className="label">Комментарий куратора:</span> {step.curator_note}
          </div>
        )}

        {editable && (
          <div className="step-controls">
            {!isCurator ? (
              <div className="segmented segmented-sm" role="group" aria-label="Статус шага">
                {STATUSES.map((s) => (
                  <button key={s} className={step.status === s ? "active" : ""} disabled={saving} onClick={() => patch({ status: s })}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <label className="field-inline">
                  <span className="muted small">Статус</span>
                  <select className="input input-sm" value={step.status} disabled={saving} onChange={(e) => patch({ status: e.target.value as StepStatus })}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-inline">
                  <span className="muted small">Приоритет</span>
                  <select className="input input-sm" value={step.priority} disabled={saving} onChange={(e) => patch({ priority: e.target.value as Priority })}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label className="field-inline">
              <span className="muted small">Препятствие</span>
              <select
                className="input input-sm"
                value={step.blocker ?? ""}
                disabled={saving}
                onChange={(e) => patch({ blocker: (e.target.value || null) as Blocker | null })}
              >
                <option value="">Нет</option>
                {BLOCKERS.map((b) => (
                  <option key={b} value={b}>
                    {BLOCKER_LABEL[b]}
                  </option>
                ))}
              </select>
            </label>
            {step.blocker && (
              <label className="field-inline grow">
                <span className="muted small">Что мешает</span>
                <input
                  className="input input-sm"
                  value={blockerNote}
                  placeholder="Коротко опишите препятствие"
                  onChange={(e) => setBlockerNote(e.target.value)}
                  onBlur={() => blockerNote !== step.blocker_note && patch({ blocker_note: blockerNote })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              </label>
            )}
            {isCurator && (
              <label className="field-inline grow full">
                <span className="muted small">Заметка куратора (видна семье)</span>
                <input
                  className="input input-sm"
                  value={note}
                  placeholder="Например: записаны на 12.10, кабинет 204"
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => note !== step.curator_note && patch({ curator_note: note })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              </label>
            )}
          </div>
        )}

        {isCurator && step.notification && (
          <div className="escalation">
            <div className="row between wrap gap-sm">
              <span>
                <b>Эскалация:</b> просрочка больше порога. Подготовлен черновик уведомления руководителю.
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowNotice((v) => !v)}>
                {showNotice ? "Скрыть" : "Показать черновик"}
              </button>
            </div>
            {showNotice && <NotificationDraft n={step.notification} />}
          </div>
        )}
      </div>
    </article>
  );
}

export function NotificationDraft({ n }: { n: NonNullable<Step["notification"]> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="notice">
      <div className="small">
        <b>Кому:</b> {n.to}
      </div>
      <div className="small">
        <b>Тема:</b> {n.subject}
      </div>
      <pre className="notice-body">{n.body}</pre>
      <div className="row between wrap gap-sm">
        <span className="muted small">Заглушка: реальная отправка в MVP не выполняется.</span>
        <button
          className="btn btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${n.subject}\n\n${n.body}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? "Скопировано" : "Скопировать текст"}
        </button>
      </div>
    </div>
  );
}
