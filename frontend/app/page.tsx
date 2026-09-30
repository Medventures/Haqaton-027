"use client";

import { useRouter } from "next/navigation";
import { Ico, type IconName } from "@/components/Icons";
import { useApp, usePageMeta } from "@/lib/app-context";
import type { Role } from "@/lib/types";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "file", title: "Документы из eGov", text: "МСЭ, ПМПК и ИПР — без сканов" },
  { icon: "chat", title: "8–12 вопросов", text: "Только то, чего нет в документах" },
  { icon: "route", title: "План и куратор", text: "Шаги, сроки и напоминания" },
];

const PRINCIPLES: { icon: IconName; text: string }[] = [
  { icon: "shield", text: "Без диагнозов и советов по лечению" },
  { icon: "check", text: "Шаги только из каталога услуг" },
  { icon: "clock", text: "Сроки и зависимости считает код" },
];

/** Decorative preview of a plan: shows what the family gets, instead of describing it. */
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
      <div className="lp-card lp-toast">
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
  usePageMeta("Добро пожаловать", "Единый маршрут помощи семье");

  function go(r: Role, path: string) {
    setRole(r);
    router.push(path);
  }

  return (
    <div className="lp">
      <section className="lp-hero">
        <div className="lp-copy">
          <span className="lp-pill">
            <span className="lp-pill-dot" /> Здравоохранение · образование · соцзащита
          </span>
          <h1>Единый маршрут ребёнка с РАС</h1>
          <p className="lp-lead">Документы из госсистем, несколько вопросов — и понятный план с напоминаниями.</p>
          <div className="lp-actions">
            <button className="btn btn-primary btn-lg lp-cta" onClick={() => go("parent", "/parent/login")}>
              Войти через eGov <Ico name="arrow" size={18} />
            </button>
            <button className="btn btn-lg lp-secondary" onClick={() => go("curator", "/curator")}>
              Я куратор
            </button>
          </div>
          <div className="lp-meta">
            <div className="segmented no-translate" aria-label="Язык">
              <button className={lang === "kk" ? "active" : ""} onClick={() => setLang("kk")}>
                Қазақша
              </button>
              <button className={lang === "ru" ? "active" : ""} onClick={() => setLang("ru")}>
                Русский
              </button>
            </div>
            <button className="link-btn small" onClick={() => go("parent", "/parent")}>
              Анкета без eGov
            </button>
          </div>
          {lang === "kk" && <span className="hint">Аударма автоматты түрде жасалған, тексерілуде.</span>}
        </div>
        <PlanPreview />
      </section>

      <section className="lp-steps">
        {STEPS.map((s, i) => (
          <div key={s.title} className="lp-step">
            <span className="lp-step-ico">
              <Ico name={s.icon} size={20} />
            </span>
            <div>
              <span className="lp-step-num">Шаг {i + 1}</span>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </div>
          </div>
        ))}
      </section>

      <ul className="lp-principles">
        {PRINCIPLES.map((p) => (
          <li key={p.text}>
            <Ico name={p.icon} size={16} /> {p.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
