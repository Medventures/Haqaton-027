"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CaseStatusBadge, StageBadge } from "@/components/Badges";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import type { CaseSummary, CaseView, DocType, Intake, Language } from "@/lib/types";
import { Ico } from "@/components/Icons";

const CITIES = ["Алматы", "Астана", "Шымкент", "Караганда", "Актобе", "Павлодар", "Өскемен", "Кызылорда", "Петропавловск", "Другой город"];

const EMPTY_INTAKE: Intake = {
  has_conclusion: false,
  conclusion_date: null,
  dispensary: false,
  pmpk_status: "none",
  pmpk_date: null,
  mse_status: "none",
  mse_valid_until: null,
  mchat_status: "none",
  mchat_date: null,
  pediatrician_visited: false,
  documents: [],
};

function caseHref(c: CaseSummary): string {
  return c.summary_confirmed ? `/parent/cases/${c.id}` : `/parent/cases/${c.id}/interview`;
}

function CaseRow({ c, onOpen }: { c: CaseSummary; onOpen?: () => void }) {
  return (
    <li className="case-row">
      <div className="case-main">
        <div className="case-title">
          {c.child_alias} <CaseStatusBadge status={c.status} /> <StageBadge stage={c.stage} />
        </div>
        <div className="muted small">
          {c.age_text}, {c.city}
          {c.scenario_summary ? ` · ${c.scenario_summary}` : ""}
        </div>
      </div>
      <Link className="btn btn-primary" href={caseHref(c)} onClick={onOpen}>
        {c.summary_confirmed ? "Мой маршрут" : c.interview_answered ? "Продолжить интервью" : "Начать интервью"}
      </Link>
    </li>
  );
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="segmented segmented-sm">
      <button type="button" className={value ? "active" : ""} onClick={() => onChange(true)}>
        Да
      </button>
      <button type="button" className={!value ? "active" : ""} onClick={() => onChange(false)}>
        Нет
      </button>
    </div>
  );
}

