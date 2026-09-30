"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ProgressRing } from "./Charts";
import { STATUS_LABEL, fmtDate, lockHint } from "@/lib/format";
import { computeLayers, routeEdges } from "@/lib/route";
import type { IconName } from "./Icons";
import type { Step } from "@/lib/types";
import { Ico } from "./Icons";

const ICON: Record<Step["status"], IconName> = { done: "check", in_progress: "dot", todo: "circle", locked: "lock" };

const LEGEND: [string, string][] = [
  ["done", "выполнено"],
  ["ok", "в работе"],
  ["due_soon", "скоро срок"],
  ["overdue", "просрочено"],
  ["escalated", "эскалация"],
  ["locked", "заблокировано"],
];

function dueLine(s: Step): string {
  if (s.status === "done") return s.completed_at ? `Выполнено ${fmtDate(s.completed_at)}` : "Выполнено";
  if (s.status === "locked") return s.unlock_hint ? lockHint(s.unlock_hint) : "Откроется позже";
  return `До ${fmtDate(s.due_date)}`;
}

function nodeLabel(s: Step): string {
  const state = s.indicator === "overdue" || s.indicator === "escalated" ? "просрочен" : s.indicator === "due_soon" ? "скоро срок"
    : STATUS_LABEL[s.status].toLowerCase();
  const due = dueLine(s);
  return `Шаг ${s.position}: ${s.title}, ${state}, ${due[0].toLowerCase()}${due.slice(1)}`;
}

type Line = { d: string; key: string };

/** «Маршрут»: steps as nodes by dependency layers, arrows for depends_on. SVG/CSS only. */
export function RouteView({ steps, selected, onSelect }: { steps: Step[]; selected: number | null; onSelect: (id: number) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const layers = computeLayers(steps);
  const edges = routeEdges(steps);
  const done = steps.filter((s) => s.status === "done").length;
  const edgeKey = edges.map((e) => e.join(">")).join(",");

  // Arrows are drawn from measured node positions, so they follow the CSS layout (columns or rows).
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    function measure() {
      if (!box) return;
      const base = box.getBoundingClientRect();
      const wide = window.matchMedia("(min-width: 641px)").matches;
      const rect = (id: number) => box.querySelector(`[data-step="${id}"]`)?.getBoundingClientRect();
      const out: Line[] = [];
      edges.forEach(([from, to], i) => {
        const a = rect(from);
        const b = rect(to);
        if (!a || !b) return;
        const ay = a.top + a.height / 2 - base.top;
        const by = b.top + b.height / 2 - base.top;
        if (wide) {
          const x1 = a.right - base.left;
          const x2 = b.left - base.left - 4;
          const mx = (x1 + x2) / 2;
          out.push({ d: `M${x1},${ay} C${mx},${ay} ${mx},${by} ${x2},${by}`, key: `${from}-${to}` });
        } else {
          // Around the left edge: out of the source, down the gutter, into the target.
          const gx = 6 + (i % 3) * 6;
          const ax = a.left - base.left;
          const bx = b.left - base.left - 4;
          out.push({ d: `M${ax},${ay} H${gx} V${by} H${bx}`, key: `${from}-${to}` });
        }
      });
      setLines(out);
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeKey, steps.length]);

  return (
    <div className="card stack" style={{ gap: 16 }}>
      <div className="row between wrap gap-sm">
        <div className="row gap-sm" style={{ alignItems: "center" }}>
          <ProgressRing done={done} total={steps.length} size={52} />
          <span className="small">
            <b>{done}</b> из {steps.length} выполнено
          </span>
        </div>
        <ul className="route-legend" aria-label="Цвета шагов">
          {LEGEND.map(([ind, label]) => (
            <li key={ind}>
              <span className={`route-dot ind-${ind}`} aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </div>

      <div className="route-box">
      <div ref={boxRef} className="route-inner">
        <svg className="route-arrows" aria-hidden>
          <defs>
            <marker id="route-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
            </marker>
          </defs>
          {lines.map((l) => (
            <path key={l.key} d={l.d} fill="none" stroke="var(--muted)" strokeWidth="1.6" markerEnd="url(#route-arrow)" />
          ))}
        </svg>
        <div className="route-layers">
          {layers.map((layer, i) => (
            <div key={i} className="route-layer">
              {layer.map((s) => (
                <button key={s.id} data-step={s.id} className={`route-node ind-${s.indicator} ${selected === s.id ? "on" : ""}`}
                  aria-label={nodeLabel(s)} aria-pressed={selected === s.id} onClick={() => onSelect(s.id)}>
                  <span className="route-node-head">
                    <span className="route-num">{s.position}</span>
                    <Ico name={ICON[s.status]} className="route-icon" />
                  </span>
                  <b className="route-title">{s.title}</b>
                  <span className="route-due">{dueLine(s)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
