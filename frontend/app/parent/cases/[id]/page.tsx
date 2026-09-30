"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AgencyBadge, StageBadge } from "@/components/Badges";
import { HelpPanel } from "@/components/HelpPanel";
import { StepCard, type StepPatch } from "@/components/StepCard";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import type { Agency, CaseView } from "@/lib/types";

const AGENCIES: Agency[] = ["медицина", "образование", "соцзащита"];

export default function MyRoutePage() {
  const { id } = useParams<{ id: string }>();
  const { settings, ready, rememberCase, role, setRole } = useApp();
  const [c, setCase] = useState<CaseView | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
  }, [ready, load, id, rememberCase]);

  async function patch(stepId: number, p: StepPatch) {
    try {
      await api("parent", `/steps/${stepId}`, { method: "PATCH", body: p });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleDoc(docType: string, have: boolean) {
    await api("parent", `/cases/${id}/documents/${docType}`, { method: "PATCH", body: { have } });
    await load();
  }

  if (!c || !settings) return error ? <div className="alert alert-error">{error}</div> : <div className="card muted">Загрузка…</div>;

  const header = (
    <div>
      <Link href="/parent" className="muted small">
        ← Кабинет родителя
      </Link>
      <h1 className="h-page">
        Мой маршрут · {c.child_alias} <StageBadge stage={c.stage} />
      </h1>
      <p className="muted small">
        {c.age_text}, {c.city} ·{" "}
        <Link href={`/parent/cases/${c.id}/documents`}>Моя папка документов</Link>
      </p>
      {c.red_flag_text && <div className="alert alert-error">⚠ {c.red_flag_text}</div>}
    </div>
  );

  if (!c.summary_confirmed) {
    return (
      <div className="stack">
        {header}
        <div className="card center-card">
          <h2>Интервью ещё не завершено</h2>
          <p className="muted">Ответьте на несколько вопросов и подтвердите сводку, чтобы мы собрали маршрут.</p>
          <Link href={`/parent/cases/${c.id}/interview`} className="btn btn-primary">
            Продолжить интервью
          </Link>
        </div>
      </div>
    );
  }

  if (!c.plan_visible) {
    return (
      <div className="stack">
        {header}
        <div className="card center-card">
          <div className="wait-mark" aria-hidden>
            ⏳
          </div>
          <h2>Маршрут на проверке у куратора</h2>
          <p className="muted">Как только маршрут будет подтверждён, шаги появятся здесь. Пока можно отметить документы в папке.</p>
          <div className="row gap-sm">
            <button className="btn" onClick={load}>
              Обновить
            </button>
            <Link className="btn" href={`/parent/cases/${c.id}/documents`}>
              Моя папка
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const active = c.steps.filter((s) => s.status !== "locked");
  const done = c.steps.filter((s) => s.status === "done").length;
  const overdue = c.steps.filter((s) => s.overdue).length;
  const soon = c.steps.filter((s) => s.due_soon);
  const next = active.find((s) => s.status !== "done");

  return (
    <div className="stack">
      {header}

      {soon.map((s) => {
        const n = c.notifications.find((x) => x.step_id === s.id && x.type === "due_soon");
        return (
          <div key={s.id} className="card banner-due">
            <b>⏰ {n?.message ?? `Скоро срок шага «${s.title}»`}</b>
            <HelpPanel stepId={s.id} role="parent" version={version} />
          </div>
        );
      })}

      <div className="card summary-card">
        <div className="summary-stats">
          <div>
            <div className="stat-value">
              {done} / {c.steps.length}
            </div>
            <div className="muted small">шагов выполнено</div>
          </div>
          <div>
            <div className="stat-value">{c.steps_locked}</div>
            <div className="muted small">ждут открытия</div>
          </div>
          <div>
            <div className={`stat-value ${overdue ? "text-danger" : ""}`}>{overdue}</div>
            <div className="muted small">с истёкшим сроком</div>
          </div>
          <div className="row gap-xs wrap">
            {AGENCIES.map((a) => {
              const n = c.steps.filter((s) => s.agency === a).length;
              return n ? (
                <span key={a} className="row gap-xs">
                  <AgencyBadge agency={a} />
                  <span className="small">× {n}</span>
                </span>
              ) : null;
            })}
          </div>
        </div>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${(done / Math.max(1, c.steps.length)) * 100}%` }} />
        </div>
        {next && (
          <p className="small mt-sm">
            <b>Следующий шаг:</b> {next.title}
          </p>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      <div className="steps">
        {c.steps.map((s) => (
          <StepCard key={`${s.id}-${s.blocker_note}-${version}`} step={s} role="parent" editable onPatch={patch} onToggleDoc={toggleDoc} version={version} />
        ))}
      </div>

      <p className="muted small">
        Маршрут показывает, куда обратиться, в какие сроки и с какими документами. Диагнозов и медицинских рекомендаций в нём
        нет. Если что-то мешает, отметьте препятствие — куратор увидит его.
      </p>
    </div>
  );
}
