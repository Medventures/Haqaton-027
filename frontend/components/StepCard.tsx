"use client";

import { useState } from "react";
import { AgencyBadge, BlockerBadge, DomainBadge, PriorityBadge, StepStatusChip } from "./Badges";
import { HelpPanel } from "./HelpPanel";
import { BLOCKER_LABEL, PRIORITY_LABEL, STATUS_LABEL, fmtDate, lockHint } from "@/lib/format";
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
  defaultOpen?: boolean;
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

function dueText(step: Step): { text: string; cls: string } {
  if (step.status === "done") return { text: step.completed_at ? `Выполнено ${fmtDate(step.completed_at)}` : "Выполнено", cls: "text-ok" };
  if (step.status === "locked") return { text: `Срок ${fmtDate(step.due_date)}`, cls: "" };
  if (step.overdue) return { text: `Срок был ${fmtDate(step.due_date)}`, cls: "text-danger" };
  if (step.due_soon) return { text: `До ${fmtDate(step.due_date)}`, cls: "text-warn" };
  return { text: `До ${fmtDate(step.due_date)}`, cls: "" };
}

export function StepCard({ step, role, editable, onPatch, onDelete, onToggleDoc, version, defaultOpen }: Props) {
  const isCurator = role === "curator";
  const locked = step.status === "locked";
  const needsHelp = ["overdue", "escalated", "due_soon"].includes(step.indicator) || (!!step.blocker && step.status !== "done");
  const [open, setOpen] = useState(!!defaultOpen);
  const [showHelp, setShowHelp] = useState(false);
  const [askBlocker, setAskBlocker] = useState(false);
  const [note, setNote] = useState(step.curator_note);
  const [blockerNote, setBlockerNote] = useState(step.blocker_note);
  const [saving, setSaving] = useState(false);

  async function run(fn: () => Promise<void>) {
    setSaving(true);
    try {
      await fn();
    } finally {
      setSaving(false);
    }
  }
  const patch = (p: StepPatch) => onPatch && run(() => onPatch(step.id, p));
  const due = dueText(step);
  const required = step.documents.filter((d) => !d.optional);
  const haveCount = required.filter((d) => d.have).length;

  return (
    <article className={`step ind-${step.indicator}`}>
      <div className="step-top">
        <span className="step-num" aria-hidden>
          {step.status === "done" ? "✓" : locked ? "🔒" : step.position}
        </span>
        <div className="step-main">
          <div className="step-chips">
            <PriorityBadge priority={step.priority} />
            <AgencyBadge agency={step.agency} />
            <DomainBadge domain={step.domain} />
            {step.blocker && step.status !== "done" && <BlockerBadge blocker={step.blocker} />}
          </div>
          <h3 className="step-title">{step.title}</h3>
          <div className="step-sub">
            <span>Ответственный: {step.owner}</span>
            <span className={due.cls} style={{ fontWeight: 500 }}>
              {due.text}
            </span>
            <span>
              Документы: {haveCount} из {required.length}
            </span>
          </div>
          {locked && step.unlock_hint && (
            <div className="note-box lock">
              🔒 {lockHint(step.unlock_hint)}
              {step.unlock_date && !step.unlock_hint.includes(fmtDate(step.unlock_date)) ? ` (с ${fmtDate(step.unlock_date)})` : ""}.
            </div>
          )}
          {step.curator_note && !isCurator && <div className="note-box ok">Куратор: {step.curator_note}</div>}
          {step.blocker && step.blocker_note && step.status !== "done" && <div className="note-box crit">Препятствие: {step.blocker_note}</div>}
        </div>
        <div className="step-side">
          <StepStatusChip step={step} forParent={!isCurator} />
          <div className="row gap-sm">
            {isCurator && editable && onDelete && (
              <button className="icon-btn" title="Удалить шаг из плана" aria-label="Удалить шаг" disabled={saving}
                onClick={() => confirm(`Удалить шаг «${step.title}» из плана?`) && run(() => onDelete(step.id))}>
                ✕
              </button>
            )}
            <button className="link-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Свернуть" : "Подробнее"}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <>
          <div className="step-details">
            <div>
              <span className="detail-label">Почему этот шаг</span>
              <p>{step.explanation}</p>
            </div>
            <div>
              <span className="detail-label">Что сделать</span>
              <p>{step.how_to}</p>
              <span className="hint">
                {step.channel_label} · {step.typical_duration}
              </span>
            </div>
            <div>
              <span className="detail-label">Документы (единая папка)</span>
              <ul className="doc-checks">
                {step.documents.map((d) => (
                  <li key={d.doc_type}>
                    <label className={`doc-check ${d.have ? "have" : ""}`}>
                      <input type="checkbox" checked={d.have} disabled={!onToggleDoc || saving}
                        onChange={(e) => onToggleDoc && run(() => onToggleDoc(d.doc_type, e.target.checked))} />
                      <span>
                        {d.name}
                        {d.optional && <span className="muted"> (если есть)</span>}
                        {d.expired && <span className="pill pill-warn pill-xs">истёк срок</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <span className="hint">Срок: {fmtDate(step.due_date)} — {BASIS_LABEL[step.due_basis]}</span>
            </div>
          </div>

          {editable && !isCurator && (
            <div className="step-actions">
              {step.status !== "done" ? (
                <>
                  <button className="btn btn-primary btn-sm" disabled={saving || locked} onClick={() => patch({ status: "done" })}>
                    Отметить выполненным
                  </button>
                  {step.status === "todo" && (
                    <button className="btn btn-sm" disabled={saving || locked} onClick={() => patch({ status: "in_progress" })}>
                      Начали делать
                    </button>
                  )}
                  <button className="btn btn-sm" disabled={saving} onClick={() => setAskBlocker((v) => !v)}>
                    Не получается
                  </button>
                </>
              ) : (
                <button className="btn btn-sm" disabled={saving} onClick={() => patch({ status: "todo" })}>
                  Снять отметку
                </button>
              )}
            </div>
          )}

          {editable && (isCurator || askBlocker || step.blocker) && (
            <div className="controls-row">
              {isCurator && (
                <>
                  <label className="field-inline">
                    <span className="hint">Статус</span>
                    <select className="input input-sm" value={step.status} disabled={saving || locked}
                      onChange={(e) => patch({ status: e.target.value as StepStatus })}>
                      {locked && <option value="locked">{STATUS_LABEL.locked}</option>}
                      {EDITABLE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-inline">
                    <span className="hint">Приоритет</span>
                    <select className="input input-sm" value={step.priority ?? step.base_priority} disabled={saving}
                      onChange={(e) => patch({ priority: e.target.value as Priority })}>
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
                <span className="hint">Что мешает</span>
                <select className="input input-sm" value={step.blocker ?? ""} disabled={saving}
                  onChange={(e) => patch({ blocker: (e.target.value || null) as Blocker | null })}>
                  <option value="">Ничего</option>
                  {BLOCKERS.map((b) => (
                    <option key={b} value={b}>
                      {BLOCKER_LABEL[b]}
                    </option>
                  ))}
                </select>
              </label>
              {step.blocker && (
                <label className="field-inline grow">
                  <span className="hint">Подробнее</span>
                  <input className="input input-sm" value={blockerNote} placeholder="Коротко опишите препятствие"
                    onChange={(e) => setBlockerNote(e.target.value)}
                    onBlur={() => blockerNote !== step.blocker_note && patch({ blocker_note: blockerNote })}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                </label>
              )}
              {isCurator && (
                <label className="field-inline grow full">
                  <span className="hint">Заметка куратора (видна семье)</span>
                  <input className="input input-sm" value={note} placeholder="Например: записаны на 12.10, кабинет 204"
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => note !== step.curator_note && patch({ curator_note: note })}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                </label>
              )}
            </div>
          )}
        </>
      )}

      {step.status !== "done" && (needsHelp || open) && (
        <div className="step-actions" style={{ marginTop: open ? 0 : -4 }}>
          <button className="link-btn" onClick={() => setShowHelp((v) => !v)}>
            {showHelp ? "Скрыть помощь" : needsHelp ? "Помощь семье: что собрать" : "Что понадобится"}
          </button>
        </div>
      )}
      {showHelp && (
        <div style={{ marginLeft: 46 }}>
          <HelpPanel stepId={step.id} role={role} version={version} />
        </div>
      )}
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
        <span className="hint">Заглушка: реальная отправка в MVP не выполняется.</span>
        <button className="btn btn-sm" onClick={async () => {
          try {
            await navigator.clipboard.writeText(`${n.subject}\n\n${n.body}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}>
          {copied ? "Скопировано" : "Скопировать текст"}
        </button>
      </div>
    </div>
  );
}
