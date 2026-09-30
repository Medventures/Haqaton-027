"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import type { GovSource } from "@/lib/types";

export default function ConsentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ready, role, setRole, rememberCase } = useApp();
  const [sources, setSources] = useState<GovSource[]>([]);
  const [notRequested, setNotRequested] = useState("");
  const [agree, setAgree] = useState(false);
  usePageMeta("Согласие на получение документов", "Только сведения, нужные для плана");

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
    if (ready) rememberCase(Number(id));
  }, [ready, role, setRole, rememberCase, id]);

  useEffect(() => {
    api<{ sources: GovSource[]; not_requested: string }>("parent", "/gov/sources").then((r) => {
      setSources(r.sources);
      setNotRequested(r.not_requested);
    });
  }, []);

  return (
    <div className="row" style={{ justifyContent: "center", paddingTop: 8 }}>
      <div className="stack" style={{ width: 760, maxWidth: "100%", gap: 18 }}>
        <h1 className="h-page">Разрешите получить документы ребёнка</h1>
        <p className="lead">Мы запросим только сведения, нужные для плана. Доступ можно отозвать в любой момент.</p>
        <div className="table-card">
          {sources.map((s) => (
            <div key={s.key} className="row" style={{ gap: 16, alignItems: "flex-start", padding: "16px 20px", borderBottom: "1px solid var(--line-soft)" }}>
              <span className="chip-s tone-accent" style={{ minWidth: 96, justifyContent: "center", borderRadius: 8 }}>
                {s.short}
              </span>
              <div className="stack-sm" style={{ gap: 3 }}>
                <b style={{ fontSize: 15, fontWeight: 600 }}>{s.name}</b>
                <span className="small muted">{s.what}</span>
              </div>
            </div>
          ))}
          <div className="row" style={{ gap: 16, alignItems: "flex-start", padding: "16px 20px", background: "var(--surface-2)" }}>
            <span className="chip-s tone-muted" style={{ minWidth: 96, justifyContent: "center", borderRadius: 8 }}>
              Не запрашиваем
            </span>
            <span className="small muted">{notRequested}</span>
          </div>
        </div>
        <label className="card row" style={{ gap: 12, alignItems: "flex-start", padding: 16, borderRadius: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)}
            style={{ width: 22, height: 22, margin: 0, flexShrink: 0, accentColor: "var(--accent)" }} />
          <span style={{ fontSize: 14.5 }}>
            Я, законный представитель ребёнка, согласен(на) на получение этих сведений из государственных систем для составления
            плана
          </span>
        </label>
        <div>
          <button className="btn btn-primary btn-lg" disabled={!agree} onClick={() => router.push(`/parent/cases/${id}/sync`)}>
            Разрешить доступ и получить документы
          </button>
        </div>
        <span className="hint">Демо: реальные запросы в госсистемы не выполняются, сведения синтетические.</span>
      </div>
    </div>
  );
}
