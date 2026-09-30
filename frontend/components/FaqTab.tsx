"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Faq } from "@/lib/types";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Ready-made questions as compact chips; a click sends the question to AqylRoute AI. Filtered on the client. */
export function FaqTab({ caseId, disabled, onPick }: { caseId: number; disabled: boolean; onPick: (q: string) => void }) {
  const [faq, setFaq] = useState<Faq | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setFaq(null);
    api<Faq>("parent", `/faq?case_id=${caseId}`).then(setFaq).catch(() => setError(true));
  }, [caseId]);

  const q = norm(query.trim());
  const general = useMemo(() => faq?.general.filter((i) => !q || norm(i.q).includes(q)) ?? [], [faq, q]);
  const byStep = useMemo(
    () =>
      (faq?.by_step ?? [])
        .map((b) => ({ ...b, items: !q || norm(b.title).includes(q) ? b.items : b.items.filter((i) => norm(i.q).includes(q)) }))
        .filter((b) => b.items.length > 0),
    [faq, q],
  );

  return (
    <div className="stack-sm faq-chips" style={{ gap: 10 }}>
      <input className="input input-sm" type="search" value={query} placeholder="Поиск по вопросам" aria-label="Поиск по вопросам"
        onChange={(e) => setQuery(e.target.value)} />
      {error && <span className="hint">Не удалось загрузить вопросы.</span>}
      {!faq && !error && <span className="hint">Загрузка…</span>}

      {general.length > 0 && (
        <section className="stack-sm" style={{ gap: 6 }}>
          <span className="faq-head">Частые вопросы</span>
          <div className="chip-row">
            {general.map((i) => (
              <button key={i.q} className="q-chip" disabled={disabled} onClick={() => onPick(i.q)}>
                {i.q}
              </button>
            ))}
          </div>
        </section>
      )}

      {byStep.map((b) => (
        <section key={b.step_id} className="stack-sm" style={{ gap: 6 }}>
          <span className="faq-head">{b.title}</span>
          <div className="chip-row">
            {b.items.map((i) => (
              <button key={i.q} className="q-chip" disabled={disabled} onClick={() => onPick(`${i.q} (шаг «${b.title}»)`)}>
                {i.q}
              </button>
            ))}
          </div>
        </section>
      ))}
      {faq && q && general.length === 0 && byStep.length === 0 && <span className="small muted">Ничего не нашлось — задайте вопрос выше.</span>}
    </div>
  );
}
