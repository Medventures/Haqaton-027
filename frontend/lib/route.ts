/** Route view layout: pure functions, no React (tested with node --test). */

export interface RouteNode {
  id: number;
  service_id: string;
  depends_on: string[];
}

/**
 * Layers of the route: depth 0 for a step without dependencies, otherwise 1 + max depth of its dependencies.
 * Dependencies on steps that are not in the plan are ignored; a cycle is cut where it is found.
 * Steps keep their plan order inside a layer.
 */
export function computeLayers<T extends RouteNode>(steps: T[]): T[][] {
  const bySid = new Map(steps.map((s) => [s.service_id, s]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  function depthOf(s: T): number {
    const known = depth.get(s.service_id);
    if (known !== undefined) return known;
    visiting.add(s.service_id);
    let d = 0;
    for (const dep of s.depends_on) {
      const parent = bySid.get(dep);
      if (!parent || visiting.has(dep)) continue;
      d = Math.max(d, depthOf(parent) + 1);
    }
    visiting.delete(s.service_id);
    depth.set(s.service_id, d);
    return d;
  }

  const layers: T[][] = [];
  for (const s of steps) {
    const d = depthOf(s);
    (layers[d] ??= []).push(s);
  }
  return layers.filter(Boolean);
}

/** Arrows for the route: [from step id, to step id] for every dependency that exists in the plan. */
export function routeEdges(steps: RouteNode[]): [number, number][] {
  const bySid = new Map(steps.map((s) => [s.service_id, s.id]));
  const out: [number, number][] = [];
  for (const s of steps) {
    for (const dep of s.depends_on) {
      const from = bySid.get(dep);
      if (from !== undefined && from !== s.id) out.push([from, s.id]);
    }
  }
  return out;
}
