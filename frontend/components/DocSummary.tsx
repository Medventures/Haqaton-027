import type { Step } from "@/lib/types";

/** Сводка документов по всему маршруту: каждый документ собирается один раз. */
export function DocSummary({ steps }: { steps: Step[] }) {
  const counts = new Map<string, { n: number; have: boolean }>();
  for (const s of steps)
    for (const d of s.documents) {
      const cur = counts.get(d.name) ?? { n: 0, have: false };
      counts.set(d.name, { n: cur.n + 1, have: cur.have || d.have });
    }
  const docs = [...counts.entries()].sort((a, b) => Number(a[1].have) - Number(b[1].have) || b[1].n - a[1].n);
  const totalMentions = docs.reduce((acc, [, v]) => acc + v.n, 0);
  const haveCount = docs.filter(([, v]) => v.have).length;
  if (!docs.length) return null;
  return (
    <div className="card card-tight">
      <h3 className="h-small">Документы по всему маршруту</h3>
      <p className="muted small">
        Шагам нужно {totalMentions} документов, но уникальных — {docs.length}. Каждый собирается один раз и хранится в
        едином пакете у куратора. Есть: {haveCount} из {docs.length}.
      </p>
      <ul className="doc-summary">
        {docs.map(([d, v]) => (
          <li key={d} className={v.have ? "have" : ""}>
            <span>
              {v.have ? "✓ " : "○ "}
              {d}
            </span>
            {v.n > 1 && <span className="pill pill-muted pill-xs">в {v.n} шагах</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
