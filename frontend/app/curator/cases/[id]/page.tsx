"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertBadge, CaseStatusBadge, StageBadge } from "@/components/Badges";
import { DocFolder } from "@/components/DocFolder";
import { StepCard, type StepPatch } from "@/components/StepCard";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import { DOMAIN_LABEL, LANGUAGE_LABEL, PRIORITY_LABEL, SOURCE_LABEL, answerText, auditLabel, fmtDate, fmtDateTime } from "@/lib/format";
import type { CaseView, Intake, Priority, Service } from "@/lib/types";

interface AuditItem {
  id: number;
  action: string;
  actor: string | null;
  at: string;
}

const STATUS_RU = { none: "нет", valid: "действует", expired: "истекла", done: "проходили" } as const;

function IntakeFacts({ i }: { i: Intake }) {
  const d = (v: string | null) => (v ? fmtDate(v) : "");
  return (
    <ul className="facts">
      <li>Заключение врача: {i.has_conclusion ? `есть${i.conclusion_date ? `, от ${d(i.conclusion_date)}` : ""}` : "нет"}</li>
      <li>Наблюдение у врача: {i.dispensary ? "да" : "нет"}</li>
      <li>Визит к педиатру: {i.pediatrician_visited ? "был" : "не было"}</li>
      <li>M-CHAT-R: {i.mchat_status === "done" ? "проходили" : "не проходили"}</li>
      <li>ПМПК: {STATUS_RU[i.pmpk_status]}{i.pmpk_date ? `, ${d(i.pmpk_date)}` : ""}</li>
      <li>Справка МСЭ: {i.mse_status === "none" ? "не было" : STATUS_RU[i.mse_status]}{i.mse_valid_until ? `, до ${d(i.mse_valid_until)}` : ""}</li>
    </ul>
  );
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
  const [version, setVersion] = useState(0);
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
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  usePageMeta(c ? c.child_alias : "Карточка дела", c ? `Карточка дела · ${c.age_text}, ${c.city}` : undefined);

  useEffect(() => {
    if (!ready) return;
    load();
    api<{ services: Service[] }>("curator", "/services").then((r) => setServices(r.services)).catch(() => {});
  }, [ready, load, settings?.today]);

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

  const generate = (force = false) => run("generate", () => api("curator", `/cases/${id}/plan/generate`, { method: "POST", body: { force } }));
  const confirmPlan = () => run("confirm", () => api("curator", `/cases/${id}/plan/confirm`, { method: "POST" }));
  const autofill = () =>
    run("autofill", async () => {
      await api("curator", `/cases/${id}/interview/autofill`, { method: "POST" });
      await api("curator", `/cases/${id}/interview/confirm`, { method: "POST", body: {} });
    });
  const resetCase = () => confirm("Сбросить интервью и план этого кейса?") && run("reset", () => api("curator", `/cases/${id}/reset`, { method: "POST" }));
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
  const remove = (stepId: number) => run("delete", () => api("curator", `/steps/${stepId}`, { method: "DELETE" }));
  const toggleDoc = async (docType: string, have: boolean) => {
    await api("curator", `/cases/${id}/documents/${docType}`, { method: "PATCH", body: { have } });
    await load();
  };

  if (!c || !settings) return error ? <div className="alert alert-error">{error}</div> : <div className="card muted">Загрузка…</div>;

  const answered = c.interview.items.filter((i) => i.answer !== null && i.qid !== "12");
  const meta = c.plan_meta;
  const inPlan = new Set(c.steps.map((s) => s.service_id));
  const addable = services.filter((s) => !inPlan.has(s.id));

  return (
    <div className="two-col">
      <div className="stack">
        <div className="stack-sm">
          <div className="row gap-xs wrap">
            <CaseStatusBadge status={c.status} /> <StageBadge stage={c.stage} /> {c.alert && <AlertBadge />}
          </div>
          <p className="small muted">
            Родился {fmtDate(c.birth_date)} · {c.city} · язык: {LANGUAGE_LABEL[c.language]} ·{" "}
            {c.handling_mode === "curator" ? "ведёт куратор (у семьи есть препятствия)" : "ведёт система"}
          </p>
          {c.red_flag_text && (
            <div className="alert alert-crit">
              ⚠ Красный флаг в интервью. Семье показан текст: «{c.red_flag_text}» Свяжитесь с семьёй и врачом.
            </div>
          )}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {!c.summary_confirmed && (
          <div className="card banner">
            <div>
              <b>Интервью не завершено</b>
              <div className="muted small">Ответов: {c.interview_answered}. План можно собрать после подтверждения сводки родителем.</div>
            </div>
            {c.scenario && settings.demo_mode && (
              <button className="btn" disabled={!!busy} onClick={autofill}>
                {busy === "autofill" ? "Заполняем…" : "Заполнить демо-ответами"}
              </button>
            )}
          </div>
        )}

        {c.summary_confirmed && c.status === "draft" && (
          <div className="card banner">
            <div>
              <b>Сводка подтверждена, плана пока нет</b>
              <div className="muted small">Шаги определит ядро правил, AI напишет объяснения.</div>
            </div>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => generate()}>
              {busy === "generate" ? "Формируем…" : "Сформировать план"}
            </button>
          </div>
        )}

        {c.status === "awaiting_curator" && (
          <div className="card banner banner-warn">
            <div>
              <b>Черновик плана — проверьте перед показом семье</b>
              <div className="muted small">Можно менять приоритет, добавлять шаги из справочника и оставлять заметки.</div>
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
              <div className="muted small">Семья видит маршрут. Заблокированные шаги откроются автоматически.</div>
            </div>
            <div className="row gap-sm wrap">
              <Link className="btn btn-primary" href={`/curator/cases/${c.id}/handoff`}>
                Передача дела
              </Link>
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={regenerateConfirmed}>
                Пересобрать
              </button>
            </div>
          </div>
        )}


        {meta && (
          <details className="card card-tight">
            <summary className="small">
              <b>Как собран план:</b> шаги — ядро правил; тексты — {SOURCE_LABEL[meta.source] ?? meta.source}
              {" "}· шагов {meta.steps}
            </summary>
            <div className="small mt-sm stack-sm">
              <div className="muted">
                Какие шаги нужны, какие заблокированы и какие сроки — считает код от {fmtDate(meta.base_date)}. Модель только пишет
                объяснения и может изменить приоритет активных шагов.
              </div>
              {meta.warnings.map((w, i) => (
                <div key={i}>⚠️ {w}</div>
              ))}
              {meta.errors.map((w, i) => (
                <div key={i} className="text-danger">
                  {w}
                </div>
              ))}
            </div>
          </details>
        )}

        {c.steps.length > 0 && (
          <div className="steps">
            {c.steps.map((s) => (
              <StepCard key={`${s.id}-${s.curator_note}-${s.blocker_note}-${version}`} step={s} role="curator" editable
                onPatch={patch} onDelete={remove} onToggleDoc={toggleDoc} version={version} />
            ))}
          </div>
        )}

        {c.status !== "draft" && (
          <div className="card card-tight">
            <h3 className="h-small">Добавить шаг из справочника</h3>
            <div className="row gap-sm wrap">
              <select className="input input-sm grow" value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">Выберите услугу…</option>
                {Object.entries(DOMAIN_LABEL).map(([d, label]) => {
                  const list = addable.filter((s) => s.domain === d);
                  return list.length ? (
                    <optgroup key={d} label={label}>
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
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

      <aside className="side">
        <div className="card card-tight">
          <h3 className="h-small">Анкета Q0</h3>
          <IntakeFacts i={c.intake} />
        </div>
        <div className="card card-tight">
          <h3 className="h-small">
            Сводка интервью ({answered.length}) {c.summary_confirmed && <span className="pill pill-muted pill-xs">подтверждена</span>}
          </h3>
          {answered.length === 0 && <p className="muted small">Пока нет ответов.</p>}
          <dl className="slot-list">
            {answered.map((i) => (
              <div key={i.qid}>
                <dt className="muted small">
                  {settings.slot_labels[i.slot] ?? i.slot}
                  {i.source === "llm" && <span className="pill pill-ai pill-xs">AI</span>}
                  {i.autofilled && <span className="pill pill-muted pill-xs">демо</span>}
                  {i.corrected && <span className="pill pill-muted pill-xs">исправлено</span>}
                </dt>
                <dd>{answerText(i.answer)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="card card-tight">
          <h3 className="h-small">Папка документов</h3>
          <DocFolder key={version} caseId={c.id} role="curator" onChange={load} compact />
        </div>
        {audit.length > 0 && (
          <div className="card card-tight">
            <h3 className="h-small">Журнал</h3>
            <ul className="audit-list">
              {audit.slice(0, 15).map((a) => (
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
