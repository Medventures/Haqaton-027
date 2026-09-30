"use client";

import { useState } from "react";
import { AgencyBadge, BlockerBadge, DomainBadge, IndicatorBadge, PriorityBadge, StatusBadge } from "./Badges";
import { HelpPanel } from "./HelpPanel";
import { BLOCKER_LABEL, PRIORITY_LABEL, STATUS_LABEL, daysWord, fmtDate } from "@/lib/format";
import type { Blocker, Letter, Priority, Role, Step, StepStatus } from "@/lib/types";

export interface StepPatch {
  status?: StepStatus;
  priority?: Priority;
  blocker?: Blocker | null;
  blocker_note?: string;
  curator_note?: string;
}

interface Props {
  step: Step;
  role: Role;
  editable: boolean;
  onPatch?: (id: number, patch: StepPatch) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
  onToggleDoc?: (docType: string, have: boolean) => Promise<void>;
  version?: number;
}

const EDITABLE_STATUSES: Exclude<StepStatus, "locked">[] = ["todo", "in_progress", "done"];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as Priority[];
const BLOCKERS = Object.keys(BLOCKER_LABEL) as Blocker[];
const BASIS_LABEL: Record<Step["due_basis"], string> = {
  default: "срок по справочнику",
  document_expiry: "окончание действия справки",
  age_window: "конец возрастного окна",
  rule: "срок по правилу",
};

export function StepCard({ step, role, editable, onPatch, onDelete, onToggleDoc, version }: Props) {
  const [note, setNote] = useState(step.curator_note);
  const [blockerNote, setBlockerNote] = useState(step.blocker_note);
  const [saving, setSaving] = useState(false);
  const needsHelp = ["overdue", "escalated", "due_soon"].includes(step.indicator) || (!!step.blocker && step.status !== "done");
  const [showHelp, setShowHelp] = useState(needsHelp && role === "curator");
  const isCurator = role === "curator";
  const locked = step.status === "locked";

  async function run(fn: () => Promise<void>) {
    setSaving(true);
    try {
      await fn();
    } finally {
      setSaving(false);
    }
  }
  const patch = (p: StepPatch) => onPatch && run(() => onPatch(step.id, p));

  const haveCount = step.documents.filter((d) => d.have && !d.optional).length;
  const required = step.documents.filter((d) => !d.optional).length;

  return (
    <article className={`step ind-${step.indicator}`}>
      <div className="step-num" aria-hidden>
        {step.status === "done" ? "✓" : locked ? "🔒" : step.position}
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
                onClick={() => confirm(`Удалить шаг «${step.title}» из плана?`) && run(() => onDelete(step.id))}
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
            <IndicatorBadge indicator={step.indicator} days={step.days_overdue} daysToDue={step.days_to_due} />
            {step.blocker && step.status !== "done" && <BlockerBadge blocker={step.blocker} />}
          </div>
        </div>

        {locked && step.unlock_hint && (
          <div className="lock-note">
            🔒 Откроется {step.unlock_hint}
            {step.unlock_date ? ` (с ${fmtDate(step.unlock_date)})` : ""}.
          </div>
        )}

        <p className="step-why">
          <span className="label">Зачем это нужно:</span> {step.explanation}
        </p>

        <dl className="step-meta">
          <div>
            <dt>Кто выполняет</dt>
            <dd>{step.owner}</dd>
          </div>
          <div>
            <dt>Срок</dt>
            <dd className={step.overdue ? "text-danger" : step.due_soon ? "text-warn" : ""}>
              {fmtDate(step.due_date)}
              <span className="muted small"> · {BASIS_LABEL[step.due_basis]}</span>
              {step.status === "done" && step.completed_at && (
                <span className="muted small"> · выполнено {fmtDate(step.completed_at)}</span>
              )}
              {!locked && step.status !== "done" && !step.overdue && step.days_to_due !== null && (
                <span className="muted small">
                  {" "}
                  · {step.days_to_due === 0 ? "сегодня" : `осталось ${step.days_to_due} ${daysWord(step.days_to_due)}`}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Как подать</dt>
            <dd className="small">
              {step.channel_label}. {step.how_to}
            </dd>
          </div>
          <div>
            <dt>Сколько занимает</dt>
            <dd className="small">{step.typical_duration}</dd>
          </div>
          <div className="span-2">
            <dt>
              Документы · есть {haveCount} из {required}{" "}
              <span className="muted">(отметка общая для всех шагов — единая папка)</span>
            </dt>
            <dd>
              <ul className="doc-checks">
                {step.documents.map((d) => (
                  <li key={d.doc_type}>
                    <label className={`doc-check ${d.have ? "have" : ""}`}>
                      <input
                        type="checkbox"
                        checked={d.have}
                        disabled={!onToggleDoc || saving}
                        onChange={(e) => onToggleDoc && run(() => onToggleDoc(d.doc_type, e.target.checked))}
                      />
                      <span>
                        {d.name}
                        {d.optional && <span className="muted"> (если есть)</span>}
                      </span>
                      {d.expired && <span className="pill pill-warn pill-xs">истёк срок</span>}
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

        {step.blocker && step.blocker_note && step.status !== "done" && (
          <div className="blocker-note">
            <b>Препятствие:</b> {step.blocker_note}
          </div>
        )}

        {editable && (
          <div className="step-controls">
            {!isCurator ? (
              <div className="segmented segmented-sm" role="group" aria-label="Статус шага">
                {EDITABLE_STATUSES.map((s) => (
                  <button key={s} className={step.status === s ? "active" : ""} disabled={saving || locked} onClick={() => patch({ status: s })}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <label className="field-inline">
                  <span className="muted small">Статус</span>
                  <select
                    className="input input-sm"
                    value={step.status}
                    disabled={saving || locked}
                    onChange={(e) => patch({ status: e.target.value as StepStatus })}
                  >
                    {locked && <option value="locked">{STATUS_LABEL.locked}</option>}
                    {EDITABLE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-inline">
                  <span className="muted small">Приоритет</span>
                  <select
                    className="input input-sm"
                    value={step.priority ?? step.base_priority}
                    disabled={saving}
                    onChange={(e) => patch({ priority: e.target.value as Priority })}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                        {locked ? " (после открытия)" : ""}
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

        {step.status !== "done" && (
          <div>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowHelp((v) => !v)}>
              {showHelp ? "Скрыть помощь" : needsHelp ? "Помощь семье: что собрать" : "Что понадобится"}
            </button>
            {showHelp && <HelpPanel stepId={step.id} role={role} version={version} />}
          </div>
        )}

        {isCurator && step.notification && !showHelp && (
          <div className="escalation small">
            <b>Эскалация:</b> подготовлен черновик уведомления руководителю — откройте «Помощь семье».
          </div>
        )}
      </div>
    </article>
  );
}

export function LetterDraft({ n }: { n: Letter }) {
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
