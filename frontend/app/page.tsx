"use client";

import { useRouter } from "next/navigation";
import { useApp } from "@/lib/app-context";
import type { Role } from "@/lib/types";

export default function Home() {
  const { role, setRole } = useApp();
  const router = useRouter();

  function pick(r: Role) {
    setRole(r);
    router.push(r === "curator" ? "/curator" : "/parent");
  }

  return (
    <div className="stack-lg">
      <section className="hero">
        <h1>Один маршрут помощи вместо хождения по ведомствам</h1>
        <p className="lead">
          Родитель отвечает на 8–12 вопросов. AI собирает единый план из справочника услуг медицины, образования и
          соцзащиты. Куратор проверяет план, следит за сроками и передаёт дело дальше.
        </p>
      </section>

      <section className="grid-2">
        <button className={`role-card ${role === "parent" ? "selected" : ""}`} onClick={() => pick("parent")}>
          <span className="role-icon" aria-hidden>
            👪
          </span>
          <span className="role-title">Я родитель</span>
          <span className="role-desc">Создать кейс, пройти интервью и увидеть подтверждённый маршрут семьи</span>
        </button>
        <button className={`role-card ${role === "curator" ? "selected" : ""}`} onClick={() => pick("curator")}>
          <span className="role-icon" aria-hidden>
            🗂️
          </span>
          <span className="role-title">Я куратор</span>
          <span className="role-desc">Проверить и подтвердить планы, вести статусы, просрочки и передачу дела</span>
        </button>
      </section>

      <section className="principles">
        <div>
          <b>Без диагнозов</b>
          <span className="muted small">Система не ставит диагнозы, не оценивает и не советует лечение.</span>
        </div>
        <div>
          <b>Только из каталога</b>
          <span className="muted small">Каждый шаг — реальная услуга из справочника, код проверяет каждый id.</span>
        </div>
        <div>
          <b>Сроки считает код</b>
          <span className="muted small">Даты, просрочки и эскалации вычисляются, а не генерируются.</span>
        </div>
      </section>
    </div>
  );
}
