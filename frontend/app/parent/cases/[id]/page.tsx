"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AgencyBadge } from "@/components/Badges";
import { DocSummary } from "@/components/DocSummary";
import { StepCard, type StepPatch } from "@/components/StepCard";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import type { Agency, CaseView } from "@/lib/types";

const AGENCIES: Agency[] = ["медицина", "образование", "соцзащита"];

export default function MyRoutePage() {
  const { id } = useParams<{ id: string }>();
  const { settings, ready, rememberCase, role, setRole } = useApp();

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);
  const [c, setCase] = useState<CaseView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCase(await api<CaseView>("parent", `/cases/${id}`));
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

  if (!c || !settings) return error ? <div className="alert alert-error">{error}</div> : <div className="card muted">Загрузка…</div>;

  const header = (
    <div>
      <Link href="/parent" className="muted small">
        ← Кабинет родителя
      </Link>
      <h1 className="h-page">Мой маршрут · {c.child_alias}</h1>
      <p className="muted small">
        {c.age_text}, {c.city}
      </p>
    </div>
  );

  if (!c.interview_done) {
    return (
      <div className="stack">
        {header}
        <div className="card center-card">
          <h2>Интервью ещё не завершено</h2>
          <p className="muted">Ответьте на несколько вопросов, чтобы мы собрали маршрут помощи.</p>
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
          <p className="muted">
            Куратор проверяет черновик, чтобы всё было точно. Как только маршрут будет подтверждён, шаги появятся здесь.
          </p>
          <button className="btn" onClick={load}>
            Обновить
          </button>
        </div>
      </div>
    );
  }

  const done = c.steps.filter((s) => s.status === "done").length;
  const overdue = c.steps.filter((s) => s.overdue).length;
  const next = c.steps.find((s) => s.status !== "done");

  return (
    <div className="plan-layout">
      <div className="stack">
        {header}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card summary-card">
          <div className="summary-stats">
            <div>
              <div className="stat-value">
                {done} / {c.steps.length}
              </div>
              <div className="muted small">шагов выполнено</div>
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

        <div className="steps">
          {c.steps.map((s) => (
            <StepCard key={`${s.id}-${s.blocker_note}`} step={s} role="parent" today={settings.today} editable onPatch={patch} />
          ))}
        </div>
      </div>
      <aside className="stack">
        <DocSummary steps={c.steps} />
        <div className="card card-tight">
          <h3 className="h-small">Важно</h3>
          <p className="muted small">
            Маршрут показывает, куда обратиться, в какие сроки и с какими документами. Он не содержит диагнозов и
            медицинских рекомендаций. Если что-то мешает выполнить шаг, отметьте препятствие — куратор увидит его.
          </p>
        </div>
      </aside>
    </div>
  );
}
