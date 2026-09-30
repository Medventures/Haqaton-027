"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { answerText } from "@/lib/format";
import type { CaseView, InterviewState, NextResponse, Question } from "@/lib/types";

type Phase = "loading" | "question" | "generating" | "finished" | "error";

export default function InterviewPage() {
  const { id } = useParams<{ id: string }>();
  const { settings, ready, rememberCase, role, setRole } = useApp();

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);
  const [caseInfo, setCaseInfo] = useState<CaseView | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [question, setQuestion] = useState<Question | null>(null);
  const [state, setState] = useState<InterviewState | null>(null);
  const [single, setSingle] = useState<string | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      setState(r.interview);
      if (r.done) {
        setQuestion(null);
        await finish(status);
      } else if (r.item) {
        setQuestion(r.item);
        setSingle(null);
        setMulti([]);
        setCustom("");
        setPhase("question");
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
        const r = await api<NextResponse>("parent", `/cases/${id}/interview/next`, { method: "POST", body: {} });
        await handle(r, c.status);
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      }
    })();
  }, [id, ready, handle, rememberCase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [question, phase, state?.items.length]);

  function buildAnswer(): string | string[] | null {
    if (!question) return null;
    const extra = custom.trim();
    if (question.type === "text") return extra || null;
    if (question.type === "multi") {
      const vals = [...multi, ...(extra ? [extra] : [])];
      return vals.length ? vals : null;
    }
    return extra || single;
  }

  async function submit(override?: string) {
    const answer = override ?? buildAnswer();
    if (answer === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api<NextResponse>("parent", `/cases/${id}/interview/next`, { method: "POST", body: { answer } });
      await handle(r, caseInfo?.status ?? "draft");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function autofill() {
    setSubmitting(true);
    try {
      const r = await api<NextResponse>("parent", `/cases/${id}/interview/autofill`, { method: "POST" });
      await handle(r, caseInfo?.status ?? "draft");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const max = state?.max_questions ?? 12;
  const min = state?.min_questions ?? 8;
  const answered = state?.items.filter((i) => i.answer !== null) ?? [];
  const current = question ? question.n : answered.length;
  const topics = settings?.topics ?? [];

  return (
    <div className="interview-layout">
      <div className="stack">
        <div>
          <Link href="/parent" className="muted small">
            ← Кабинет родителя
          </Link>
          <h1 className="h-page">Интервью {caseInfo ? `· ${caseInfo.child_alias}` : ""}</h1>
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
                Вопрос <b>{Math.min(Math.max(current, 1), max)}</b> из {max}
              </span>
              <span className="muted small">минимум {min}</span>
            </div>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${(Math.min(current, max) / max) * 100}%` }} />
              <div className="progress-min" style={{ left: `${(min / max) * 100}%` }} />
            </div>
          </div>

          <div className="chat">
            <div className="bubble bot">
              Здравствуйте! Я задам несколько вопросов, чтобы собрать для вашей семьи единый маршрут помощи. Диагнозы я не
              ставлю и ребёнка не оцениваю.
            </div>
            {answered.map((i) => (
              <div key={i.n} className="chat-pair">
                <div className="bubble bot">
                  {i.question}
                  {i.source === "llm" && <span className="pill pill-ai pill-xs">AI</span>}
                </div>
                <div className="bubble me">
                  {answerText(i.answer)}
                  {i.autofilled && <span className="pill pill-muted pill-xs">демо</span>}
                </div>
              </div>
            ))}
            {phase === "question" && question && (
              <div className="bubble bot current">
                <div className="q-topic">{question.topic_label ?? question.topic}</div>
                {question.question}
                {question.source === "llm" && <span className="pill pill-ai pill-xs">AI</span>}
              </div>
            )}
            {phase === "loading" && <div className="bubble bot muted">…</div>}
            {submitting && phase === "question" && <div className="bubble bot typing">AI подбирает следующий вопрос…</div>}
            {phase === "generating" && (
              <div className="bubble bot">
                <span className="spinner spinner-sm" aria-hidden /> Спасибо! Составляю черновик маршрута из справочника услуг…
              </div>
            )}
            {phase === "finished" && (
              <div className="bubble bot">
                <b>Готово.</b> Черновик маршрута отправлен куратору. Вы увидите план, как только он будет проверен и
                подтверждён.
                <div className="mt-sm">
                  <Link className="btn btn-primary btn-sm" href={`/parent/cases/${id}`}>
                    Перейти к моему маршруту
                  </Link>
                </div>
              </div>
            )}
            {phase === "error" && <div className="alert alert-error">{error}</div>}
            <div ref={bottomRef} />
          </div>

          {phase === "question" && question && (
            <div className="composer">
              {question.type !== "text" && (
                <div className="chips">
                  {question.options.map((o) => {
                    const on = question.type === "single" ? single === o : multi.includes(o);
                    return (
                      <button
                        key={o}
                        className={`chip ${on ? "on" : ""}`}
                        disabled={submitting}
                        onClick={() => {
                          if (question.type === "single") {
                            setSingle(o);
                            setCustom("");
                          } else setMulti((m) => (m.includes(o) ? m.filter((x) => x !== o) : [...m, o]));
                        }}
                      >
                        {question.type === "multi" && (on ? "✓ " : "+ ")}
                        {o}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="composer-row">
                <textarea
                  className="input"
                  rows={question.type === "text" ? 2 : 1}
                  placeholder={question.type === "text" ? "Напишите своими словами" : "Или свой вариант"}
                  value={custom}
                  disabled={submitting}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    if (question.type === "single" && e.target.value) setSingle(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <button className="btn btn-primary" onClick={() => submit()} disabled={submitting || buildAnswer() === null}>
                  Ответить
                </button>
              </div>
              {error && <div className="alert alert-error">{error}</div>}
              {caseInfo?.scenario && settings?.demo_mode && (
                <button className="btn btn-ghost btn-sm self-start" onClick={autofill} disabled={submitting} title="Оставшиеся ответы берутся из синтетического сценария">
                  Заполнить демо-ответами
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <aside className="stack">
        {topics.length > 0 && (
          <div className="card card-tight">
            <h3 className="h-small">Темы интервью</h3>
            <ul className="topic-list">
              {topics.map((t) => {
                const done = state?.covered_topics.includes(t.id);
                const now = question?.topic === t.id && phase === "question";
                return (
                  <li key={t.id} className={done ? "done" : now ? "now" : ""}>
                    <span className="topic-dot" aria-hidden>
                      {done ? "✓" : now ? "•" : ""}
                    </span>
                    {t.label}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
