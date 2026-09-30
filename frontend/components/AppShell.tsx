"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { STAGE_LABEL, fmtDate } from "@/lib/format";
import { remindersFor } from "@/lib/reminders";
import type { CaseView, Role, Stage } from "@/lib/types";

const STAGES: Stage[] = ["early", "correction", "socialization"];
const STAGE_AGES: Record<Stage, string> = { early: "до 3 лет", correction: "3–7 лет", socialization: "7–18 лет" };

function Icon({ name }: { name: "plan" | "bell" | "doc" | "chat" | "list" | "case" | "handoff" | "home" }) {
  const p = {
    plan: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
      </>
    ),
    bell: (
      <>
        <path d="M6 16V11a6 6 0 0112 0v5l2 2H4l2-2z" />
        <path d="M10 21h4" />
      </>
    ),
    doc: (
      <>
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5" />
      </>
    ),
    chat: <path d="M4 5h16v11H9l-5 4z" />,
    list: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </>
    ),
    case: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
      </>
    ),
    handoff: (
      <>
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </>
    ),
    home: <path d="M4 11l8-7 8 7v9H4z" />,
  }[name];
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {p}
    </svg>
  );
}

function NavLink({ href, icon, label, active, badge, urgent }: {
  href: string; icon: Parameters<typeof Icon>[0]["name"]; label: string; active: boolean; badge?: number; urgent?: boolean;
}) {
  return (
    <Link href={href} className={`nav-item ${active ? "active" : ""}`}>
      <Icon name={icon} />
      <span className="grow">{label}</span>
      {!!badge && <span className={`nav-badge ${urgent ? "urgent" : ""}`}>{badge}</span>}
    </Link>
  );
}

