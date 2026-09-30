"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/app-context";
import { fmtDate } from "@/lib/format";
import type { Role } from "@/lib/types";

export function Header() {
  const { role, setRole, settings } = useApp();
  const router = useRouter();

  function switchRole(r: Role) {
    if (r === role) return;
    setRole(r);
    router.push(r === "curator" ? "/curator" : "/parent");
  }

  return (
    <header className="header no-print">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden>
            ◆
          </span>
          AqylRoute <span className="brand-ai">AI</span>
        </Link>
        <div className="header-right">
          {settings && (
            <span
              className={`pill ${settings.demo_today ? "pill-warn" : "pill-muted"}`}
              title="Дата, относительно которой считаются сроки и просрочки"
            >
              {settings.demo_today ? "Дата демо" : "Сегодня"}: <b>{fmtDate(settings.today)}</b>
            </span>
          )}
          {settings && (
            <span
              className={`pill ${settings.llm_mode === "openai" ? "pill-ai" : "pill-muted"}`}
              title={settings.llm_mode === "openai" ? "Вопросы и план формирует модель OpenAI" : "Ключ OpenAI не задан: работают шаблоны и правила"}
            >
              {settings.llm_mode === "openai" ? `AI: ${settings.model}` : "AI: демо-режим"}
            </span>
          )}
          <div className="segmented" role="group" aria-label="Роль">
            <button className={role === "parent" ? "active" : ""} onClick={() => switchRole("parent")}>
              Родитель
            </button>
            <button className={role === "curator" ? "active" : ""} onClick={() => switchRole("curator")}>
              Куратор
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
