"use client";

import { useRouter } from "next/navigation";
import { useApp, usePageMeta } from "@/lib/app-context";
import type { Role } from "@/lib/types";

export default function Home() {
  const { setRole } = useApp();
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
          <h1>Один маршрут вместо хождения по ведомствам</h1>
          <p className="lead">
            Короткая анкета и 8–12 вопросов — и у семьи единый план по линии здравоохранения, образования и соцзащиты: какие
            шаги нужны сейчас, какие откроются позже и какие документы собрать.
          </p>
          <div className="row gap-sm wrap">
            <button className="btn btn-primary btn-lg" onClick={() => pick("parent")}>
              Я родитель
            </button>
            <button className="btn btn-lg" onClick={() => pick("curator")}>
              Я куратор
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
              <b>Анкета и вопросы</b>
              <span>Отмечаем, что уже есть у семьи, и задаём только те вопросы, ответов на которые нет в анкете.</span>
            </div>
          </div>
          <div className="how-step">
            <span className="how-num">2</span>
            <div>
              <b>План из каталога услуг</b>
              <span>Код определяет шаги, сроки и что откроется после чего. AI объясняет каждый шаг простым языком.</span>
            </div>
          </div>
          <div className="how-step">
            <span className="how-num">3</span>
            <div>
              <b>Куратор и напоминания</b>
              <span>Куратор проверяет план, видит просрочки и помогает собрать документы. Семья получает напоминания.</span>
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
