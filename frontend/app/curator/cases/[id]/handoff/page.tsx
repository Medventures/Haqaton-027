"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AgencyBadge } from "@/components/Badges";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { LANGUAGE_LABEL, STATUS_LABEL, ageText, fmtDate } from "@/lib/format";
import type { Domain, Handoff, HandoffStep } from "@/lib/types";

function StepTable({ steps, showOverdue }: { steps: HandoffStep[]; showOverdue?: boolean }) {
  if (!steps.length) return <p className="muted small">Нет.</p>;
  return (
    <table className="table table-compact">
      <thead>
        <tr>
          <th>Шаг</th>
          <th>Ответственный</th>
          <th>Срок</th>
          <th>{showOverdue ? "Просрочка" : "Статус"}</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => (
          <tr key={s.step_id}>
            <td>
              <div className="cell-title">{s.title}</div>
              <AgencyBadge agency={s.agency} />
            </td>
            <td className="small">{s.owner}</td>
            <td className="nowrap">{fmtDate(s.completed_at ?? s.due_date)}</td>
            <td className="nowrap">
              {showOverdue ? <b className="text-danger">{s.days_overdue} дн.</b> : STATUS_LABEL[s.status]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function HandoffPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, role, setRole } = useApp();
  const [h, setH] = useState<Handoff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && role !== "curator") setRole("curator");
  }, [ready, role, setRole]);

  useEffect(() => {
    if (!ready) return;
    api<Handoff>("curator", `/cases/${id}/handoff`)
      .then(setH)
      .catch((e) => setError((e as Error).message));
  }, [ready, id]);

  async function exportPdf() {
    try {
      await api("curator", `/cases/${id}/handoff/export`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    window.print();
  }

  if (error)
    return (
      <div className="stack">
        <Link href={`/curator/cases/${id}`} className="muted small">
          ← К делу
        </Link>
        <div className="alert alert-error">{error}</div>
      </div>
    );
  if (!h) return <div className="card muted">Загрузка…</div>;

  const domains = Object.entries(h.coverage_by_domain) as [Domain, { label: string; total: number; done: number }][];

  return (
    <div className="stack handoff">
      <div className="row between wrap gap-sm no-print">
        <Link href={`/curator/cases/${id}`} className="muted small">
          ← К делу
        </Link>
        <button className="btn btn-primary" onClick={exportPdf}>
          Сохранить в PDF
        </button>
      </div>

      <header className="handoff-head">
        <div className="muted small">AqylRoute AI · Передача дела · на {fmtDate(h.as_of)}</div>
        <h1 className="h-page">{h.case.alias}</h1>
        <p className="muted">
          Ребёнок {ageText(h.case.age_months)}, {h.case.city}, язык общения: {LANGUAGE_LABEL[h.case.language]}
          {h.case.confirmed_at && ` · план подтверждён ${fmtDate(h.case.confirmed_at)}`}
        </p>
        <p className="handoff-summary">{h.summary_text}</p>
      </header>

      <section className="kpis">
        <div className="kpi">
          <div className="stat-value">{h.done.length}</div>
          <div className="muted small">выполнено</div>
        </div>
        <div className="kpi">
          <div className="stat-value">{h.pending.length}</div>
          <div className="muted small">в работе и впереди</div>
        </div>
        <div className={`kpi ${h.overdue.length ? "kpi-danger" : ""}`}>
          <div className="stat-value">{h.overdue.length}</div>
          <div className="muted small">просрочено</div>
        </div>
        <div className={`kpi ${h.blockers.length ? "kpi-warn" : ""}`}>
          <div className="stat-value">{h.blockers.length}</div>
          <div className="muted small">препятствий</div>
        </div>
        <div className={`kpi ${h.documents.missing.length ? "kpi-warn" : ""}`}>
          <div className="stat-value">{h.documents.missing.length}</div>
          <div className="muted small">документов нет</div>
        </div>
      </section>

      <div className="grid-2 align-start">
        <section className="card card-tight">
          <h2 className="h-small">Ближайшие сроки</h2>
          <StepTable steps={h.next_deadlines} />
        </section>
        <section className="card card-tight">
          <h2 className="h-small">Просрочено</h2>
          <StepTable steps={h.overdue} showOverdue />
        </section>
      </div>

      <section className="card card-tight">
        <h2 className="h-small">Препятствия</h2>
        {h.blockers.length === 0 ? (
          <p className="muted small">Нет.</p>
        ) : (
          <ul className="plain-list stack-sm">
            {h.blockers.map((b) => (
              <li key={b.step_id}>
                <b>{b.step}</b> — {b.blocker_label}
                {b.note && <span className="muted">: {b.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid-2 align-start">
        <section className="card card-tight">
          <h2 className="h-small">Покрытие по областям помощи</h2>
          <ul className="coverage">
            {domains.map(([d, v]) => (
              <li key={d} className={v.total === 0 ? "gap" : ""}>
                <span>{v.label}</span>
                <span className="coverage-bar" aria-hidden>
                  <span style={{ width: v.total ? `${(v.done / v.total) * 100}%` : 0 }} />
                </span>
                <span className="small nowrap">{v.total ? `${v.done} из ${v.total}` : "нет шагов"}</span>
              </li>
            ))}
          </ul>
          {h.gaps.length > 0 && (
            <p className="small mt-sm">
              <b>Пробелы:</b> {h.gaps.map((g) => g.label).join(", ")} — в маршруте нет шагов по этим областям.
            </p>
          )}
        </section>
        <section className="card card-tight">
          <h2 className="h-small">Документы</h2>
          <div className="docs-2">
            <div>
              <div className="muted small">Есть ({h.documents.have.length})</div>
              <ul className="doc-summary">
                {h.documents.have.map((d) => (
                  <li key={d} className="have">
                    ✓ {d}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="muted small">Нет ({h.documents.missing.length})</div>
              <ul className="doc-summary">
                {h.documents.missing.map((d) => (
                  <li key={d}>○ {d}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>

      <section className="card card-tight">
        <h2 className="h-small">Все шаги в работе и впереди</h2>
        <StepTable steps={h.pending} />
      </section>
      <section className="card card-tight">
        <h2 className="h-small">Выполнено</h2>
        <StepTable steps={h.done} />
      </section>

      <p className="muted small">
        Сводка собрана автоматически из шагов маршрута. Не содержит диагнозов, оценок и медицинских рекомендаций; ответы
        интервью в неё не включаются.
      </p>
    </div>
  );
}
