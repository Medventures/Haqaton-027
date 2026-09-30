"use client";

import { useEffect, useState } from "react";
import { RouteView } from "./RouteView";
import { StepCard, type StepPatch } from "./StepCard";
import type { Role, Step } from "@/lib/types";

const VIEW_KEY = "aqylroute.stepsView";

/** Plan steps as a list (default, the fallback) or as the route map; the choice is remembered per browser. */
export function StepsView({ steps, role, version, onPatch, onDelete, onToggleDoc, cardKey, openByDefault }: {
  steps: Step[];
  role: Role;
  version: number;
  onPatch: (id: number, p: StepPatch) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
  onToggleDoc?: (docType: string, have: boolean) => Promise<void>;
  cardKey: (s: Step) => string;
  openByDefault?: (s: Step) => boolean;
}) {
  const [view, setView] = useState<"list" | "route">("list");
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "route") setView("route");
    } catch {}
  }, []);

  function choose(v: "list" | "route") {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  const card = (s: Step, open?: boolean) => (
    <StepCard key={`${cardKey(s)}-${open ? "route" : "list"}`} step={s} role={role} editable onPatch={onPatch} onDelete={onDelete}
      onToggleDoc={onToggleDoc} version={version} defaultOpen={open ?? openByDefault?.(s)} />
  );

  return (
    <>
      <div className="segmented" role="tablist" aria-label="Вид плана" style={{ alignSelf: "flex-start" }}>
        <button role="tab" aria-selected={view === "list"} className={view === "list" ? "active" : ""} onClick={() => choose("list")}>
          Список
        </button>
        <button role="tab" aria-selected={view === "route"} className={view === "route" ? "active" : ""} onClick={() => choose("route")}>
          Маршрут
        </button>
      </div>
      {view === "list" ? (
        <div className="steps">{steps.map((s) => card(s))}</div>
      ) : (
        <>
          <RouteView steps={steps} selected={picked} onSelect={(sid) => {
            setPicked(sid);
            requestAnimationFrame(() => document.getElementById(`step-${sid}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }} />
          {steps.filter((s) => s.id === picked).map((s) => card(s, true))}
        </>
      )}
    </>
  );
}
