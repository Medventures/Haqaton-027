"use client";

import { daysUntil, fmtDate } from "@/lib/format";
import type { Step } from "@/lib/types";

/** Small SVG/CSS charts for the plan: progress ring, status bar and a deadline timeline. No dependencies. */

export type Ind = "done" | "ok" | "due_soon" | "overdue" | "escalated" | "locked";

export const IND_LABEL: Record<Ind, string> = {
  done: "выполнено",
  ok: "в работе / не начат",
  due_soon: "скоро срок",
  overdue: "просрочено",
  escalated: "эскалация",
  locked: "заблокировано",
};

const ORDER: Ind[] = ["done", "ok", "due_soon", "overdue", "escalated", "locked"];

export function countByIndicator(steps: Step[]): Record<Ind, number> {
  const out: Record<Ind, number> = { done: 0, ok: 0, due_soon: 0, overdue: 0, escalated: 0, locked: 0 };
  for (const s of steps) out[s.indicator as Ind] += 1;
  return out;
}

export function ProgressRing({ done, total, size = 64, label = "выполнено" }: { done: number; total: number; size?: number; label?: string }) {
  const stroke = Math.max(5, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const part = total ? done / total : 0;
  const c = size / 2;
  return (
    <div className="ring" role="img" aria-label={`${done} из ${total} ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {part > 0 && (
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ok)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${len * part} ${len}`} transform={`rotate(-90 ${c} ${c})`} />
        )}
        <text x={c} y={c} textAnchor="middle" dominantBaseline="central" className="ring-text" style={{ fontSize: size / 4 }}>
          {total ? Math.round(part * 100) : 0}%
        </text>
      </svg>
    </div>
  );
}

/** Stacked bar by indicator. With `legend`, counts are listed under the bar. */
export function StatusBar({ counts, legend = true, thin = false, hide = [] }: {
  counts: Record<Ind, number>;
  legend?: boolean;
  thin?: boolean;
  hide?: Ind[];
}) {
  const shown = ORDER.filter((k) => !hide.includes(k));
  const total = shown.reduce((a, k) => a + counts[k], 0);
  const summary = shown.filter((k) => counts[k]).map((k) => `${IND_LABEL[k]}: ${counts[k]}`).join(", ");
  return (
    <div className="stack-sm" style={{ gap: 8 }}>
      <div className={`sbar ${thin ? "thin" : ""}`} role="img" aria-label={summary || "шагов нет"}>
        {total === 0 && <span className="sbar-empty" />}
        {shown.map((k) =>
          counts[k] ? <span key={k} className={`c-${k}`} style={{ flexGrow: counts[k] }} title={`${IND_LABEL[k]}: ${counts[k]}`} /> : null,
        )}
      </div>
      {legend && (
        <ul className="sbar-legend">
          {shown.filter((k) => counts[k]).map((k) => (
            <li key={k}>
              <span className={`dot c-${k}`} aria-hidden />
              <b>{counts[k]}</b> {IND_LABEL[k]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const WINDOW = 90;

/** Deadlines of open steps on a 90-day axis; overdue ones sit in the left zone, later ones in the right zone. */
export function DeadlineTimeline({ steps, today }: { steps: Step[]; today: string }) {
  const open = steps.filter((s) => s.status !== "done");
  if (open.length === 0) return null;
  const pos = (s: Step): number => {
    const d = daysUntil(s.due_date, today);
    if (s.status !== "locked" && s.overdue) return 4;
    if (d > WINDOW) return 96;
    return 12 + (Math.max(0, d) / WINDOW) * 76;
  };
  const items = open.map((s) => ({ s, x: pos(s) })).sort((a, b) => a.x - b.x);
  const lanes: number[] = [];
  const placed = items.map((it) => {
    let lane = lanes.findIndex((last) => it.x - last >= 9);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = it.x;
    return { ...it, lane };
  });
  const ticks = [0, 30, 60, 90].map((d) => ({ d, x: 12 + (d / WINDOW) * 76 }));
  const add = (d: number) => {
    const t = new Date(`${today}T00:00:00`);
    t.setDate(t.getDate() + d);
    return `${String(t.getDate()).padStart(2, "0")}.${String(t.getMonth() + 1).padStart(2, "0")}`;
  };

  return (
    <div className="tl" style={{ height: 50 + lanes.length * 34 }} aria-label="Сроки шагов на 3 месяца">
      <span className="tl-zone left" style={{ top: 32 + lanes.length * 34 }}>← просрочено</span>
      <span className="tl-zone right" style={{ top: 32 + lanes.length * 34 }}>позже →</span>
      <div className="tl-axis" style={{ top: 12 + lanes.length * 34 }} />
      {ticks.map((t) => (
        <span key={t.d} className="tl-tick" style={{ left: `${t.x}%`, top: 16 + lanes.length * 34 }}>
          {t.d === 0 ? "сегодня" : add(t.d)}
        </span>
      ))}
      {placed.map(({ s, x, lane }) => (
        <a key={s.id} href={`#step-${s.id}`} className={`tl-dot c-${s.indicator} ${s.status === "locked" ? "locked" : ""}`}
          style={{ left: `${x}%`, top: lane * 34 }}
          title={`${s.title}: ${s.status === "locked" ? "заблокирован, срок" : "срок"} ${fmtDate(s.due_date)}`}
          aria-label={`Шаг ${s.position}: ${s.title}, срок ${fmtDate(s.due_date)}`}>
          {s.position}
        </a>
      ))}
    </div>
  );
}

/** Overview card for a plan: ring, status bar and the deadline timeline. */
export function PlanOverview({ steps, today, hide = [] }: { steps: Step[]; today: string; hide?: Ind[] }) {
  const counts = countByIndicator(steps);
  if (hide.includes("escalated")) {
    counts.overdue += counts.escalated;
    counts.escalated = 0;
  }
  const done = counts.done;
  return (
    <section className="card overview">
      <div className="overview-top">
        <ProgressRing done={done} total={steps.length} size={72} />
        <div className="stack-sm grow" style={{ gap: 6 }}>
          <b>
            Выполнено {done} из {steps.length}
          </b>
          <StatusBar counts={counts} hide={hide} />
        </div>
      </div>
      <div className="stack-sm" style={{ gap: 6 }}>
        <span className="overview-label">Сроки на 3 месяца</span>
        <DeadlineTimeline steps={steps} today={today} />
      </div>
    </section>
  );
}
