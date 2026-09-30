"use client";

import { useRouter } from "next/navigation";
import { useApp, usePageMeta } from "@/lib/app-context";
import type { Role } from "@/lib/types";

export default function Home() {
  const { setRole, lang, setLang } = useApp();
  const router = useRouter();
  usePageMeta("Добро пожаловать", "Единый маршрут помощи семье");

  function pick(r: Role) {
    setRole(r);
    router.push(r === "curator" ? "/curator" : "/parent");
  }

  return (
    <div className="stack-lg">
      <section className="hero-grid">
        <div className="stack" style={{ gap: 22 }}>
          <span className="eyebrow">Для семей детей с РАС</span>
          <h1>Единый маршрут ребёнка с РАС</h1>
          <p className="lead">
            Мы сами получим документы ребёнка из госсистем, зададим несколько вопросов и соберём план по линии здравоохранения,
            образования и соцзащиты — с напоминаниями о сроках.
          </p>
          <div className="row gap-sm wrap">
            <button className="btn btn-primary btn-lg" onClick={() => { setRole("parent"); router.push("/parent/login"); }}>
              Войти через eGov
            </button>
            <div className="segmented no-translate">
              <button className={lang === "kk" ? "active" : ""} onClick={() => setLang("kk")}>
                Қазақша
              </button>
              <button className={lang === "ru" ? "active" : ""} onClick={() => setLang("ru")}>
                Русский
              </button>
            </div>
          </div>
          {lang === "kk" && <span className="hint">Аударма автоматты түрде жасалған, тексерілуде.</span>}
          <div className="row gap-sm wrap small">
            <span className="muted">Вы специалист?</span>
            <button className="link-btn" onClick={() => pick("curator")}>
              Войти как куратор
            </button>
            <span className="muted">·</span>
            <button className="link-btn" onClick={() => pick("parent")}>
              Анкета без eGov
            </button>
          </div>
        </div>
        <div className="how">
          <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}>
            Как это работает
          </span>
          <div className="how-step">
            <span className="how-num">1</span>
            <div>
              <b>Документы — из госсистем</b>
              <span>С вашего согласия получаем справку МСЭ, заключение ПМПК и ИПР. Ничего не нужно сканировать. Медицинские данные не запрашиваем.</span>
            </div>
          </div>
          <div className="how-step">
            <span className="how-num">2</span>
            <div>
              <b>8–12 вопросов</b>
              <span>Только о том, чего нет в документах: что уже получается и что мешает.</span>
            </div>
          </div>
          <div className="how-step">
            <span className="how-num">3</span>
            <div>
              <b>План, куратор и напоминания</b>
              <span>Шаги — из каталога услуг, сроки и зависимости считает код. Куратор проверяет план и помогает, если что-то не получается.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="principles">
        <div>
          <b>Без диагнозов</b>
          <span className="hint">Не ставим диагнозов, не оцениваем ребёнка и не советуем лечение.</span>
        </div>
        <div>
          <b>Только из каталога</b>
          <span className="hint">Каждый шаг — услуга из справочника; код проверяет каждый шаг.</span>
        </div>
        <div>
          <b>Зависимости и сроки считает код</b>
          <span className="hint">Что заблокировано, когда откроется и что просрочено — вычисляется, а не генерируется.</span>
        </div>
      </section>
    </div>
  );
}
