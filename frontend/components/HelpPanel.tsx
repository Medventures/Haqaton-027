"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { Help, Role } from "@/lib/types";
import { LetterDraft } from "./StepCard";
import { Ico } from "./Icons";

/** «Помощь семье»: чек-лист недостающих документов, что сделать, блокеры и шаблон сообщения (всё собирает код). */
export function HelpPanel({ stepId, role, version }: { stepId: number; role: Role; version?: number }) {
  const [help, setHelp] = useState<Help | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<Help>(role, `/steps/${stepId}/help`)
      .then(setHelp)
      .catch((e) => setError((e as Error).message));
  }, [stepId, role, version]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!help) return <div className="muted small">Загрузка…</div>;

  return (
    <div className="help-panel">
      <div className="help-head">
        <b>Помощь семье</b>
        <span className="muted small">
          {help.days_overdue > 0
            ? `срок прошёл ${fmtDate(help.due_date)}`
            : help.days_to_due !== null
              ? `срок до ${fmtDate(help.due_date)}`
              : ""}
        </span>
      </div>
      <div className="help-grid">
        <div>
          <div className="help-label">Что сделать</div>
          <p className="small">{help.what_to_do}</p>
          <div className="muted small">
            Канал: {help.channel} · {help.typical_duration}
          </div>
        </div>
        <div>
          <div className="help-label">Не хватает документов ({help.checklist.length})</div>
          {help.checklist.length === 0 ? (
            <p className="small">Все обязательные документы на месте.</p>
          ) : (
            <ul className="checklist">
              {help.checklist.map((d) => (
                <li key={d.doc_type}>
                  <Ico name="circle" size={12} /> {d.name}
                  {d.expired && <span className="pill pill-warn pill-xs">истёк срок</span>}
                  {d.note && <div className="muted small">{d.note}</div>}
                </li>
              ))}
              {help.notes.map((n) => (
                <li key={n} className="muted">
                  <Ico name="bullet" size={12} /> {n}
                </li>
              ))}
            </ul>
          )}
          {help.have.length > 0 && (
            <div className="muted small mt-xs">Уже есть: {help.have.map((d) => d.name).join(", ")}</div>
          )}
        </div>
      </div>
      {help.blocker && (
        <div className="note-box crit">
          <b>Препятствие:</b> {help.blocker.label}
          {help.blocker.note ? ` — ${help.blocker.note}` : ""}
        </div>
      )}
      {help.dispute_hint && <div className="note-box">{help.dispute_hint}</div>}
      {role === "curator" && (
        <div className="help-message">
          <div className="row between wrap gap-sm">
            <span className="help-label">Сообщение семье (шаблон)</span>
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(help.family_message);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {}
              }}
            >
              {copied ? "Скопировано" : "Скопировать"}
            </button>
          </div>
          <p className="small">{help.family_message}</p>
        </div>
      )}
      {role === "curator" && help.agency_letter && <LetterDraft n={help.agency_letter} />}
    </div>
  );
}
