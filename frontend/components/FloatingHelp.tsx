"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { fmtDate } from "@/lib/format";
import type { UrgentKind, UrgentOptions, UrgentResult } from "@/lib/types";

const INDICATOR_LABEL: Record<string, string> = {
  overdue: "просрочен",
  due_soon: "скоро срок",
  ok: "в работе",
};

// Numbers are also on the server (urgent_texts.py); they are duplicated here so the call links work even offline.
const FALLBACK_PHONES = [
  { number: "112", label: "Экстренные службы" },
  { number: "103", label: "Скорая помощь" },
];

/** Floating «Срочная помощь» button on parent pages: fixed texts, curator notification, nearest step. No LLM. */
export function FloatingHelp({ caseId }: { caseId: number }) {
  const { refreshShell } = useApp();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<UrgentOptions | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UrgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    fabRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open || opts) return;
    api<UrgentOptions>("parent", "/urgent/options").then(setOpts).catch(() => {});
  }, [open, opts]);

  // Focus stays inside the panel while it is open; Esc closes it.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("a, button, textarea")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), textarea:not(:disabled)")];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, result, close]);

  useEffect(() => {
    setResult(null);
    setNote("");
    setError(null);
  }, [caseId]);

  async function send(kind: UrgentKind) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<UrgentResult>("parent", `/cases/${caseId}/urgent`, {
        method: "POST",
        body: { kind, note: note.trim() || null },
      });
      setResult(r);
      setNote("");
      refreshShell();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const phones = opts?.phones ?? FALLBACK_PHONES;

  return (
    <>
      <button ref={fabRef} className="fab-help" aria-label="Срочная помощь" aria-expanded={open} aria-controls="urgent-panel"
        onClick={() => (open ? close() : setOpen(true))}>
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v10" />
          <circle cx="12" cy="19" r="0.6" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div ref={panelRef} id="urgent-panel" className="urgent-panel" role="dialog" aria-modal="false" aria-labelledby="urgent-title">
          <div className="row between" style={{ alignItems: "center" }}>
            <h2 id="urgent-title" className="urgent-title">
              Срочная помощь
            </h2>
            <button className="icon-btn" aria-label="Закрыть" onClick={close}>
              ✕
            </button>
          </div>

          <div className="urgent-sos">
            <p>{opts?.top_text ?? "Если ребёнок или кто-то рядом в опасности, звоните 112. Скорая помощь: 103."}</p>
            <div className="urgent-phones">
              {phones.map((p) => (
                <a key={p.number} className="urgent-phone" href={`tel:${p.number}`}>
                  <b className="no-translate">{p.number}</b>
                  <span>{p.label}</span>
                </a>
              ))}
            </div>
          </div>

          {!result ? (
            <>
              <span className="urgent-label">Что случилось?</span>
              <label className="field">
                <span className="hint">Коротко, если хотите (до {opts?.note_max ?? 200} символов)</span>
                <textarea className="input" rows={2} maxLength={opts?.note_max ?? 200} value={note} disabled={busy}
                  onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="urgent-kinds">
                {(opts?.kinds ?? []).map((k) => (
                  <button key={k.kind} className="btn urgent-kind" disabled={busy} onClick={() => send(k.kind)}>
                    {k.label}
                  </button>
                ))}
                {!opts && <span className="hint">Загрузка…</span>}
              </div>
            </>
          ) : (
            <div className="stack-sm" style={{ gap: 12 }} aria-live="polite">
              <p className="urgent-text">{result.text}</p>
              {result.curator_notified && <div className="note-box ok">✓ Куратор уведомлён</div>}
              {result.nearest_step && (
                <div className="urgent-step">
                  <span className="hint">Ближайший шаг плана</span>
                  <b>{result.nearest_step.title}</b>
                  <span className={`small ${result.nearest_step.indicator === "overdue" ? "text-danger" : ""}`}>
                    Срок {fmtDate(result.nearest_step.due_date)}
                    {INDICATOR_LABEL[result.nearest_step.indicator] ? ` · ${INDICATOR_LABEL[result.nearest_step.indicator]}` : ""}
                  </span>
                  <Link href={`/parent/cases/${caseId}#step-${result.nearest_step.id}`} className="link-btn" onClick={close}>
                    Открыть шаг
                  </Link>
                </div>
              )}
              <button className="btn btn-sm" onClick={() => setResult(null)}>
                Другая ситуация
              </button>
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
          <span className="hint">Это не замена врача. Ответы в этой панели — готовые тексты, без AI.</span>
        </div>
      )}
    </>
  );
}
