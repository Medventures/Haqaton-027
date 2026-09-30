"use client";

import { useCallback, useEffect, useState } from "react";
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
  if (!docs) return <div className="muted small">Загрузка…</div>;
  const have = docs.filter((d) => d.have).length;
  const shown = compact ? docs.filter((d) => d.have || d.expired || (d.used_in?.length ?? 0) > 0) : docs;

  return (
    <div className="folder">
      <p className="muted small">
        Есть {have} из {docs.length}. Отметка действует во всех шагах маршрута — документы не нужно собирать повторно.
      </p>
      <ul className="folder-list">
        {shown.map((d) => (
          <li key={d.doc_type} className={d.have ? "have" : d.expired ? "expired" : ""}>
            <label className="doc-check">
              <input type="checkbox" checked={d.have} disabled={busy === d.doc_type} onChange={(e) => toggle(d, e.target.checked)} />
              <span>
                <b>{d.name}</b>
                {d.expired && <span className="pill pill-warn pill-xs">истёк {d.valid_until ? fmtDate(d.valid_until) : ""}</span>}
                {d.have && d.valid_until && <span className="muted small"> · действует до {fmtDate(d.valid_until)}</span>}
                {d.note && <span className="muted small"> · {d.note}</span>}
                {!!d.used_in?.length && <span className="muted small"> · нужен: {d.used_in.join(", ")}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
