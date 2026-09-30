"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Chip } from "@/components/Badges";
import { HelpPanel } from "@/components/HelpPanel";
import { PlanOverview, ProgressRing } from "@/components/Charts";
import { type StepPatch } from "@/components/StepCard";
import { StepsView } from "@/components/StepsView";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import { STAGE_LABEL, fmtDate } from "@/lib/format";
import { remindersFor } from "@/lib/reminders";
import type { CaseView } from "@/lib/types";
import { Ico } from "@/components/Icons";

export default function MyRoutePage() {
  const { id } = useParams<{ id: string }>();
  const { settings, ready, rememberCase, role, setRole, refreshShell } = useApp();
  const [c, setCase] = useState<CaseView | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  usePageMeta("План", c ? `${c.child_alias} · этап «${STAGE_LABEL[c.stage]}»` : undefined);

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
  }, [ready, role, setRole]);

  const load = useCallback(async () => {
    try {
      setCase(await api<CaseView>("parent", `/cases/${id}`));
      setVersion((v) => v + 1);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    rememberCase(Number(id));
    load();
  }, [ready, load, id, rememberCase, settings?.today]);

  async function patch(stepId: number, p: StepPatch) {
    try {
      await api("parent", `/steps/${stepId}`, { method: "PATCH", body: p });
      await load();
      refreshShell();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleDoc(docType: string, have: boolean) {
    await api("parent", `/cases/${id}/documents/${docType}`, { method: "PATCH", body: { have } });
    await load();
  }

  if (!c || !settings) return error ? <div className="alert alert-error">{error}</div> : <div className="hint">Загрузка…</div>;

  if (!c.summary_confirmed) {
    return (
      <div className="card stack" style={{ maxWidth: 620 }}>
        <h1 className="h-page">Сначала несколько вопросов</h1>
        <p className="lead">Ответьте на вопросы и подтвердите сводку — по ней будет составлен план.</p>
        <Link href={`/parent/cases/${c.id}/interview`} className="btn btn-primary btn-lg self-start">
          Продолжить интервью
        </Link>
      </div>
    );
  }

  if (!c.plan_visible) {
    return (
      <div className="stack" style={{ maxWidth: 620 }}>
        <h1 className="h-page">План на проверке у куратора</h1>
        <p className="lead">Куратор проверит каждый шаг и сроки. Как только план будет подтверждён, он появится здесь.</p>
        {c.red_flag_text && <div className="alert alert-crit"><Ico name="alert" /> {c.red_flag_text}</div>}
        <div className="row gap-sm wrap">
          <button className="btn btn-primary" onClick={load}>
            Обновить
          </button>
          <Link className="btn" href={`/parent/cases/${c.id}/documents`}>
            Мои документы
          </Link>
        </div>
      </div>
    );
  }

  const soon = c.steps.filter((s) => s.due_soon);
  const reminders = remindersFor(c).slice(0, 3);
  const docs = new Map<string, boolean>();
  c.steps.forEach((s) => s.documents.filter((d) => !d.optional).forEach((d) => docs.set(d.doc_type, (docs.get(d.doc_type) ?? false) || d.have)));
  const docsHave = [...docs.values()].filter(Boolean).length;

  return (
    <div className="two-col">
      <div className="stack" style={{ gap: 14 }}>
        {c.red_flag_text && (
          <div className="alert alert-crit" role="alert">
            <b>Важно.</b> {c.red_flag_text}
          </div>
        )}
        {soon.map((s) => {
          const n = c.notifications.find((x) => x.step_id === s.id && x.type === "due_soon");
          return (
            <div key={s.id} className="banner-due">
              <b className="with-ico"><Ico name="clock" /> {n?.message ?? `Скоро срок шага «${s.title}»`}</b>
              <HelpPanel stepId={s.id} role="parent" version={version} />
            </div>
          );
        })}

        <PlanOverview steps={c.steps} today={settings.today} />

        {error && <div className="alert alert-error">{error}</div>}
        <StepsView steps={c.steps} role="parent" version={version} onPatch={patch} onToggleDoc={toggleDoc}
          cardKey={(s) => `${s.id}-${s.blocker_note}-${version}`}
          openByDefault={(s) => s.indicator === "overdue" || s.indicator === "escalated"} />
        <p className="hint">
          Шаги взяты из справочника услуг и ваших документов. Лечение назначает только врач — мы лишь напоминаем о шагах и сроках.
        </p>
      </div>

      <div className="side">
        <div className="card stack-sm">
          <div className="row between">
            <b>Ближайшее</b>
            <Link href={`/parent/cases/${c.id}/reminders`} className="link-btn">
              Все напоминания
            </Link>
          </div>
          {reminders.length === 0 && <span className="small">Сейчас напоминаний нет — всё в срок.</span>}
          {reminders.map((r) => (
            <div key={r.key} className="reminder-mini">
              <span>
                <Chip tone={r.tone}>{r.tag}</Chip>
              </span>
              <span className="text">{r.text}</span>
            </div>
          ))}
        </div>
        <div className="card stack-sm">
          <div className="row between">
            <b>Документы</b>
            <Link href={`/parent/cases/${c.id}/documents`} className="link-btn">
              Открыть папку
            </Link>
          </div>
          <div className="row gap-sm" style={{ alignItems: "center" }}>
            <ProgressRing done={docsHave} total={docs.size} size={56} label="документов есть" />
            <span className="small">
              <b>{docsHave}</b> из {docs.size} документов на руках
            </span>
          </div>
          <span className="hint">Отметьте документ один раз — он учтётся во всех шагах.</span>
        </div>
        <div className="card stack-sm">
          <b>Куратор</b>
          <span className="small" style={{ color: "var(--text-2)" }}>
            Куратор утвердил план{c.confirmed_at ? ` ${fmtDate(c.confirmed_at)}` : ""}. Подключается, если шаг просрочен или не
            получается.
          </span>
        </div>
      </div>
    </div>
  );
}
