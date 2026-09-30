"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Chip } from "@/components/Badges";
import { HelpPanel } from "@/components/HelpPanel";
import { RouteView } from "@/components/RouteView";
import { StepCard, type StepPatch } from "@/components/StepCard";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import { STAGE_LABEL, fmtDate } from "@/lib/format";
import { remindersFor } from "@/lib/reminders";
import type { CaseView } from "@/lib/types";

export default function MyRoutePage() {
  const { id } = useParams<{ id: string }>();
  const { settings, ready, rememberCase, role, setRole, refreshShell } = useApp();
  const [c, setCase] = useState<CaseView | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "route">("list");
  const [picked, setPicked] = useState<number | null>(null);
  usePageMeta("План", c ? `${c.child_alias} · этап «${STAGE_LABEL[c.stage]}»` : undefined);

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);

  const load = useCallback(async () => {
    try {
      setCase(await api<CaseView>("parent", `/cases/${id}`));
      setVersion((v) => v + 1);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    rememberCase(Number(id));
    load();
  }, [ready, load, id, rememberCase, settings?.today]);

  async function patch(stepId: number, p: StepPatch) {
    try {
      await api("parent", `/steps/${stepId}`, { method: "PATCH", body: p });
      await load();
      refreshShell();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleDoc(docType: string, have: boolean) {
    await api("parent", `/cases/${id}/documents/${docType}`, { method: "PATCH", body: { have } });
    await load();
  }

  if (!c || !settings) return error ? <div className="alert alert-error">{error}</div> : <div className="hint">Загрузка…</div>;

  if (!c.summary_confirmed) {
    return (
      <div className="card stack" style={{ maxWidth: 620 }}>
        <h1 className="h-page">Сначала несколько вопросов</h1>
        <p className="lead">Ответьте на вопросы и подтвердите сводку — по ней будет составлен план.</p>
        <Link href={`/parent/cases/${c.id}/interview`} className="btn btn-primary btn-lg self-start">
          Продолжить интервью
        </Link>
      </div>
    );
  }

  if (!c.plan_visible) {
    return (
      <div className="stack" style={{ maxWidth: 620 }}>
        <h1 className="h-page">План на проверке у куратора</h1>
        <p className="lead">Куратор проверит каждый шаг и сроки. Как только план будет подтверждён, он появится здесь.</p>
        {c.red_flag_text && <div className="alert alert-crit">⚠ {c.red_flag_text}</div>}
        <div className="row gap-sm wrap">
          <button className="btn btn-primary" onClick={load}>
            Обновить
          </button>
          <Link className="btn" href={`/parent/cases/${c.id}/documents`}>
            Мои документы
          </Link>
        </div>
      </div>
    );
  }

  const done = c.steps.filter((s) => s.status === "done").length;
  const overdue = c.steps.filter((s) => s.overdue).length;
  const soon = c.steps.filter((s) => s.due_soon);
  const reminders = remindersFor(c).slice(0, 3);
  const docs = new Map<string, boolean>();
  c.steps.forEach((s) => s.documents.filter((d) => !d.optional).forEach((d) => docs.set(d.doc_type, (docs.get(d.doc_type) ?? false) || d.have)));
  const docsHave = [...docs.values()].filter(Boolean).length;

  return (
    <div className="two-col">
      <div className="stack" style={{ gap: 14 }}>
        {c.red_flag_text && (
          <div className="alert alert-crit" role="alert">
            <b>Важно.</b> {c.red_flag_text}
          </div>
        )}
        {soon.map((s) => {
          const n = c.notifications.find((x) => x.step_id === s.id && x.type === "due_soon");
          return (
            <div key={s.id} className="banner-due">
              <b>⏰ {n?.message ?? `Скоро срок шага «${s.title}»`}</b>
              <HelpPanel stepId={s.id} role="parent" version={version} />
            </div>
          );
        })}

        <div className="stats">
          <div className="stat">
            <b>{c.steps.length}</b>
            <span>шагов в плане</span>
          </div>
          <div className="stat ok">
            <b>{done}</b>
            <span>выполнено</span>
          </div>
          <div className="stat accent">
            <b>{c.steps_locked}</b>
            <span>откроются позже</span>
          </div>
          <div className={`stat ${overdue ? "crit" : ""}`}>
            <b>{overdue}</b>
            <span>просрочено</span>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <div className="segmented" role="tablist" aria-label="Вид плана" style={{ alignSelf: "flex-start" }}>
          <button role="tab" aria-selected={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            Список
          </button>
          <button role="tab" aria-selected={view === "route"} className={view === "route" ? "active" : ""} onClick={() => setView("route")}>
            Маршрут
          </button>
        </div>
        {view === "list" ? (
          <div className="steps">
            {c.steps.map((s) => (
              <StepCard key={`${s.id}-${s.blocker_note}-${version}`} step={s} role="parent" editable onPatch={patch} onToggleDoc={toggleDoc}
                version={version} defaultOpen={s.indicator === "overdue" || s.indicator === "escalated"} />
            ))}
          </div>
        ) : (
          <>
            <RouteView steps={c.steps} selected={picked} onSelect={(sid) => {
              setPicked(sid);
              requestAnimationFrame(() => document.getElementById(`step-${sid}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }} />
            {c.steps.filter((s) => s.id === picked).map((s) => (
              <StepCard key={`${s.id}-${s.blocker_note}-${version}-route`} step={s} role="parent" editable onPatch={patch}
                onToggleDoc={toggleDoc} version={version} defaultOpen />
            ))}
          </>
        )}
        <p className="hint">
          Шаги взяты из справочника услуг и ваших документов. Лечение назначает только врач — мы лишь напоминаем о шагах и сроках.
        </p>
      </div>

      <div className="side">
        <div className="card stack-sm">
          <div className="row between">
            <b>Ближайшее</b>
            <Link href={`/parent/cases/${c.id}/reminders`} className="link-btn">
              Все напоминания
            </Link>
          </div>
          {reminders.length === 0 && <span className="small">Сейчас напоминаний нет — всё в срок.</span>}
          {reminders.map((r) => (
            <div key={r.key} className="reminder-mini">
              <span>
                <Chip tone={r.tone}>{r.tag}</Chip>
              </span>
              <span className="text">{r.text}</span>
            </div>
          ))}
        </div>
        <div className="card stack-sm">
          <div className="row between">
            <b>Документы</b>
            <Link href={`/parent/cases/${c.id}/documents`} className="link-btn">
              Открыть папку
            </Link>
          </div>
          <span className="small">
            Для плана нужно {docs.size} документов, есть {docsHave}. Отметьте документ один раз — он учтётся во всех шагах.
          </span>
          <div className="progress">
            <div className="progress-fill ok" style={{ width: `${(docsHave / Math.max(1, docs.size)) * 100}%` }} />
          </div>
        </div>
        <div className="card stack-sm">
          <b>Куратор</b>
          <span className="small" style={{ color: "var(--text-2)" }}>
            Куратор утвердил план{c.confirmed_at ? ` ${fmtDate(c.confirmed_at)}` : ""}. Подключается, если шаг просрочен или не
            получается.
          </span>
        </div>
      </div>
    </div>
  );
}
