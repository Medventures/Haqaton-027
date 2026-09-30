"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { fmtDate } from "@/lib/format";

export function DemoDateControl({ onChange }: { onChange: () => void }) {
  const { settings, refreshSettings } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: object) {
    setBusy(true);
    setError(null);
    try {
      await api("curator", "/settings/demo-today", { method: "POST", body });
      await refreshSettings();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !settings.demo_mode) return null;

  return (
    <div className="card card-tight demo-date no-print">
      <div className="row between wrap gap-sm">
        <div>
          <h3 className="h-small">Дата демо</h3>
          <div className="muted small">
            Сроки и просрочки считаются от этой даты. Эскалация — при просрочке больше {settings.escalation_after_days} дн.
          </div>
        </div>
        <div className="row gap-xs wrap">
          <input
            type="date"
            className="input input-sm"
            value={settings.today}
            disabled={busy}
            onChange={(e) => e.target.value && send({ date: e.target.value })}
            aria-label="Дата демо"
          />
          {[1, 7, 14].map((d) => (
            <button key={d} className="btn btn-sm" disabled={busy} onClick={() => send({ shift_days: d })}>
              +{d} {d === 1 ? "день" : "дней"}
            </button>
          ))}
          <button
            className="btn btn-sm btn-ghost"
            disabled={busy || settings.today === settings.seed_today}
            onClick={() => send({ date: settings.seed_today })}
            title="Дата, от которой посчитаны синтетические кейсы"
          >
            Сброс ({fmtDate(settings.seed_today)})
          </button>
        </div>
      </div>
      {error && <div className="alert alert-error mt-sm">{error}</div>}
    </div>
  );
}