export default function ParentHome() {
  const { ready, role, setRole, myCases, rememberCase, settings } = useApp();
  const router = useRouter();
  const [mine, setMine] = useState<CaseSummary[] | null>(null);
  const [demo, setDemo] = useState<CaseSummary[]>([]);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ child_alias: "", birth_date: "", city: "Алматы", otherCity: "", language: "ru" as Language });
  const [intake, setIntake] = useState<Intake>(EMPTY_INTAKE);
  const [busy, setBusy] = useState(false);
  usePageMeta("Кабинет родителя", "Ваши кейсы и новая анкета");

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);

  useEffect(() => {
    if (!ready) return;
    api<{ doc_types: DocType[] }>("parent", "/doc-types").then((r) => setDocTypes(r.doc_types)).catch(() => {});
    (async () => {
      try {
        const all = await api<{ cases: CaseSummary[] }>("parent", "/cases");
        const own = (await Promise.all(myCases.map((id) => api<CaseView>("parent", `/cases/${id}`).catch(() => null)))).filter(
          (c): c is CaseView => c !== null,
        );
        setMine(own);
        setDemo(all.cases.filter((c) => !myCases.includes(c.id)));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [ready, myCases]);

  const set = <K extends keyof Intake>(k: K, v: Intake[K]) => setIntake((i) => ({ ...i, [k]: v }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const city = form.city === "Другой город" ? form.otherCity.trim() : form.city;
      const c = await api<CaseView>("parent", "/cases", {
        method: "POST",
        body: { child_alias: form.child_alias.trim(), birth_date: form.birth_date, city, language: form.language, intake },
      });
      rememberCase(c.id);
      router.push(`/parent/cases/${c.id}/interview`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const today = settings?.today ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="stack-lg">
      {error && <div className="alert alert-error">{error}</div>}

      <section className="card banner" style={{ background: "var(--accent-soft)", borderColor: "#c9ded9" }}>
        <div className="stack-sm">
          <b>Войдите через eGov — документы подтянутся сами</b>
          <span className="small" style={{ color: "var(--text-2)" }}>
            Справка МСЭ, заключение ПМПК и ИПР из госсистем; вам останется ответить на 8–12 вопросов. В демо вход имитируется.
          </span>
        </div>
        <Link className="btn btn-primary" href="/parent/login">
          Войти через eGov
        </Link>
      </section>

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

      <section className="card">
        <h2>Демо-семьи</h2>
        <p className="muted small">
          Три синтетических кейса — три этапа маршрута: раннее вмешательство, коррекция, социализация. В интервью есть кнопка
          «Заполнить демо-ответами».
        </p>
        {mine === null && !error && <div className="muted">Загрузка…</div>}
        <ul className="case-list">
          {demo.map((c) => (
            <CaseRow key={c.id} c={c} onOpen={() => rememberCase(c.id)} />
          ))}
        </ul>
        {mine !== null && demo.length === 0 && <p className="muted small">Все демо-семьи уже в списке «Мои кейсы».</p>}
      </section>

      <form className="card stack" onSubmit={create}>
        <div>
          <h2>Новый кейс: анкета</h2>
          <p className="muted small">
            Только факты: что уже есть у семьи. Названия диагнозов не нужны. Укажите условное имя — настоящие ФИО и ИИН не
            нужны.
          </p>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Условное имя семьи</span>
            <input className="input" required maxLength={60} placeholder="Например: Семья Д" value={form.child_alias}
              onChange={(e) => setForm({ ...form, child_alias: e.target.value })} />
          </label>
          <label className="field">
            <span>Дата рождения ребёнка</span>
            <input className="input" type="date" required max={today} value={form.birth_date}
              onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
          </label>
          <label className="field">
            <span>Город</span>
            <select className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
              {CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {form.city === "Другой город" && (
              <input className="input mt-xs" required placeholder="Название города" value={form.otherCity}
                onChange={(e) => setForm({ ...form, otherCity: e.target.value })} />
            )}
          </label>
          <div className="field">
            <span>Язык общения</span>
            <div className="segmented segmented-sm">
              {(["ru", "kk"] as Language[]).map((l) => (
                <button type="button" key={l} className={form.language === l ? "active" : ""} onClick={() => setForm({ ...form, language: l })}>
                  {l === "ru" ? "Русский" : "Қазақша"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <span>Есть ли заключение врача?</span>
            <YesNo value={intake.has_conclusion} onChange={(v) => set("has_conclusion", v)} />
            {intake.has_conclusion && (
              <input className="input mt-xs" type="date" max={today} value={intake.conclusion_date ?? ""} aria-label="Дата заключения"
                onChange={(e) => set("conclusion_date", e.target.value || null)} />
            )}
          </div>
          <div className="field">
            <span>Наблюдается у врача (диспансерный учёт)?</span>
            <YesNo value={intake.dispensary} onChange={(v) => set("dispensary", v)} />
          </div>
          <div className="field">
            <span>Был ли визит к участковому педиатру по этому вопросу?</span>
            <YesNo value={intake.pediatrician_visited} onChange={(v) => set("pediatrician_visited", v)} />
          </div>
          <div className="field">
            <span>Скрининг M-CHAT-R</span>
            <select className="input" value={intake.mchat_status} onChange={(e) => set("mchat_status", e.target.value as Intake["mchat_status"])}>
              <option value="none">Не проходили</option>
              <option value="done">Проходили</option>
            </select>
          </div>
          <div className="field">
            <span>Заключение ПМПК</span>
            <select className="input" value={intake.pmpk_status} onChange={(e) => set("pmpk_status", e.target.value as Intake["pmpk_status"])}>
              <option value="none">Нет</option>
              <option value="valid">Есть, действует</option>
              <option value="expired">Истекло</option>
            </select>
            {intake.pmpk_status !== "none" && (
              <input className="input mt-xs" type="date" max={today} value={intake.pmpk_date ?? ""} aria-label="Дата ПМПК"
                onChange={(e) => set("pmpk_date", e.target.value || null)} />
            )}
          </div>
          <div className="field">
            <span>Справка МСЭ (инвалидность)</span>
            <select className="input" value={intake.mse_status} onChange={(e) => set("mse_status", e.target.value as Intake["mse_status"])}>
              <option value="none">Не было</option>
              <option value="valid">Действует</option>
              <option value="expired">Истекла</option>
            </select>
            {intake.mse_status !== "none" && (
              <input className="input mt-xs" type="date" value={intake.mse_valid_until ?? ""} aria-label="Действует до"
                onChange={(e) => set("mse_valid_until", e.target.value || null)} />
            )}
          </div>
        </div>

        <fieldset className="field">
          <span>Какие документы есть на руках?</span>
          <div className="chips">
            {docTypes.map((d) => {
              const on = intake.documents.includes(d.id);
              return (
                <button type="button" key={d.id} className={`chip ${on ? "on" : ""}`}
                  onClick={() => set("documents", on ? intake.documents.filter((x) => x !== d.id) : [...intake.documents, d.id])}>
                  <Ico name={on ? "check" : "plus"} size={12} /> 
                  {d.name}
                </button>
              );
            })}
          </div>
        </fieldset>

        <button className="btn btn-primary btn-lg self-start" disabled={busy}>
          {busy ? "Создаём…" : "Создать и начать интервью"}
        </button>
      </form>
    </div>
  );
}
