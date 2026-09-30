"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { AgencyBadge, BlockerBadge, CaseStatusBadge, EscalatedBadge, PriorityBadge } from "@/components/Badges";
import { DemoDateControl } from "@/components/DemoDateControl";
import { NotificationDraft } from "@/components/StepCard";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { STATUS_LABEL, fmtDate } from "@/lib/format";
import type { CaseSummary, OverdueResponse, StepStatus } from "@/lib/types";

export default function CuratorDashboard() {
  const { ready, role, setRole, settings } = useApp();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [overdue, setOverdue] = useState<OverdueResponse | null>(null);
  const [openNotice, setOpenNotice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && role !== "curator") setRole("curator");
  }, [ready, role, setRole]);

  const load = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([
        api<{ cases: CaseSummary[] }>("curator", "/curator/cases"),
        api<OverdueResponse>("curator", "/curator/overdue"),
      ]);
      setCases(c.cases);
      setOverdue(o);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  async function setStatus(stepId: number, status: StepStatus) {
    try {
      await api("curator", `/steps/${stepId}`, { method: "PATCH", body: { status } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function resetDemo() {
    if (!confirm("Сбросить демо? Все кейсы вернутся в исходное состояние, дата — на сегодня.")) return;
    await api("curator", "/demo/reset", { method: "POST" });
    location.reload();
  }

  const awaiting = cases?.filter((c) => c.status === "awaiting_curator").length ?? 0;
  const blockers = cases?.reduce((acc, c) => acc + c.blockers, 0) ?? 0;

  return (
    <div className="stack-lg">
      <div className="row between wrap gap-sm">
        <h1 className="h-page">Панель куратора</h1>
        {settings?.demo_mode && (
          <button className="btn btn-ghost btn-sm" onClick={resetDemo}>
            Сбросить демо
          </button>
        )}
      </div>

      <DemoDateControl onChange={load} />
      {error && <div className="alert alert-error">{error}</div>}

      <section className="kpis">
        <div className="kpi">
          <div className="stat-value">{cases?.length ?? "—"}</div>
          <div className="muted small">дел</div>
        </div>
        <div className={`kpi ${awaiting ? "kpi-warn" : ""}`}>
          <div className="stat-value">{awaiting}</div>
          <div className="muted small">ждут подтверждения</div>
        </div>
        <div className={`kpi ${overdue?.overdue_count ? "kpi-danger" : ""}`}>
          <div className="stat-value">{overdue?.overdue_count ?? "—"}</div>
          <div className="muted small">просроченных шагов</div>
        </div>
        <div className={`kpi ${overdue?.escalated_count ? "kpi-danger" : ""}`}>
          <div className="stat-value">{overdue?.escalated_count ?? "—"}</div>
          <div className="muted small">эскалаций</div>
        </div>
        <div className={`kpi ${blockers ? "kpi-warn" : ""}`}>
          <div className="stat-value">{blockers}</div>
          <div className="muted small">препятствий</div>
        </div>
      </section>

      <section className="card">
        <h2>Дела</h2>
        {!cases && <div className="muted">Загрузка…</div>}
        {cases && (
          <ul className="case-list">
            {cases.map((c) => (
              <li key={c.id} className="case-row">
                <div className="case-main">
                  <div className="case-title">
                    {c.child_alias} <CaseStatusBadge status={c.status} />
                    {!!c.overdue && <span className="badge overdue">просрочено: {c.overdue}</span>}
                    {!!c.escalated && <EscalatedBadge />}
                    {!!c.blockers && <span className="badge blocker">⛔ препятствий: {c.blockers}</span>}
                  </div>
                  <div className="muted small">
                    {c.age_text}, {c.city} ·{" "}
                    {c.interview_done ? "интервью завершено" : `интервью: ${c.interview_answered} ответов`}
                    {c.steps_total > 0 && ` · выполнено ${c.steps_done} из ${c.steps_total}`}
                  </div>
                </div>
                <Link className={`btn ${c.status === "awaiting_curator" ? "btn-primary" : ""}`} href={`/curator/cases/${c.id}`}>
                  {c.status === "awaiting_curator" ? "Проверить план" : "Открыть"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Просрочки и эскалации</h2>
          {overdue && <span className="muted small">на {fmtDate(overdue.today)}</span>}
        </div>
        {overdue && overdue.items.length === 0 && (
          <p className="muted">Просроченных шагов нет. Сдвиньте дату демо вперёд, чтобы увидеть контроль сроков.</p>
        )}
        {overdue && overdue.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Семья</th>
                  <th>Шаг и ведомство</th>
                  <th>Причина</th>
                  <th>Срок</th>
                  <th>Просрочка</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {overdue.items.map((s) => (
                  <Fragment key={s.id}>
                    <tr className={s.escalated ? "row-escalated" : "row-overdue"}>
                      <td>
                        <Link href={`/curator/cases/${s.case_id}`}>{s.case_alias}</Link>
                      </td>
                      <td>
                        <div className="cell-title">{s.title}</div>
                        <div className="row gap-xs wrap">
                          <AgencyBadge agency={s.agency} />
                          <PriorityBadge priority={s.priority} />
                        </div>
                        <div className="muted small mt-xs">{s.owner}</div>
                      </td>
                      <td className="small">
                        {s.blocker && <BlockerBadge blocker={s.blocker} />}
                        <div className="mt-xs">{s.reason}</div>
                      </td>
                      <td className="nowrap">{fmtDate(s.due_date)}</td>
                      <td className="nowrap">
                        <b className="text-danger">{s.days_overdue} дн.</b>
                        {s.escalated && (
                          <div className="mt-xs">
                            <EscalatedBadge />{" "}
                            <button className="link-btn small" onClick={() => setOpenNotice(openNotice === s.id ? null : s.id)}>
                              {openNotice === s.id ? "скрыть" : "уведомление"}
                            </button>
                          </div>
                        )}
                      </td>
                      <td>
                        <select className="input input-sm" value={s.status} onChange={(e) => setStatus(s.id, e.target.value as StepStatus)}>
                          {(Object.keys(STATUS_LABEL) as StepStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {STATUS_LABEL[st]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    {openNotice === s.id && s.notification && (
                      <tr className="row-notice">
                        <td colSpan={6}>
                          <NotificationDraft n={s.notification} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {overdue && overdue.blocked.length > 0 && (
        <section className="card">
          <h2>Шаги с препятствиями</h2>
          <ul className="case-list">
            {overdue.blocked.map((s) => (
              <li key={s.id} className="case-row">
                <div className="case-main">
                  <div className="case-title">
                    {s.title} <BlockerBadge blocker={s.blocker!} />
                  </div>
                  <div className="muted small">
                    {s.case_alias} · {s.owner} · срок {fmtDate(s.due_date)}
                    {s.blocker_note ? ` · ${s.blocker_note}` : ""}
                  </div>
                </div>
                <Link className="btn btn-sm" href={`/curator/cases/${s.case_id}`}>
                  К делу
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
