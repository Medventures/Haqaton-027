"use client";

import { useRouter } from "next/navigation";
import { Ico, type IconName } from "@/components/Icons";
import { useApp } from "@/lib/app-context";
import type { Role } from "@/lib/types";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "file", title: "Документы из eGov", text: "МСЭ, ПМПК и ИПР — с вашего согласия, без сканов" },
  { icon: "chat", title: "8–12 вопросов", text: "Только то, чего нет в документах" },
  { icon: "route", title: "План и куратор", text: "Шаги, сроки, напоминания и помощь куратора" },
];

const FOR: { icon: IconName; title: string; points: string[]; cta: string; role: Role; path: string }[] = [
  {
    icon: "users",
    title: "Для семьи",
    points: ["Один план вместо разрозненных справок", "Напоминания о сроках", "Единая папка документов"],
    cta: "Войти через eGov",
    role: "parent",
    path: "/parent/login",
  },
  {
    icon: "shield",
    title: "Для куратора",
    points: ["Все семьи и сроки на одном экране", "Эскалации и красные флаги", "Передача дела в один клик"],
    cta: "Кабинет куратора",
    role: "curator",
    path: "/curator",
  },
];

/** Product preview: what the family gets, shown instead of described. Decorative. */
function PlanPreview() {
  return (
    <div className="lp-preview" aria-hidden>
      <div className="lp-card lp-card-main">
        <div className="row between" style={{ alignItems: "center" }}>
          <b>Ваш маршрут</b>
          <span className="chip-s tone-ok">План подтверждён</span>
        </div>
        <div className="lp-progress">
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="27" fill="none" stroke="var(--line)" strokeWidth="7" />
            <circle cx="32" cy="32" r="27" fill="none" stroke="var(--ok)" strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 27 * 0.34} 200`} transform="rotate(-90 32 32)" />
            <text x="32" y="32" textAnchor="middle" dominantBaseline="central" className="ring-text" style={{ fontSize: 15 }}>
              1/3
            </text>
          </svg>
          <div className="sbar" style={{ flex: 1 }}>
            <span className="c-done" style={{ flexGrow: 1 }} />
            <span className="c-due_soon" style={{ flexGrow: 1 }} />
            <span className="c-locked" style={{ flexGrow: 1 }} />
          </div>
        </div>
        <div className="lp-route">
          <span className="lp-node done">
            <Ico name="check" size={13} /> Педиатр
          </span>
          <Ico name="arrow" size={16} className="lp-arrow" />
          <span className="lp-node soon">
            <Ico name="clock" size={13} /> ПМПК
          </span>
          <Ico name="arrow" size={16} className="lp-arrow" />
          <span className="lp-node locked">
            <Ico name="lock" size={13} /> Тьютор
          </span>
        </div>
      </div>
      <div className="lp-card lp-toast lp-toast-1">
        <span className="lp-toast-ico">
          <Ico name="clock" size={16} />
        </span>
        <div>
          <b>Скоро срок</b>
          <span>Справка МСЭ — через 27 дней</span>
        </div>
      </div>
      <div className="lp-card lp-toast lp-toast-2">
        <span className="lp-toast-ico ok">
          <Ico name="users" size={16} />
        </span>
        <div>
          <b>Куратор рядом</b>
          <span>Поможет, если шаг не получается</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { setRole, lang, setLang } = useApp();
  const router = useRouter();

  function go(r: Role, path: string) {
    setRole(r);
    router.push(path);
  }

  return (
    <div className="lp">
      <header className="lp-nav">
        <nav className="lp-nav-links" aria-label="Разделы страницы">
          <a href="#how">Как это работает</a>
          <a href="#for">Для кого</a>
        </nav>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/aqylroute-logo.svg" alt="AqylRoute AI" className="lp-logo" />
        <div className="lp-nav-right">
          <div className="lp-lang no-translate" role="group" aria-label="Язык / Тіл">
            <button className={lang === "ru" ? "active" : ""} onClick={() => setLang("ru")}>
              Рус
            </button>
            <button className={lang === "kk" ? "active" : ""} onClick={() => setLang("kk")}>
              Қаз
            </button>
          </div>
          <button className="lp-btn lp-btn-primary lp-btn-sm" onClick={() => go("parent", "/parent/login")}>
            Войти
          </button>
        </div>
      </header>

      <section className="lp-hero">
        <span className="lp-pill">
          <span className="lp-pill-dot" /> Здравоохранение · образование · соцзащита
        </span>
        <h1>
          Единый маршрут
          <br />
          ребёнка с <span className="lp-accent">РАС</span>
        </h1>
        <p className="lp-lead">Документы из госсистем, несколько вопросов — и понятный план с напоминаниями.</p>
        <div className="lp-actions">
          <button className="lp-btn lp-btn-primary" onClick={() => go("parent", "/parent/login")}>
            Войти через eGov <Ico name="arrow" size={18} />
          </button>
          <button className="lp-btn lp-btn-ghost" onClick={() => go("curator", "/curator")}>
            Я куратор
          </button>
        </div>
        <button className="lp-link" onClick={() => go("parent", "/parent")}>
          Анкета без eGov
        </button>
        <div className="lp-lang lp-lang-mobile no-translate" role="group" aria-label="Язык / Тіл">
          <button className={lang === "ru" ? "active" : ""} onClick={() => setLang("ru")}>
            Рус
          </button>
          <button className={lang === "kk" ? "active" : ""} onClick={() => setLang("kk")}>
            Қаз
          </button>
        </div>
        {lang === "kk" && <span className="hint">Аударма автоматты түрде жасалған, тексерілуде.</span>}
      </section>

      <section className="lp-stage" aria-label="Как выглядит план">
        <div className="lp-stage-side left">
          <b>3 ведомства</b>
          <span>в одном плане: здравоохранение, образование, соцзащита</span>
        </div>
        <PlanPreview />
        <div className="lp-stage-side right">
          <b>18 услуг</b>
          <span>в каталоге — шаги берутся только из него</span>
        </div>
        <div className="lp-float lp-float-dark" aria-hidden>
          <b>0</b>
          <span>диагнозов и советов по лечению</span>
        </div>
      </section>

      <section className="lp-section" id="how">
        <span className="lp-kicker">Как это работает</span>
        <h2>Три шага до плана</h2>
        <div className="lp-steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="lp-step">
              <span className="lp-step-ico">
                <Ico name={s.icon} size={22} />
              </span>
              <span className="lp-step-num">0{i + 1}</span>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section" id="for">
        <span className="lp-kicker">Для кого</span>
        <h2>Семье — ясность, куратору — контроль сроков</h2>
        <div className="lp-for">
          {FOR.map((f) => (
            <div key={f.title} className={`lp-for-card ${f.role}`}>
              <span className="lp-step-ico">
                <Ico name={f.icon} size={22} />
              </span>
              <b>{f.title}</b>
              <ul>
                {f.points.map((p) => (
                  <li key={p}>
                    <Ico name="check" size={15} /> {p}
                  </li>
                ))}
              </ul>
              <button className={`lp-btn ${f.role === "parent" ? "lp-btn-primary" : "lp-btn-ghost"}`} onClick={() => go(f.role, f.path)}>
                {f.cta} <Ico name="arrow" size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <footer className="lp-footer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/aqylroute-logo.svg" alt="AqylRoute AI" className="lp-logo" />
        <span>Все данные синтетические. Система не ставит диагнозы и не даёт медицинских рекомендаций; лечение назначает врач.</span>
      </footer>
    </div>
  );
}
