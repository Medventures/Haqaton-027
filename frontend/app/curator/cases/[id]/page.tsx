"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CaseStatusBadge } from "@/components/Badges";
import { DemoDateControl } from "@/components/DemoDateControl";
import { DocSummary } from "@/components/DocSummary";
import { StepCard, type StepPatch } from "@/components/StepCard";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { DOMAIN_LABEL, LANGUAGE_LABEL, PRIORITY_LABEL, SOURCE_LABEL, answerText, auditLabel, fmtDate, fmtDateTime } from "@/lib/format";
import type { CaseView, Priority, Service } from "@/lib/types";

interface AuditItem {
  id: number;
  action: string;
  actor: string | null;
  at: string;
}

export default function CuratorCasePage() {
  const { id } = useParams<{ id: string }>();
  const { settings, ready, role, setRole } = useApp();
  const [c, setCase] = useState<CaseView | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [addId, setAddId] = useState("");
  const [addPrio, setAddPrio] = useState<Priority>("medium");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && role !== "curator") setRole("curator");
  }, [ready, role, setRole]);

  const load = useCallback(async () => {
    try {
      const [cv, a] = await Promise.all([
        api<CaseView>("curator", `/cases/${id}`),
        api<{ items: AuditItem[] }>("curator", `/cases/${id}/audit`),
      ]);
      setCase(cv);
      setAudit(a.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    load();
    api<{ services: Service[] }>("curator", "/services").then((r) => setServices(r.services)).catch(() => {});
  }, [ready, load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const generate = (force = false) =>
    run("generate", () => api("curator", `/cases/${id}/plan/generate`, { method: "POST", body: { force } }));
  const confirmPlan = () => run("confirm", () => api("curator", `/cases/${id}/plan/confirm`, { method: "POST" }));
  const autofill = () => run("autofill", () => api("curator", `/cases/${id}/interview/autofill`, { method: "POST" }));
  const resetCase = () =>
    confirm("Сбросить интервью и план этого кейса?") && run("reset", () => api("curator", `/cases/${id}/reset`, { method: "POST" }));
  const regenerateConfirmed = () =>
    confirm("Пересобрать подтверждённый план? Статусы сбросятся, семья не увидит план до повторного подтверждения.") && generate(true);
  const addStep = () =>
    addId &&
    run("add", async () => {
      await api("curator", `/cases/${id}/steps`, { method: "POST", body: { service_id: addId, priority: addPrio } });
      setAddId("");
    });

  async function patch(stepId: number, p: StepPatch) {
    try {
      await api("curator", `/steps/${stepId}`, { method: "PATCH", body: p });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(stepId: number) {
    await run("delete", () => api("curator", `/steps/${stepId}`, { method: "DELETE" }));
  }

  if (!c || !settings) return error ? <div className="alert alert-error">{error}</div> : <div className="card muted">Загрузка…</div>;

  const answered = c.interview.items.filter((i) => i.answer !== null);
  const meta = c.plan_meta;
  const inPlan = new Set(c.steps.map((s) => s.service_id));
  const addable = services.filter((s) => !inPlan.has(s.id));
  const fitsAge = (s: Service) =>
    (s.min_age_months === null || c.age_months >= s.min_age_months) && (s.max_age_months === null || c.age_months <= s.max_age_months);

  return (
    <div className="plan-layout">
      <div className="stack">
        <div>
          <Link href="/curator" className="muted small">
            ← Панель куратора
          </Link>
          <h1 className="h-page">
            {c.child_alias} <CaseStatusBadge status={c.status} />
          </h1>
          <p className="muted small">
            {c.age_text} (род. {fmtDate(c.birth_date)}), {c.city}, язык: {LANGUAGE_LABEL[c.language]}
          </p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {!c.interview_done && (
          <div className="card banner">
            <div>
              <b>Интервью не завершено</b>
              <div className="muted small">Ответов: {c.interview.answered}. Родитель проходит интервью в своём кабинете.</div>
            </div>
            {c.scenario && settings.demo_mode && (
              <button className="btn" disabled={!!busy} onClick={autofill}>
                {busy === "autofill" ? "Заполняем…" : "Заполнить демо-ответами"}
              </button>
            )}
          </div>
        )}

        {c.interview_done && c.status === "draft" && (
          <div className="card banner">
            <div>
              <b>Интервью завершено, плана пока нет</b>
              <div className="muted small">AI соберёт черновик из справочника услуг.</div>
            </div>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => generate()}>
              {busy === "generate" ? "Формируем план…" : "Сформировать план"}
            </button>
          </div>
        )}

        {c.status === "awaiting_curator" && (
          <div className="card banner banner-warn">
            <div>
              <b>Черновик плана — проверьте перед показом семье</b>
              <div className="muted small">Можно менять приоритет, удалять и добавлять шаги из справочника. Семья не видит план до подтверждения.</div>
            </div>
            <div className="row gap-sm wrap">
              <button className="btn" disabled={!!busy} onClick={() => generate(true)}>
                {busy === "generate" ? "Пересобираем…" : "Пересобрать"}
              </button>
              <button className="btn btn-primary" disabled={!!busy || c.steps.length === 0} onClick={confirmPlan}>
                {busy === "confirm" ? "Подтверждаем…" : "Подтвердить план"}
              </button>
            </div>
          </div>
        )}

        {c.status === "confirmed" && (
          <div className="card banner banner-ok">
            <div>
              <b>План подтверждён{c.confirmed_at ? ` ${fmtDate(c.confirmed_at)}` : ""}</b>
              <div className="muted small">Семья видит маршрут. Ведите статусы, документы и препятствия.</div>
            </div>
            <div className="row gap-sm wrap">
              <Link className="btn btn-primary" href={`/curator/cases/${c.id}/handoff`}>
                Передача дела
              </Link>
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={regenerateConfirmed}>
                Пересобрать план
              </button>
            </div>
          </div>
        )}

        {c.status === "confirmed" && <DemoDateControl onChange={load} />}

        {meta && (
          <details className="card card-tight">
            <summary className="small">
              <b>Как собран план:</b> {SOURCE_LABEL[meta.source] ?? meta.source}
              {meta.model && ` · модель ${meta.model}`} · шагов {meta.steps}
              {meta.warnings.length > 0 && ` · предупреждений ${meta.warnings.length}`}
            </summary>
            <div className="small mt-sm stack-sm">
              <div className="muted">
                Шаги — только из справочника. Сроки рассчитаны кодом: {fmtDate(meta.base_date)} + срок услуги по справочнику.
              </div>
              {meta.warnings.length > 0 && (
                <ul className="plain-list">
                  {meta.warnings.map((w, i) => (
                    <li key={i}>⚠️ {w}</li>
                  ))}
                </ul>
              )}
              {meta.errors.length > 0 && (
                <ul className="plain-list">
                  {meta.errors.map((w, i) => (
                    <li key={i} className="text-danger">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}

        {c.steps.length > 0 && (
          <div className="steps">
            {c.steps.map((s) => (
              <StepCard
                key={`${s.id}-${s.curator_note}-${s.blocker_note}`}
                step={s}
                role="curator"
                today={settings.today}
                editable
                onPatch={patch}
                onDelete={remove}
              />
            ))}
          </div>
        )}

        {c.status !== "draft" && (
          <div className="card card-tight add-step">
            <h3 className="h-small">Добавить шаг из справочника</h3>
            <div className="row gap-sm wrap">
              <select className="input input-sm grow" value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">Выберите услугу…</option>
                {Object.entries(DOMAIN_LABEL).map(([d, label]) => {
                  const items = addable.filter((s) => s.domain === d);
                  return items.length ? (
                    <optgroup key={d} label={label}>
                      {items.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                          {fitsAge(s) ? "" : " (не по возрасту)"}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
              <select className="input input-sm" value={addPrio} onChange={(e) => setAddPrio(e.target.value as Priority)}>
                {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" disabled={!addId || !!busy} onClick={addStep}>
                Добавить
              </button>
            </div>
          </div>
        )}

        {settings.demo_mode && (
          <div>
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={resetCase}>
              Сбросить кейс
            </button>
          </div>
        )}
      </div>

      <aside className="stack">
        <div className="card card-tight">
          <h3 className="h-small">Ответы интервью ({answered.length})</h3>
          {answered.length === 0 && <p className="muted small">Пока нет ответов.</p>}
          <ol className="qa-list">
            {answered.map((i) => (
              <li key={i.n}>
                <div className="muted small">
                  {i.question}
                  {i.source === "llm" && <span className="pill pill-ai pill-xs">AI</span>}
                  {i.autofilled && <span className="pill pill-muted pill-xs">демо</span>}
                </div>
                <div>{answerText(i.answer)}</div>
              </li>
            ))}
          </ol>
        </div>
        <DocSummary steps={c.steps} />
        {audit.length > 0 && (
          <div className="card card-tight">
            <h3 className="h-small">Журнал</h3>
            <ul className="audit-list">
              {audit.map((a) => (
                <li key={a.id}>
                  <span className="muted small">{fmtDateTime(a.at)}</span> {auditLabel(a.action)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