function DemoDate() {
  const { settings, refreshSettings, refreshShell } = useApp();
  const [busy, setBusy] = useState(false);
  if (!settings?.demo_mode) return null;
  async function send(body: object) {
    setBusy(true);
    try {
      await api("curator", "/settings/demo-today", { method: "POST", body });
      await refreshSettings();
      refreshShell();
    } finally {
      setBusy(false);
    }
  }
  const atSeed = settings.today === settings.seed_today;
  return (
    <div className="segmented" aria-label="Дата демо">
      <span>Демо</span>
      <button className={atSeed ? "active" : ""} disabled={busy} onClick={() => send({ date: settings.seed_today })}>
        Сегодня
      </button>
      {[1, 7, 14].map((d) => (
        <button key={d} disabled={busy} onClick={() => send({ shift_days: d })}>
          +{d} дн.
        </button>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { page, role, setRole, settings, ready, shellVersion } = useApp();
  const m = pathname.match(/^\/(parent|curator)\/cases\/(\d+)/);
  const caseId = m ? Number(m[2]) : null;
  const caseRole: Role = m?.[1] === "curator" ? "curator" : "parent";
  const [c, setCase] = useState<CaseView | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!ready || caseId === null) {
      setCase(null);
      return;
    }
    api<CaseView>(caseRole, `/cases/${caseId}`).then(setCase).catch(() => setCase(null));
  }, [ready, caseId, caseRole, pathname, shellVersion, settings?.today]);

  useEffect(() => {
    if (!ready || role !== "curator") return;
    api<{ unread: number }>("curator", "/curator/notifications").then((r) => setUnread(r.unread)).catch(() => {});
  }, [ready, role, pathname, shellVersion, settings?.today]);

  function switchRole(r: Role) {
    if (r === role) return;
    setRole(r);
    router.push(r === "curator" ? "/curator" : "/parent");
  }

  const stageIdx = c ? STAGES.indexOf(c.stage) : -1;
  const parentReminders = c && c.plan_visible ? remindersFor(c).filter((r) => r.tone === "crit" || r.tone === "warn").length : c?.alert ? 1 : 0;
  const is = (href: string) => pathname === href;

  return (
    <div className="shell">
      <aside className="sidebar no-print">
        <Link href="/" className="brand" aria-label="AqylRoute AI — на главную">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aqylroute-logo.svg" alt="AqylRoute AI" className="brand-logo" />
        </Link>

        {c && (
          <div className="child-card">
            <b>{c.child_alias}</b>
            <span>
              {c.age_text} · {c.city}
            </span>
          </div>
        )}

        <nav className="side-nav" aria-label="Разделы">
          <span className="side-label">Разделы</span>
          {m?.[1] === "parent" && c ? (
            <>
              <NavLink href={`/parent/cases/${c.id}`} icon="plan" label="План" active={is(`/parent/cases/${c.id}`)} />
              <NavLink href={`/parent/cases/${c.id}/reminders`} icon="bell" label="Напоминания"
                active={is(`/parent/cases/${c.id}/reminders`)} badge={parentReminders} urgent={c.alert || c.overdue > 0} />
              <NavLink href={`/parent/cases/${c.id}/documents`} icon="doc" label="Документы" active={is(`/parent/cases/${c.id}/documents`)} />
              {!c.summary_confirmed && (
                <NavLink href={`/parent/cases/${c.id}/interview`} icon="chat" label="Интервью" active={is(`/parent/cases/${c.id}/interview`)} />
              )}
              <NavLink href="/parent" icon="list" label="Все кейсы" active={false} />
            </>
          ) : role === "curator" || m?.[1] === "curator" ? (
            <>
              <NavLink href="/curator" icon="list" label="Дела и сроки" active={is("/curator")} />
              <NavLink href="/curator/notifications" icon="bell" label="Уведомления" active={is("/curator/notifications")} badge={unread} urgent />
              {c && (
                <>
                  <NavLink href={`/curator/cases/${c.id}`} icon="case" label="Карточка дела" active={is(`/curator/cases/${c.id}`)} />
                  {c.status === "confirmed" && (
                    <NavLink href={`/curator/cases/${c.id}/handoff`} icon="handoff" label="Передача дела" active={is(`/curator/cases/${c.id}/handoff`)} />
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <NavLink href="/" icon="home" label="Главная" active={is("/")} />
              <NavLink href="/parent" icon="list" label="Кабинет родителя" active={is("/parent")} />
            </>
          )}
        </nav>

        {c && (
          <nav className="side-nav side-stages" aria-label="Этапы маршрута">
            <span className="side-label">Этапы маршрута</span>
            {STAGES.map((s, i) => (
              <div key={s} className={`stage-row ${i < stageIdx ? "past" : i === stageIdx ? "current" : ""}`}>
                <span className="stage-dot">{i < stageIdx ? "✓" : i + 1}</span>
                <span>
                  {STAGE_LABEL[s]}
                  <span className="hint" style={{ display: "block" }}>
                    {STAGE_AGES[s]}
                  </span>
                </span>
              </div>
            ))}
          </nav>
        )}

        <div className="side-foot">Мы не ставим диагнозов и не назначаем лечение. План проверяет куратор.</div>
      </aside>

      <div className="main-col">
        <header className="topbar no-print">
          <div className="topbar-title">
            <b>{page.title}</b>
            {page.subtitle && <span>{page.subtitle}</span>}
          </div>
          <div className="topbar-right">
            {settings && (
              <span className="today">
                Сегодня <strong>{fmtDate(settings.today)}</strong>
              </span>
            )}
            {role === "curator" && <DemoDate />}
            {settings && (
              <span className={`chip-s ${settings.llm_mode === "openai" ? "tone-accent" : "tone-muted"}`}
                title={settings.llm_mode === "openai" ? "Вопросы и пояснения формирует модель OpenAI" : "Ключ OpenAI не задан: шаблоны и правила"}>
                AI: {settings.llm_mode === "openai" ? settings.model : "демо-режим"}
              </span>
            )}
            <div className="segmented" role="group" aria-label="Роль">
              <button className={role === "parent" ? "active" : ""} onClick={() => switchRole("parent")}>
                Родитель
              </button>
              <button className={role === "curator" ? "active" : ""} onClick={() => switchRole("curator")}>
                Куратор
              </button>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="content-foot">Все данные синтетические. Система не ставит диагнозы и не даёт медицинских рекомендаций.</footer>
      </div>
    </div>
  );
}
