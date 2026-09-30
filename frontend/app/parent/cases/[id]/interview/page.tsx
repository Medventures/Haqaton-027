"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { StageBadge } from "@/components/Badges";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { answerText } from "@/lib/format";
import type { CaseView, InterviewItem, NextResponse, Progress, Summary, SummaryLine } from "@/lib/types";

type Phase = "loading" | "question" | "summary" | "generating" | "finished" | "error";

function SummaryEditor({ summary, onConfirm, busy }: { summary: Summary; onConfirm: (c: Record<string, string | string[]>) => void; busy: boolean }) {
  const [edits, setEdits] = useState<Record<string, string | string[]>>({});
  const [editing, setEditing] = useState<string | null>(null);

  function renderEditor(line: SummaryLine) {
    const cur = edits[line.slot] ?? line.raw;
    if (line.type === "choice")
      return (
        <div className="chips">
          {line.options.map((o) => (
            <button key={o} className={`chip ${cur === o ? "on" : ""}`} onClick={() => setEdits({ ...edits, [line.slot]: o })}>
              {o}
            </button>
          ))}
        </div>
      );
    if (line.type === "multi") {
      const arr = Array.isArray(cur) ? cur : [cur];
      return (
        <div className="chips">
          {line.options.map((o) => {
            const on = arr.includes(o);
            return (
              <button key={o} className={`chip ${on ? "on" : ""}`}
                onClick={() => setEdits({ ...edits, [line.slot]: on ? arr.filter((x) => x !== o) : [...arr, o] })}>
                {on ? "✓ " : "+ "}
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <textarea className="input" rows={2} value={String(cur)} onChange={(e) => setEdits({ ...edits, [line.slot]: e.target.value })} />
    );
  }

  return (
    <div className="summary-card">
      <p className="small">Проверьте, правильно ли я понял. Если что-то не так — нажмите «Поправить».</p>
      <dl className="summary-list">
        {summary.lines.map((line) => (
          <div key={line.slot} className="summary-row">
            <dt>{line.label}</dt>
            <dd>
              {editing === line.slot ? renderEditor(line) : answerText(edits[line.slot] ?? line.value)}
              {edits[line.slot] !== undefined && editing !== line.slot && <span className="pill pill-muted pill-xs">исправлено</span>}
            </dd>
            <button className="link-btn small" onClick={() => setEditing(editing === line.slot ? null : line.slot)}>
              {editing === line.slot ? "Готово" : "Поправить"}
            </button>
          </div>
        ))}
      </dl>
      {summary.red_flags.length > 0 && (
        <div className="alert alert-error small">Рекомендуем как можно скорее обратиться к врачу. Куратор получит уведомление.</div>
      )}
      <button className="btn btn-primary" disabled={busy} onClick={() => onConfirm(edits)}>
        {busy ? "Сохраняем…" : "Да, всё верно"}
      </button>
    </div>
  );
}

export default function InterviewPage() {
  const { id } = useParams<{ id: string }>();
  const { settings, ready, rememberCase, role, setRole } = useApp();
  const [caseInfo, setCaseInfo] = useState<CaseView | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [item, setItem] = useState<InterviewItem | null>(null);
  const [items, setItems] = useState<InterviewItem[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [single, setSingle] = useState<string | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);

  const finish = useCallback(
    async (status: string) => {
      setPhase("generating");
      try {
        if (status === "draft") await api<CaseView>("parent", `/cases/${id}/plan/generate`, { method: "POST", body: {} });
        setPhase("finished");
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      }
    },
    [id],
  );

  const handle = useCallback(
    async (r: NextResponse, status: string) => {
      setItems(r.interview.items);
      setProgress(r.progress);
      if (r.done) {
        setItem(null);
        await finish(status);
        return;
      }
      if (r.item) {
        setItem(r.item);
        setSingle(null);
        setMulti([]);
        setCustom("");
        if (r.item.type === "confirm" && r.summary) {
          setSummary(r.summary);
          setPhase("summary");
        } else setPhase("question");
      }
    },
    [finish],
  );

  useEffect(() => {
    if (!ready) return;
    rememberCase(Number(id));
    (async () => {
      try {
        const c = await api<CaseView>("parent", `/cases/${id}`);
        setCaseInfo(c);
        if (c.summary_confirmed) {
          await finish(c.status);
          return;
        }
        const r = await api<NextResponse>("parent", `/cases/${id}/interview/next`, { method: "POST", body: {} });
        await handle(r, c.status);
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      }
    })();
  }, [id, ready, handle, finish, rememberCase]);

  useEffect(() => {
    // Прокручиваем только ленту чата: к началу сводки или к последнему сообщению.
    const chat = chatRef.current;
    if (!chat) return;
    const target = phase === "summary" ? summaryRef.current : bottomRef.current;
    if (target) chat.scrollTop = target.offsetTop - (phase === "summary" ? 8 : chat.clientHeight - 40);
    else chat.scrollTop = chat.scrollHeight;
  }, [item, phase, items.length]);

  function buildAnswer(): string | string[] | null {
    if (!item) return null;
    const extra = custom.trim();
    if (item.type === "text") return extra || null;
    if (item.type === "multi") {
      const vals = [...multi, ...(extra ? [extra] : [])];
      return vals.length ? vals : null;
    }
    return extra || single;
  }

  async function submit() {
    const answer = buildAnswer();
    if (answer === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<NextResponse>("parent", `/cases/${id}/interview/next`, { method: "POST", body: { answer } });
      await handle(r, caseInfo?.status ?? "draft");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function autofill() {
    setBusy(true);
    try {
      const r = await api<NextResponse>("parent", `/cases/${id}/interview/autofill`, { method: "POST" });
      await handle(r, caseInfo?.status ?? "draft");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmSummary(corrections: Record<string, string | string[]>) {
    setBusy(true);
    try {
      await api("parent", `/cases/${id}/interview/confirm`, {
        method: "POST",
        body: { corrections: Object.keys(corrections).length ? corrections : null },
      });
      await finish(caseInfo?.status ?? "draft");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const answered = items.filter((i) => i.answer !== null && i.qid !== "12");
  const total = progress?.expected_total ?? 12;
  const current = item ? item.n : answered.length;

  return (
    <div className="interview-layout single">
      <div className="stack">
        <div>
          <Link href="/parent" className="muted small">
            ← Кабинет родителя
          </Link>
          <h1 className="h-page">
            Интервью {caseInfo ? `· ${caseInfo.child_alias}` : ""} {caseInfo && <StageBadge stage={caseInfo.stage} />}
          </h1>
          {caseInfo && (
            <p className="muted small">
              {caseInfo.age_text}, {caseInfo.city}. Отвечайте своими словами — здесь нет правильных и неправильных ответов.
            </p>
          )}
        </div>

        <div className="card chat-card">
          <div className="chat-progress">
            <div className="progress-head">
              <span>
                Вопрос <b>{Math.min(Math.max(current, 1), total)}</b> из {total}
              </span>
              <span className="muted small">вопросы подбираются под вашу ситуацию (8–12)</span>
            </div>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${(Math.min(current, total) / total) * 100}%` }} />
            </div>
          </div>

          <div className="chat" ref={chatRef}>
            <div className="bubble bot">
              Здравствуйте! Анкету вы уже заполнили. Теперь несколько вопросов о том, что уже получается и что мешает. Диагнозы я
              не ставлю и ребёнка не оцениваю.
            </div>
            {answered.map((i) => (
              <div key={i.n} className="chat-pair">
                <div className="bubble bot">
                  {i.text}
                  {i.source === "llm" && <span className="pill pill-ai pill-xs">AI</span>}
                </div>
                <div className="bubble me">
                  {answerText(i.answer)}
                  {i.autofilled && <span className="pill pill-muted pill-xs">демо</span>}
                </div>
              </div>
            ))}
            {phase === "question" && item && (
              <div className="bubble bot current">
                {item.text}
                {item.source === "llm" && <span className="pill pill-ai pill-xs">AI</span>}
              </div>
            )}
            {phase === "summary" && summary && (
              <div className="bubble bot current wide" ref={summaryRef}>
                <b>{item?.text}</b>
                <SummaryEditor summary={summary} onConfirm={confirmSummary} busy={busy} />
              </div>
            )}
            {phase === "loading" && <div className="bubble bot muted">…</div>}
            {busy && phase === "question" && <div className="bubble bot typing">Подбираю следующий вопрос…</div>}
            {phase === "generating" && (
              <div className="bubble bot">
                <span className="spinner spinner-sm" aria-hidden /> Спасибо! Собираю черновик маршрута из справочника услуг…
              </div>
            )}
            {phase === "finished" && (
              <div className="bubble bot">
                <b>Готово.</b> Черновик маршрута отправлен куратору. Вы увидите план, как только он будет проверен и подтверждён.
                <div className="mt-sm row gap-sm wrap">
                  <Link className="btn btn-primary btn-sm" href={`/parent/cases/${id}`}>
                    Мой маршрут
                  </Link>
                  <Link className="btn btn-sm" href={`/parent/cases/${id}/documents`}>
                    Моя папка документов
                  </Link>
                </div>
              </div>
            )}
            {phase === "error" && <div className="alert alert-error">{error}</div>}
            <div ref={bottomRef} />
          </div>

          {phase === "question" && item && (
            <div className="composer">
              {item.type !== "text" && (
                <div className="chips">
                  {item.options.map((o) => {
                    const on = item.type === "choice" ? single === o : multi.includes(o);
                    return (
                      <button key={o} className={`chip ${on ? "on" : ""}`} disabled={busy}
                        onClick={() => {
                          if (item.type === "choice") {
                            setSingle(o);
                            setCustom("");
                          } else setMulti((m) => (m.includes(o) ? m.filter((x) => x !== o) : [...m, o]));
                        }}>
                        {item.type === "multi" && (on ? "✓ " : "+ ")}
                        {o}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="composer-row">
                <textarea className="input" rows={item.type === "text" ? 2 : 1} disabled={busy} value={custom}
                  placeholder={item.type === "text" ? "Напишите своими словами" : "Или свой вариант"}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    if (item.type === "choice" && e.target.value) setSingle(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }} />
                <button className="btn btn-primary" onClick={submit} disabled={busy || buildAnswer() === null}>
                  Ответить
                </button>
              </div>
              {error && <div className="alert alert-error">{error}</div>}
              {caseInfo?.scenario && settings?.demo_mode && (
                <button className="btn btn-ghost btn-sm self-start" onClick={autofill} disabled={busy}
                  title="Оставшиеся ответы берутся из синтетического кейса">
                  Заполнить демо-ответами
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
