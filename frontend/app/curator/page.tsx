"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { AgencyBadge, AlertBadge, Chip, type Tone, BlockerBadge, CaseStatusBadge, EscalatedBadge, PriorityBadge, StageBadge } from "@/components/Badges";
import { HelpPanel } from "@/components/HelpPanel";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import { STATUS_LABEL, fmtDate, fmtDateTime } from "@/lib/format";
import type { AppNotification, CaseSummary, OverdueResponse, StepStatus } from "@/lib/types";

const NOTIF: Record<AppNotification["type"], [string, Tone]> = {
  escalation: ["Эскалация", "urgent"],
  overdue: ["Просрочено", "crit"],
  due_soon: ["Скоро срок", "warn"],
  unlocked: ["Шаг открыт", "ok"],
  red_flag: ["Красный флаг", "urgent"],
};

export default function CuratorDashboard() {
  const { ready, role, setRole, settings } = useApp();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [overdue, setOverdue] = useState<OverdueResponse | null>(null);
  const [notes, setNotes] = useState<{ unread: number; items: AppNotification[] } | null>(null);
  const [openHelp, setOpenHelp] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  usePageMeta("Дела и сроки", "Все семьи: проверка планов, просрочки, эскалации");

  useEffect(() => {
    if (ready && role !== "curator") setRole("curator");
  }, [ready, role, setRole]);

  const load = useCallback(async () => {
    try {
      const [c, o, n] = await Promise.all([
        api<{ cases: CaseSummary[] }>("curator", "/curator/cases"),
        api<OverdueResponse>("curator", "/curator/overdue"),
        api<{ unread: number; items: AppNotification[] }>("curator", "/curator/notifications"),
      ]);
      setCases(c.cases);
      setOverdue(o);
      setNotes(n);
      setVersion((v) => v + 1);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load, settings?.today]);

  async function setStatus(stepId: number, status: StepStatus) {
    try {
      await api("curator", `/steps/${stepId}`, { method: "PATCH", body: { status } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function markRead(ids?: number[]) {
    await api("curator", "/curator/notifications/read", { method: "POST", body: { ids: ids ?? null } });
    await load();
  }

  async function resetDemo() {
    if (!confirm("Сбросить демо? Все кейсы вернутся в исходное состояние, дата — 30.09.2026.")) return;
    await api("curator", "/demo/reset", { method: "POST" });
    location.reload();
  }

  const [preparing, setPreparing] = useState(false);
  async function prepareDemo() {
    if (!confirm("Подготовить демо? Все кейсы будут сброшены, у семей 2 и 3 появятся подтверждённые планы. Займёт до 30 секунд.")) return;
    setPreparing(true);
    try {
      await api("curator", "/demo/prepare", { method: "POST", body: {} });
      location.reload();
    } catch (e) {
      setError((e as Error).message);
      setPreparing(false);
    }
  }

  const awaiting = cases?.filter((c) => c.status === "awaiting_curator").length ?? 0;
  const alerts = cases?.filter((c) => c.alert).length ?? 0;

  return (
    <div className="stack-lg">
      <div className="row wrap gap-sm" style={{ justifyContent: "flex-end" }}>
        {settings?.demo_mode && (
          <>
            <button className="btn btn-sm btn-demo" disabled={preparing} onClick={prepareDemo}>
              {preparing ? "Готовим планы…" : "Демо: готовые планы (семьи 2 и 3)"}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={preparing} onClick={resetDemo}>
              Сбросить демо
            </button>
          </>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="stats">
        <div className={`stat ${alerts ? "crit" : ""}`}>
          <b>{alerts}</b>
          <span>красных флагов</span>
        </div>
        <div className={`stat ${awaiting ? "warn" : ""}`}>
          <b>{awaiting}</b>
          <span>планов ждут подтверждения</span>
        </div>
        <div className={`stat ${overdue?.overdue_count ? "crit" : ""}`}>
          <b>{overdue?.overdue_count ?? "—"}</b>
          <span>просрочено</span>
        </div>
        <div className={`stat ${overdue?.escalated_count ? "crit" : ""}`}>
          <b>{overdue?.escalated_count ?? "—"}</b>
          <span>эскалаций</span>
        </div>
        <div className={`stat ${overdue?.due_soon.length ? "warn" : ""}`}>
          <b>{overdue?.due_soon.length ?? "—"}</b>
          <span>скоро срок</span>
        </div>
      </section>

      <div className="grid-2 align-start">
        <section className="card">
          <h2>Дела</h2>
          {!cases && <div className="muted">Загрузка…</div>}
          {cases && (
            <ul className="case-list">
              {cases.map((c) => (
                <li key={c.id} className={`case-row ${c.alert ? "case-alert" : ""}`}>
                  <div className="case-main">
                    <div className="case-title">
                      {c.child_alias} {c.alert && <AlertBadge />} <CaseStatusBadge status={c.status} />
                    </div>
                    <div className="row gap-xs wrap mt-xs">
                      <StageBadge stage={c.stage} />
                      {!!c.escalated && <EscalatedBadge />}
                      {!!c.overdue && <span className="chip-s tone-crit">просрочено: {c.overdue}</span>}
                      {!!c.due_soon && <span className="chip-s tone-warn">скоро срок: {c.due_soon}</span>}
                      {!!c.steps_locked && <span className="chip-s tone-muted">🔒 {c.steps_locked}</span>}
                      {!!c.blockers && <span className="chip-s tone-warn">⛔ {c.blockers}</span>}
                    </div>
                    <div className="muted small mt-xs">
                      {c.age_text}, {c.city} · {c.handling_mode === "curator" ? "ведёт куратор" : "ведёт система"}
                      {c.steps_total > 0 && ` · выполнено ${c.steps_done} из ${c.steps_total}`}
                    </div>
                  </div>
                  <Link className={`btn ${c.status === "awaiting_curator" ? "btn-primary" : ""}`} href={`/curator/cases/${c.id}`}>
                    {c.status === "awaiting_curator" ? "Проверить" : "Открыть"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>
              Уведомления {notes && notes.unread > 0 && <span className="chip-s tone-urgent">{notes.unread}</span>}
            </h2>
            {notes && notes.unread > 0 && (
              <button className="link-btn small" onClick={() => markRead()}>
                прочитать все
              </button>
            )}
          </div>
          {notes && notes.items.length === 0 && <p className="muted small">Пока нет. Уведомления появляются при просрочке, эскалации, приближении срока и открытии шага.</p>}
          <ul className="notif-list">
            {notes?.items.slice(0, 12).map((n) => (
              <li key={n.id} className={n.read ? "read" : ""}>
                <Chip tone={NOTIF[n.type][1]}>{NOTIF[n.type][0]}</Chip>
                <div>
                  <Link href={`/curator/cases/${n.case_id}`} onClick={() => !n.read && markRead([n.id])}>
                    {n.message}
                  </Link>
                  <div className="muted small">{fmtDateTime(n.created_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

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
                            <EscalatedBadge />
                          </div>
                        )}
                        <button className="link-btn small" onClick={() => setOpenHelp(openHelp === s.id ? null : s.id)}>
                          {openHelp === s.id ? "скрыть" : "помощь семье"}
                        </button>
                      </td>
                      <td>
                        <select className="input input-sm" value={s.status} onChange={(e) => setStatus(s.id, e.target.value as StepStatus)}>
                          {(["todo", "in_progress", "done"] as StepStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {STATUS_LABEL[st]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    {openHelp === s.id && (
                      <tr className="row-notice">
                        <td colSpan={6}>
                          <HelpPanel stepId={s.id} role="curator" version={version} />
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

      {overdue && overdue.due_soon.length > 0 && (
        <section className="card">
          <h2>Скоро срок</h2>
          <ul className="case-list">
            {overdue.due_soon.map((s) => (
              <li key={s.id} className="case-row">
                <div className="case-main">
                  <div className="case-title">
                    {s.title} <span className="chip-s tone-warn">осталось {s.days_to_due} дн.</span>
                  </div>
                  <div className="muted small">
                    {s.case_alias} · срок {fmtDate(s.due_date)} · не хватает документов: {s.docs_missing}
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
                    {s.case_alias} · срок {fmtDate(s.due_date)}
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
