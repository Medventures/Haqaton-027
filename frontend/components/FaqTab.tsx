"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Faq, FaqItem } from "@/lib/types";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

function match(item: FaqItem, q: string): boolean {
  return !q || norm(item.q).includes(q) || norm(item.a).includes(q);
}

function QA({ item }: { item: FaqItem }) {
  return (
    <details className="faq-item">
      <summary>{item.q}</summary>
      <p>{item.a}</p>
    </details>
  );
}

/** «Вопросы»: static general answers and per-step answers from the catalog (no LLM), filtered on the client. */
export function FaqTab({ caseId, onNavigate, onAskLuna, children }: {
  caseId: number;
  onNavigate: () => void;
  onAskLuna: (query: string) => void;
  children: React.ReactNode;
}) {
  const [faq, setFaq] = useState<Faq | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setFaq(null);
    api<Faq>("parent", `/faq?case_id=${caseId}`).then(setFaq).catch(() => setError(true));
  }, [caseId]);

  const q = norm(query.trim());
  const general = useMemo(() => faq?.general.filter((i) => match(i, q)) ?? [], [faq, q]);
  const byStep = useMemo(
    () =>
      (faq?.by_step ?? [])
        .map((b) => ({ ...b, items: q && norm(b.title).includes(q) ? b.items : b.items.filter((i) => match(i, q)) }))
        .filter((b) => b.items.length > 0),
    [faq, q],
  );
  const nothing = !!faq && general.length === 0 && byStep.length === 0;

  return (
    <div className="stack-sm" style={{ gap: 12 }}>
      <input className="input" type="search" value={query} placeholder="Поиск по вопросам" aria-label="Поиск по вопросам"
        onChange={(e) => setQuery(e.target.value)} />
      {error && <span className="hint">Не удалось загрузить вопросы.</span>}
      {!faq && !error && <span className="hint">Загрузка…</span>}

      {general.length > 0 && (
        <section className="stack-sm" style={{ gap: 6 }}>
          <span className="urgent-label">Общие</span>
          {general.map((i) => (
            <QA key={i.q} item={i} />
          ))}
        </section>
      )}

      {byStep.length > 0 && (
        <section className="stack-sm" style={{ gap: 6 }}>
          <span className="urgent-label">По вашим шагам</span>
          {byStep.map((b) => (
            <details key={b.step_id} className="faq-step" open={!!q}>
              <summary>{b.title}</summary>
              <div className="stack-sm" style={{ gap: 6 }}>
                {b.items.map((i) => (
                  <QA key={i.q} item={i} />
                ))}
                <Link href={`/parent/cases/${caseId}#step-${b.step_id}`} className="link-btn small" onClick={onNavigate}>
                  Открыть шаг
                </Link>
              </div>
            </details>
          ))}
        </section>
      )}
      {faq && faq.by_step.length === 0 && !q && (
        <span className="hint">Вопросы по шагам появятся, когда куратор подтвердит план.</span>
      )}

      {nothing && (
        <div className="stack-sm" style={{ gap: 6 }}>
          <span className="small muted">Ничего не нашлось.</span>
          <button className="btn btn-sm" onClick={() => onAskLuna(query.trim())}>
            Спросить Луну
          </button>
        </div>
      )}

      <section className="stack-sm faq-luna" style={{ gap: 10 }}>
        <span className="urgent-label">Не нашли ответ? Спросите Луну</span>
        {children}
      </section>
    </div>
  );
}
