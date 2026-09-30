"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { FaqTab } from "./FaqTab";
import { useApp } from "@/lib/app-context";
import { fmtDate } from "@/lib/format";
import type { AskResult, UrgentKind, UrgentOptions, UrgentResult } from "@/lib/types";

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
  const [tab, setTab] = useState<"urgent" | "faq">("urgent");
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<{ q: string; a: AskResult }[]>([]);
  const [askedCurator, setAskedCurator] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
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
    panel?.querySelector<HTMLElement>("a, button, textarea, input")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), summary")];
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
    setChat([]);
    setQuestion("");
    setAskedCurator(null);
  }, [caseId]);

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const a = await api<AskResult>("parent", `/cases/${caseId}/ask`, { method: "POST", body: { message: q } });
      setChat((c) => [...c, { q, a }].slice(-5));
      setQuestion("");
      if (a.curator_notified) refreshShell();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function askCurator(q: string) {
    setBusy(true);
    setError(null);
    try {
      await api<UrgentResult>("parent", `/cases/${caseId}/urgent`, { method: "POST", body: { kind: "need_help", note: q } });
      setAskedCurator(q);
      refreshShell();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
        {/* AqylRoute symbol, white on the accent background */}
        <svg width="26" height="30" viewBox="0 0 118.9 134.81" aria-hidden fill="currentColor">
          <path d="M39.41,108.75c-4.9-1.48-9.21-3.46-13.67-6.18,1.42,2.43,3.22,4.57,5.25,6.6,4.07,4.06,9.07,6.93,14.61,8.62,11.75,3.58,24.66,2.22,35.38-3.77,5.02-2.81,9.21-6.67,12.72-11.17,4.01-5.14,6.33-11.19,6.81-17.7v-6.83c0-2.3-.58-4.49-1.17-6.71-.97-3.65-2.63-6.93-4.85-9.98-2.52-3.47-5.64-6.28-9.09-8.81-1.25-.92-2.35-2.03-3.01-3.4-1.8-3.75-.2-7.98,3.52-9.7,4.14-1.92,8.48-.77,12.32,1.59,4.58,2.82,8.26,6.66,11.36,11.04,5.65,7.99,8.82,18.1,9.26,27.87.61,13.44-4.46,25.48-13.67,35.09l-3.69,3.57c-2.64,2.55-5.65,4.47-8.82,6.37-9.76,5.87-20.84,9.16-32.24,9.53-6.27.21-12.23-.5-18.26-2.12s-11.39-4.08-16.56-7.31c-6.67-4.17-12.28-9.57-16.64-16.14C1.74,98.29-1.62,84.68.76,71.69c1.11-6.04,3.26-11.71,6.35-17.02,1.95-3.34,4.24-6.28,7-8.97,4.08-3.97,10.55-7.96,16.26-6.94,2.56.46,4.81,1.87,5.92,4.24,1.32,2.81.53,6.07-1.67,8.2l-3.3,2.69c-7.03,5.74-12.56,13.05-12.76,22.46-.07,3.51.58,6.91,2.37,9.94s4.21,5.36,7.14,7.22c8.9,5.65,20.93,6.97,31.12,4.55,6.4-1.52,13.06-4.85,16.72-10.37,1.27-1.92,1.89-4.03,1.86-6.34-.06-3.7-2.21-6.78-5.61-8.25-6.25-2.69-14.24.54-19.27,4.94l-3.54,3.55-2.3,2.72c-2.97,3.52-8.12,4.26-11.71,1.27-3.12-2.59-3.53-6.73-1.93-10.41,2.34-5.42,7.66-9.73,12.97-12.2,6.38-2.98,13.38-4.33,20.44-3.85,7.76.52,15.37,3.81,20.4,9.75,4.11,4.85,5.98,11,5.1,17.33-1.29,9.19-8.72,16.16-16.93,19.87-11.26,5.09-24.01,6.01-36,2.7Z" />
          <circle cx="59.28" cy="21.54" r="21.54" />
        </svg>
      </button>

      {open && (
        <div ref={panelRef} id="urgent-panel" className="urgent-panel" role="dialog" aria-modal="false" aria-labelledby="urgent-title">
          <div className="row between" style={{ alignItems: "center" }}>
            <h2 id="urgent-title" className="urgent-title">
              Помощь
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

          <div className="segmented" style={{ display: "flex" }} role="tablist">
            <button role="tab" aria-selected={tab === "urgent"} className={tab === "urgent" ? "active" : ""} style={{ flex: 1 }}
              onClick={() => setTab("urgent")}>
              Срочно
            </button>
            <button role="tab" aria-selected={tab === "faq"} className={tab === "faq" ? "active" : ""} style={{ flex: 1 }}
              onClick={() => setTab("faq")}>
              Вопросы
            </button>
          </div>

          {tab === "faq" ? (
            <FaqTab caseId={caseId} onNavigate={close} onAskLuna={(q) => {
              setQuestion(q.slice(0, 300));
              questionRef.current?.focus();
              questionRef.current?.scrollIntoView({ block: "nearest" });
            }}>
            <div className="stack-sm" style={{ gap: 10 }}>
              <span className="hint">Луна — помощник по маршруту, не врач. Отвечает только про шаги вашего плана.</span>
              <div className="stack-sm" style={{ gap: 10 }} aria-live="polite">
                {chat.map((m, i) => (
                  <div key={i} className="stack-sm" style={{ gap: 6 }}>
                    <div className="ask-q">{m.q}</div>
                    <div className={`ask-a ${m.a.source === "guard_danger" ? "crit" : ""}`}>
                      <span>{m.a.answer}</span>
                      {m.a.steps.map((s) =>
                        s.step_id ? (
                          <Link key={s.service_id} href={`/parent/cases/${caseId}#step-${s.step_id}`} className="link-btn small" onClick={close}>
                            Шаг: {s.title}
                          </Link>
                        ) : (
                          <span key={s.service_id} className="hint">
                            Услуга: {s.title}
                          </span>
                        ),
                      )}
                      {m.a.curator_notified && <span className="small text-ok">✓ Куратор уведомлён</span>}
                      {m.a.ask_curator && !m.a.curator_notified && (
                        askedCurator === m.q ? (
                          <span className="small text-ok">✓ Вопрос передан куратору</span>
                        ) : (
                          <button className="btn btn-sm" disabled={busy} onClick={() => askCurator(m.q)}>
                            Спросить куратора
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <label className="field">
                <span className="hint">Ваш вопрос (до 300 символов)</span>
                <textarea ref={questionRef} className="input" rows={2} maxLength={300} value={question} disabled={busy}
                  placeholder="Например: какие документы нужны для ПМПК?"
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      ask();
                    }
                  }} />
              </label>
              <button className="btn btn-primary btn-sm" disabled={busy || !question.trim()} onClick={ask}>
                {busy ? "Луна думает…" : "Спросить"}
              </button>
            </div>
            </FaqTab>
          ) : !result ? (
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
          {tab === "urgent" && <span className="hint">Это не замена врача. Ответы на срочные ситуации — готовые тексты, без AI.</span>}
        </div>
      )}
    </>
  );
}
