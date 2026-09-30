"use client";

import { useCallback, useEffect, useState } from "react";
import { Chip } from "./Badges";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { FolderDoc, Role } from "@/lib/types";

/** Единая папка документов: отметил один раз — обновились все шаги и панель помощи. */
export function DocFolder({ caseId, role, onChange, compact }: { caseId: number; role: Role; onChange?: () => void; compact?: boolean }) {
  const [docs, setDocs] = useState<FolderDoc[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDocs((await api<{ documents: FolderDoc[] }>(role, `/cases/${caseId}/documents`)).documents);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [caseId, role]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(d: FolderDoc, have: boolean) {
    setBusy(d.doc_type);
    try {
      await api(role, `/cases/${caseId}/documents/${d.doc_type}`, { method: "PATCH", body: { have } });
      await load();
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!docs) return <div className="hint">Загрузка…</div>;

  if (compact) {
    const shown = docs.filter((d) => d.have || d.expired || (d.used_in?.length ?? 0) > 0);
    return (
      <ul className="doc-checks">
        {shown.map((d) => (
          <li key={d.doc_type}>
            <label className={`doc-check ${d.have ? "have" : ""}`}>
              <input type="checkbox" checked={d.have} disabled={busy === d.doc_type} onChange={(e) => toggle(d, e.target.checked)} />
              <span>
                {d.name}
                {d.expired && <span className="pill pill-warn pill-xs">истёк</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    );
  }

  const have = docs.filter((d) => d.have).length;
  const sorted = [...docs].sort(
    (a, b) => Number((b.used_in?.length ?? 0) > 0) - Number((a.used_in?.length ?? 0) > 0) || Number(b.have) - Number(a.have),
  );

  return (
    <div className="stack">
      <div className="stats">
        <div className="stat ok">
          <b>{have}</b>
          <span>документов есть</span>
        </div>
        <div className={`stat ${docs.some((d) => d.expired) ? "warn" : ""}`}>
          <b>{docs.filter((d) => d.expired).length}</b>
          <span>с истёкшим сроком</span>
        </div>
        <div className="stat">
          <b>{docs.filter((d) => !d.have && (d.used_in?.length ?? 0) > 0).length}</b>
          <span>нужны для плана, пока нет</span>
        </div>
      </div>
      <div className="table-card">
        <div className="doc-table-row head">
          <span />
          <span>Документ</span>
          <span>Статус</span>
          <span>Срок действия</span>
        </div>
        {sorted.map((d) => (
          <label key={d.doc_type} className="doc-table-row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={d.have} disabled={busy === d.doc_type} onChange={(e) => toggle(d, e.target.checked)}
              aria-label={d.name} />
            <span className="doc-name">
              <b>{d.name}</b>
              <span>
                {d.used_in?.length ? `Нужен: ${d.used_in.join(", ")}` : "Сейчас в плане не нужен"}
                {d.note ? ` · ${d.note}` : ""}
              </span>
            </span>
            <span>
              {d.have ? <Chip tone="ok">Есть</Chip> : d.expired ? <Chip tone="crit">Истёк</Chip> : <Chip tone="muted">Нет</Chip>}
            </span>
            <span className={`small ${d.expired ? "text-danger" : ""}`}>
              {d.valid_until ? `до ${fmtDate(d.valid_until)}` : d.issued_at ? `выдан ${fmtDate(d.issued_at)}` : "—"}
            </span>
          </label>
        ))}
      </div>
      <span className="hint">Отметьте документ один раз — он учтётся во всех шагах маршрута и в чек-листах.</span>
    </div>
  );
}
