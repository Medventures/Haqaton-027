"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import { answerText, fmtDate } from "@/lib/format";
import type { CaseView, InterviewItem, NextResponse, Progress, Summary, SummaryLine } from "@/lib/types";

type Phase = "loading" | "question" | "summary" | "generating" | "finished" | "error";

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12l5 5 9-10" />
  </svg>
);

function Known({ c, items }: { c: CaseView; items: InterviewItem[] }) {
  const { settings } = useApp();
  const i = c.intake;
  const rows: [string, string][] = [
    ["Ребёнок", `${c.age_text}, ${c.city}`],
    ["Заключение врача", i.has_conclusion ? `есть${i.conclusion_date ? `, от ${fmtDate(i.conclusion_date)}` : ""}` : "нет"],
    ["ПМПК", { none: "нет", valid: "действует", expired: "истекла" }[i.pmpk_status]],
    ["Справка МСЭ", i.mse_status === "none" ? "не было" : `${i.mse_status === "valid" ? "действует" : "истекла"}${i.mse_valid_until ? `, до ${fmtDate(i.mse_valid_until)}` : ""}`],
    ["Документы на руках", i.documents.length ? `${i.documents.length} шт.` : "нет"],
  ];
  for (const it of items)
    if (it.answer !== null && it.qid !== "12") rows.push([settings?.slot_labels[it.slot] ?? it.slot, answerText(it.answer)]);
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <b>Что мы уже знаем</b>
      <span className="hint" style={{ paddingBottom: 8 }}>
        Из анкеты и ваших ответов
      </span>
      {rows.map(([k, v]) => (
        <div key={k} className="known-row">
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryView({ summary, busy, onConfirm }: { summary: Summary; busy: boolean; onConfirm: (c: Record<string, string | string[]>) => void }) {
  const [edits, setEdits] = useState<Record<string, string | string[]>>({});
  const [editing, setEditing] = useState<string | null>(null);

  function editor(line: SummaryLine) {
    const cur = edits[line.slot] ?? line.raw;
    if (line.type === "text")
      return <textarea className="input" rows={3} value={String(cur)} onChange={(e) => setEdits({ ...edits, [line.slot]: e.target.value })} />;
    const arr = Array.isArray(cur) ? cur : [cur];
    return (
      <div className="chips">
        {line.options.map((o) => {
          const on = line.type === "multi" ? arr.includes(o) : cur === o;
          return (
            <button key={o} className={`chip ${on ? "on" : ""}`}
              onClick={() => setEdits({
                ...edits,
                [line.slot]: line.type === "multi" ? (on ? arr.filter((x) => x !== o) : [...arr, o]) : o,
              })}>
              {o}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="stack-sm">
        <span className="eyebrow">Последний шаг интервью</span>
        <h1 className="h-page">Правильно ли я понял?</h1>
        <p className="muted">Проверьте сводку. По ней будет составлен план.</p>
      </div>
      {summary.red_flags.length > 0 && (
        <div className="alert alert-crit" role="alert">
          <b>Рекомендуем как можно скорее обратиться к врачу.</b> Куратор получит отметку «срочно».
        </div>
      )}
      <div className="summary-grid">
        {summary.lines.map((line) => (
          <div key={line.slot} className="summary-item">
            <span className="lbl">
              {line.label}
              <button className="link-btn" onClick={() => setEditing(editing === line.slot ? null : line.slot)}>
                {editing === line.slot ? "Готово" : "Изменить"}
              </button>
            </span>
            {editing === line.slot ? editor(line) : <span className="val">{answerText(edits[line.slot] ?? line.value)}</span>}
            {edits[line.slot] !== undefined && editing !== line.slot && <span className="hint">исправлено</span>}
          </div>
        ))}
      </div>
      <div className="row gap-sm wrap">
        <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => onConfirm(edits)}>
          {busy ? "Сохраняем…" : "Да, всё верно"}
        </button>
      </div>
    </div>
  );
}

export default function InterviewPage() {
  const { id } = useParams<{ id: string }>();
  const { settings, ready, rememberCase, role, setRole, refreshShell } = useApp();
  const [c, setCase] = useState<CaseView | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [item, setItem] = useState<InterviewItem | null>(null);
  const [items, setItems] = useState<InterviewItem[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePageMeta("Интервью", c ? `${c.child_alias} · что уже есть и что мешает` : undefined);

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);

  const finish = useCallback(
    async (status: string) => {
      setPhase("generating");
      try {
        if (status === "draft") await api<CaseView>("parent", `/cases/${id}/plan/generate`, { method: "POST", body: {} });
        setPhase("finished");
        refreshShell();
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      }
    },
    [id, refreshShell],
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
        setMulti([]);
        setText("");
        if (r.item.type === "confirm" && r.summary) {
          setSummary(r.summary);
          setPhase("summary");
        } else setPhase("question");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [finish],
  );

  useEffect(() => {
    if (!ready) return;
    rememberCase(Number(id));
    (async () => {
      try {
        const cv = await api<CaseView>("parent", `/cases/${id}`);
        setCase(cv);
        if (cv.summary_confirmed) {
          await finish(cv.status);
          return;
        }
        const r = await api<NextResponse>("parent", `/cases/${id}/interview/next`, { method: "POST", body: {} });
        await handle(r, cv.status);
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      }
    })();
  }, [id, ready, handle, finish, rememberCase]);

  async function send(answer: string | string[]) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<NextResponse>("parent", `/cases/${id}/interview/next`, { method: "POST", body: { answer } });
      await handle(r, c?.status ?? "draft");
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
      await handle(r, c?.status ?? "draft");
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
      await finish(c?.status ?? "draft");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const answered = items.filter((i) => i.answer !== null && i.qid !== "12");
  const total = progress?.expected_total ?? 12;
  const current = item ? item.n : answered.length;
  const redFlag = answered.some((i) => i.slot === "red_flags" && Array.isArray(i.answer) && !i.answer.includes("Ничего из этого"));

  if (phase === "error") return <div className="alert alert-error">{error}</div>;
  if (phase === "loading" || !c) return <div className="hint">Загрузка интервью…</div>;

  if (phase === "summary" && summary) {
    return (
      <>
        {error && <div className="alert alert-error">{error}</div>}
        <SummaryView summary={summary} busy={busy} onConfirm={confirmSummary} />
      </>
    );
  }

  if (phase === "generating" || phase === "finished") {
    return (
      <div className="row" style={{ justifyContent: "center", paddingTop: 24 }}>
        <div className="stack" style={{ width: 620, maxWidth: "100%", gap: 20 }}>
          <h1 className="h-page">План на проверке у куратора</h1>
          <p className="lead">
            Черновик готов. Куратор проверит каждый шаг и сроки — после этого план появится в кабинете и начнутся напоминания.
          </p>
          <div className="card checks">
            <div className="check-line">
              <span className="check-dot">
                <Check />
              </span>
              Анкета заполнена
            </div>
            <div className="check-line">
              <span className="check-dot">
                <Check />
              </span>
              Сводка подтверждена
            </div>
            <div className="check-line">
              {phase === "generating" ? (
                <>
                  <span className="spinner" aria-hidden /> Собираем черновик плана из справочника услуг…
                </>
              ) : (
                <>
                  <span className="check-dot">
                    <Check />
                  </span>
                  Черновик плана составлен
                </>
              )}
            </div>
            <div className="check-line">
              <span className="check-dot pending" />
              <b>Проверка куратором</b>
            </div>
          </div>
          {phase === "finished" && (
            <div className="row gap-sm wrap">
              <Link className="btn btn-primary btn-lg" href={`/parent/cases/${id}`}>
                Перейти к плану
              </Link>
              <Link className="btn btn-lg" href={`/parent/cases/${id}/documents`}>
                Мои документы
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="two-col">
      <div className="stack" style={{ gap: 14, maxWidth: 760 }}>
        <div className="stack-sm">
          <div className="progress-head">
            <span className="eyebrow">
              Вопрос {Math.min(Math.max(current, 1), total)} из {total}
            </span>
            <span className="hint">вопросы подбираются под вашу ситуацию</span>
          </div>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${(Math.min(answered.length, total) / total) * 100}%` }} />
          </div>
        </div>

        {redFlag && (
          <div className="alert alert-crit" role="alert">
            <b>Важно.</b> Рекомендуем как можно скорее обратиться к врачу. Куратор получит отметку «срочно».
          </div>
        )}

        {answered.length > 0 && (
          <div className="history">
            {answered.slice(-3).map((i) => (
              <div key={i.n} className="qa">
                <div className="bubble-q">{i.text}</div>
                <div className="bubble-a">{answerText(i.answer)}</div>
              </div>
            ))}
          </div>
        )}

        {item && (
          <div className="question-card">
            <h2>{item.text}</h2>
            {item.source === "llm" && <span className="hint">Вопрос сформулирован AI с учётом ваших прошлых ответов</span>}
            {item.type === "multi" && <span className="hint">Можно выбрать несколько вариантов</span>}

            {item.type !== "text" && (
              <div className="options">
                {item.options.map((o) => {
                  const on = item.type === "multi" && multi.includes(o);
                  return (
                    <button key={o} className={`option ${on ? "on" : ""}`} disabled={busy}
                      onClick={() => (item.type === "choice" ? send(o) : setMulti((m) => (m.includes(o) ? m.filter((x) => x !== o) : [...m, o])))}>
                      <span className={`option-box ${item.type === "multi" ? "square" : ""}`}>{on && <Check />}</span>
                      <span>{o}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {item.type === "text" && (
              <textarea className="input" rows={4} value={text} disabled={busy} placeholder="Напишите своими словами" autoFocus
                onChange={(e) => setText(e.target.value)} />
            )}

            {error && <div className="alert alert-error">{error}</div>}

            <div className="row between wrap gap-sm">
              {c.scenario && settings?.demo_mode ? (
                <button className="btn btn-sm btn-demo" onClick={autofill} disabled={busy} title="Оставшиеся ответы берутся из синтетического кейса">
                  Демо: заполнить ответами
                </button>
              ) : (
                <span />
              )}
              {item.type !== "choice" && (
                <button className="btn btn-primary" disabled={busy || (item.type === "multi" ? !multi.length : !text.trim())}
                  onClick={() => send(item.type === "multi" ? multi : text.trim())}>
                  {busy ? "…" : "Далее"}
                </button>
              )}
              {item.type === "choice" && busy && <span className="hint">Сохраняем…</span>}
            </div>
          </div>
        )}
      </div>

      <div className="side">
        <Known c={c} items={items} />
      </div>
    </div>
  );
}
