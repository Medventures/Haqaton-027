"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Chip } from "@/components/Badges";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import { answerText } from "@/lib/format";
import { remindersFor } from "@/lib/reminders";
import type { CaseView } from "@/lib/types";

export default function RemindersPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, role, setRole, rememberCase, settings } = useApp();
  const [c, setCase] = useState<CaseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageMeta("Напоминания", c ? `${c.child_alias} · сроки и предстоящие шаги` : undefined);

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);

  useEffect(() => {
    if (!ready) return;
    rememberCase(Number(id));
    api<CaseView>("parent", `/cases/${id}`).then(setCase).catch((e) => setError((e as Error).message));
  }, [ready, id, rememberCase, settings?.today]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!c) return <div className="hint">Загрузка…</div>;

  const channel = c.interview.items.find((i) => i.slot === "notify")?.answer;
  const list = c.plan_visible ? remindersFor(c) : [];

  return (
    <div className="stack" style={{ gap: 12, maxWidth: 820 }}>
      <span className="small muted">
        {channel ? `Напоминания также приходят: ${answerText(channel)} (в демо не отправляются).` : "Напоминания появляются здесь."}
      </span>
      {!c.plan_visible && <div className="card">План ещё на проверке у куратора — напоминания начнутся после подтверждения.</div>}
      {c.plan_visible && list.length === 0 && <div className="card">Сейчас напоминаний нет — всё в срок.</div>}
      {list.map((r) => (
        <div key={r.key} className={`reminder ${r.tone === "crit" ? "crit" : r.tone === "warn" ? "warn" : ""}`}>
          <span>
            <Chip tone={r.tone}>{r.tag}</Chip>
          </span>
          <span className="text">{r.text}</span>
          <span className="small muted">{r.meta}</span>
          {r.stepId && (
            <Link href={`/parent/cases/${c.id}`} className="link-btn">
              К шагу в плане
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
