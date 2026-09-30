"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import type { CaseSummary, CaseView } from "@/lib/types";

/** Вход через eGov — имитация для демо: код и ключ никуда не отправляются, реальные данные не запрашиваются. */
export default function EgovLoginPage() {
  const router = useRouter();
  const { ready, setRole, rememberCase } = useApp();
  const [mode, setMode] = useState<"sms" | "eds">("sms");
  const [code, setCode] = useState("");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePageMeta("Вход через eGov", "Демо: вход имитируется");

  useEffect(() => {
    if (!ready) return;
    setRole("parent");
    api<{ cases: CaseSummary[] }>("parent", "/cases")
      .then((r) => {
        setCases(r.cases);
        const two = r.cases.find((c) => c.scenario === "2") ?? r.cases[0];
        if (two) setCaseId((id) => id ?? two.id);
      })
      .catch((e) => setError((e as Error).message));
  }, [ready, setRole]);

  async function login() {
    if (caseId === null) return;
    setBusy(true);
    try {
      rememberCase(caseId);
      const c = await api<CaseView>("parent", `/cases/${caseId}`);
      if (c.summary_confirmed) router.push(`/parent/cases/${caseId}`);
      else if (c.interview_answered > 0) router.push(`/parent/cases/${caseId}/interview`);
      else router.push(`/parent/cases/${caseId}/consent`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const smsOk = code.replace(/\D/g, "").length >= 4;

  return (
    <div className="row" style={{ justifyContent: "center", paddingTop: 24 }}>
      <div className="card stack" style={{ width: 460, maxWidth: "100%", padding: 32, gap: 20, borderRadius: 20 }}>
        <div className="stack-sm">
          <h1 className="h-page" style={{ fontSize: 24 }}>
            Вход через eGov
          </h1>
          <span className="hint">Прототип: вход имитируется, реальные данные не запрашиваются</span>
        </div>

        <div className="segmented" style={{ display: "flex" }}>
          <button className={mode === "sms" ? "active" : ""} style={{ flex: 1 }} onClick={() => setMode("sms")}>
            SMS-код
          </button>
          <button className={mode === "eds" ? "active" : ""} style={{ flex: 1 }} onClick={() => setMode("eds")}>
            ЭЦП
          </button>
        </div>

        {mode === "sms" ? (
          <div className="stack" style={{ gap: 14 }}>
            <span style={{ fontSize: 14, color: "var(--text-2)" }}>Код отправлен на номер +7 7•• ••• 45 12, привязанный к eGov</span>
            <label className="field">
              <span>Код из SMS</span>
              <input className="input" inputMode="numeric" maxLength={6} placeholder="4 цифры" value={code}
                style={{ fontSize: 18, letterSpacing: 4 }} onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && smsOk && login()} />
            </label>
            <button className="btn btn-primary btn-lg" disabled={!smsOk || busy || caseId === null} onClick={login}>
              Войти
            </button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            <span style={{ fontSize: 14, color: "var(--text-2)" }}>Выберите ключ ЭЦП на этом компьютере</span>
            <button className="btn btn-primary btn-lg" disabled={busy || caseId === null} onClick={login}>
              Выбрать ключ и войти
            </button>
          </div>
        )}

        {cases.length > 0 && (
          <div className="stack-sm" style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 14 }}>
            <span className="hint">Демо: под какой синтетической семьёй войти</span>
            <div className="segmented" style={{ display: "flex" }}>
              {cases.map((c) => (
                <button key={c.id} className={caseId === c.id ? "active" : ""} style={{ flex: 1 }} onClick={() => setCaseId(c.id)}>
                  {c.child_alias}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
      </div>
    </div>
  );
}
