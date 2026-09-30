"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Chip } from "@/components/Badges";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import type { GovSync } from "@/lib/types";

const COLS = "minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.6fr)";

export default function SyncPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, role, setRole, rememberCase, refreshShell } = useApp();
  const [data, setData] = useState<GovSync | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  usePageMeta("Документы из госсистем", "Демо: запрос имитируется, сведения синтетические");

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);

  useEffect(() => {
    if (!ready) return;
    rememberCase(Number(id));
    api<GovSync>("parent", `/cases/${id}/gov-sync`, { method: "POST" })
      .then((r) => {
        setData(r);
        refreshShell();
      })
      .catch((e) => setError((e as Error).message));
  }, [ready, id, rememberCase, refreshShell]);

  useEffect(() => {
    if (!data || step > data.sources.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), 650);
    return () => clearTimeout(t);
  }, [data, step]);

  if (error) return <div className="alert alert-error">{error}</div>;
  const total = data?.sources.length ?? 4;
  const done = !!data && step > total;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr)", gap: 24, alignItems: "start" }} className="sync-grid">
        <div className="card stack" style={{ gap: 14 }}>
          <b>Запрос в госсистемы</b>
          {(data?.sources ?? []).map((s, i) => {
            const st = step > i + 1 ? "ok" : step === i + 1 ? "load" : "wait";
            return (
              <div key={s.key} className="row between gap-sm">
                <span style={{ fontSize: 14 }}>{s.name}</span>
                <Chip tone={st === "ok" ? "ok" : st === "load" ? "info" : "muted"}>
                  {st === "ok" ? "получено" : st === "load" ? "запрос…" : "в очереди"}
                </Chip>
              </div>
            );
          })}
          <div className="progress">
            <div className="progress-fill" style={{ width: `${(Math.min(step, total + 1) / (total + 1)) * 100}%` }} />
          </div>
        </div>

        {!done ? (
          <div className="card" style={{ border: "1px dashed var(--line-input)", padding: 40, textAlign: "center", color: "var(--muted)" }}>
            Получаем документы… Обычно это занимает несколько секунд.
          </div>
        ) : (
          <div className="stack">
            <div className="table-card">
              <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "12px 20px", background: "var(--surface-2)",
                borderBottom: "1px solid var(--line-soft)", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
                <span>Документ</span>
                <span>Источник</span>
                <span>Выдан</span>
                <span>Срок действия</span>
              </div>
              {data!.rows.map((r) => (
                <div key={r.doc} style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "14px 20px",
                  borderBottom: "1px solid var(--line-soft)", alignItems: "start" }}>
                  <div className="stack-sm" style={{ gap: 3 }}>
                    <b style={{ fontSize: 14.5, fontWeight: 600 }}>{r.doc}</b>
                    <span className="hint">{r.detail}</span>
                  </div>
                  <span>
                    <Chip tone={r.source === "Вручную" ? "muted" : "accent"}>{r.source}</Chip>
                  </span>
                  <span className="small">{r.issued}</span>
                  <span className={`small ${r.tone === "crit" ? "text-danger" : r.tone === "warn" ? "text-warn" : r.tone === "ok" ? "text-ok" : "muted"}`}
                    style={{ fontWeight: 500 }}>
                    {r.validity}
                  </span>
                </div>
              ))}
            </div>
            <div className="row between wrap gap-sm">
              <span className="small muted">Заключение врача добавляется вручную — медицинские данные мы не запрашиваем.</span>
              <Link href={`/parent/cases/${id}/interview`} className="btn btn-primary btn-lg">
                Всё верно — к вопросам
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
