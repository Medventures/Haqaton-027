"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CaseStatusBadge } from "@/components/Badges";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import type { CaseSummary, CaseView, Language } from "@/lib/types";

const CITIES = ["Алматы", "Астана", "Шымкент", "Караганда", "Актобе", "Павлодар", "Усть-Каменогорск", "Другой город"];

function caseHref(c: CaseSummary): string {
  return c.interview_done ? `/parent/cases/${c.id}` : `/parent/cases/${c.id}/interview`;
}

function CaseRow({ c, onOpen }: { c: CaseSummary; onOpen?: () => void }) {
  return (
    <li className="case-row">
      <div className="case-main">
        <div className="case-title">
          {c.child_alias} <CaseStatusBadge status={c.status} />
        </div>
        <div className="muted small">
          {c.age_text}, {c.city}
          {c.scenario_summary ? ` · ${c.scenario_summary}` : ""}
        </div>
      </div>
      <Link className="btn btn-primary" href={caseHref(c)} onClick={onOpen}>
        {c.interview_done ? "Мой маршрут" : c.interview_answered ? "Продолжить интервью" : "Начать интервью"}
      </Link>
    </li>
  );
}

export default function ParentHome() {
  const { ready, role, setRole, myCases, rememberCase } = useApp();
  const router = useRouter();
  const [mine, setMine] = useState<CaseSummary[] | null>(null);
  const [demo, setDemo] = useState<CaseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ child_alias: "", birth_date: "", city: "Алматы", otherCity: "", language: "ru" as Language });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const all = await api<{ cases: CaseSummary[] }>("parent", "/cases");
        const own = (
          await Promise.all(myCases.map((id) => api<CaseView>("parent", `/cases/${id}`).catch(() => null)))
        ).filter((c): c is CaseView => c !== null);
        setMine(own);
        setDemo(all.cases.filter((c) => !myCases.includes(c.id)));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [ready, myCases]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const city = form.city === "Другой город" ? form.otherCity.trim() : form.city;
      const c = await api<CaseView>("parent", "/cases", {
        method: "POST",
        body: { child_alias: form.child_alias.trim(), birth_date: form.birth_date, city, language: form.language },
      });
      rememberCase(c.id);
      router.push(`/parent/cases/${c.id}/interview`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="stack-lg">
      <h1 className="h-page">Кабинет родителя</h1>
      {error && <div className="alert alert-error">{error}</div>}

      {mine && mine.length > 0 && (
        <section className="card">
          <h2>Мои кейсы</h2>
          <ul className="case-list">
            {mine.map((c) => (
              <CaseRow key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}

      <section className="grid-2 align-start">
        <form className="card stack" onSubmit={create}>
          <div>
            <h2>Новый кейс</h2>
            <p className="muted small">Укажите только условное имя — настоящие ФИО и ИИН не нужны.</p>
          </div>
          <label className="field">
            <span>Условное имя семьи</span>
            <input
              className="input"
              required
              maxLength={60}
              placeholder="Например: Семья Д"
              value={form.child_alias}
              onChange={(e) => setForm({ ...form, child_alias: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Дата рождения ребёнка</span>
            <input
              className="input"
              type="date"
              required
              max={today}
              value={form.birth_date}
              onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Город</span>
            <select className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
              {CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {form.city === "Другой город" && (
            <input
              className="input"
              required
              placeholder="Название города"
              value={form.otherCity}
              onChange={(e) => setForm({ ...form, otherCity: e.target.value })}
            />
          )}
          <fieldset className="field">
            <span>Язык общения</span>
            <div className="segmented" role="radiogroup">
              {(["ru", "kk"] as Language[]).map((l) => (
                <button
                  type="button"
                  key={l}
                  className={form.language === l ? "active" : ""}
                  onClick={() => setForm({ ...form, language: l })}
                >
                  {l === "ru" ? "Русский" : "Қазақша"}
                </button>
              ))}
            </div>
          </fieldset>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Создаём…" : "Создать и начать интервью"}
          </button>
        </form>

        <section className="card">
          <h2>Демо-семьи</h2>
          <p className="muted small">Синтетические кейсы для демонстрации. В интервью есть кнопка «Заполнить демо-ответами».</p>
          {mine === null && !error && <div className="muted">Загрузка…</div>}
          <ul className="case-list">
            {demo.map((c) => (
              <CaseRow key={c.id} c={c} onOpen={() => rememberCase(c.id)} />
            ))}
          </ul>
          {mine !== null && demo.length === 0 && <p className="muted small">Все демо-семьи уже в списке «Мои кейсы».</p>}
        </section>
      </section>
    </div>
  );
}
