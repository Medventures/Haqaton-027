"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Chip, type Tone } from "@/components/Badges";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import { fmtDateTime } from "@/lib/format";
import type { AppNotification } from "@/lib/types";

const TYPE: Record<AppNotification["type"], [string, Tone]> = {
  escalation: ["Эскалация", "urgent"],
  overdue: ["Просрочено", "crit"],
  due_soon: ["Скоро срок", "warn"],
  unlocked: ["Шаг открыт", "ok"],
  red_flag: ["Красный флаг", "urgent"],
};

export default function CuratorNotificationsPage() {
  const { ready, role, setRole, settings, refreshShell } = useApp();
  const [data, setData] = useState<{ unread: number; items: AppNotification[] } | null>(null);
  usePageMeta("Уведомления", "Просрочки, эскалации, скорые сроки, открытые шаги и красные флаги");

  useEffect(() => {
    if (ready && role !== "curator") setRole("curator");
  }, [ready, role, setRole]);

  const load = useCallback(async () => {
    setData(await api<{ unread: number; items: AppNotification[] }>("curator", "/curator/notifications"));
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load, settings?.today]);

  async function markRead(ids?: number[]) {
    await api("curator", "/curator/notifications/read", { method: "POST", body: { ids: ids ?? null } });
    await load();
    refreshShell();
  }

  if (!data) return <div className="hint">Загрузка…</div>;

  return (
    <div className="stack" style={{ maxWidth: 900, gap: 12 }}>
      <div className="row between wrap gap-sm">
        <span className="small muted">Непрочитанных: {data.unread}. Уведомления создаются автоматически и не дублируются.</span>
        {data.unread > 0 && (
          <button className="btn btn-sm" onClick={() => markRead()}>
            Отметить все прочитанными
          </button>
        )}
      </div>
      {data.items.length === 0 && <div className="card">Уведомлений пока нет.</div>}
      {data.items.map((n) => (
        <div key={n.id} className={`reminder ${TYPE[n.type][1] === "crit" || TYPE[n.type][1] === "urgent" ? "crit" : TYPE[n.type][1] === "warn" ? "warn" : ""}`}
          style={{ opacity: n.read ? 0.6 : 1 }}>
          <div className="row between wrap gap-sm">
            <Chip tone={TYPE[n.type][1]}>{TYPE[n.type][0]}</Chip>
            <span className="hint">
              {n.case_alias} · {fmtDateTime(n.created_at)}
            </span>
          </div>
          <span className="text">{n.message}</span>
          <div className="row gap-sm">
            <Link href={`/curator/cases/${n.case_id}`} className="link-btn" onClick={() => !n.read && markRead([n.id])}>
              Открыть дело
            </Link>
            {!n.read && (
              <button className="link-btn" onClick={() => markRead([n.id])}>
                Прочитано
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
