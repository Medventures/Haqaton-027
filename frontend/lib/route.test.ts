import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayers, routeEdges, type RouteNode } from "./route.ts";

const node = (id: number, service_id: string, depends_on: string[] = []): RouteNode => ({ id, service_id, depends_on });
const ids = (layers: RouteNode[][]) => layers.map((l) => l.map((s) => s.service_id));

test("chain: PMPK → tutor, MSE alongside", () => {
  const steps = [node(1, "EDU_PMPK"), node(2, "SOC_MSE_REEXAM"), node(3, "EDU_TUTOR", ["EDU_PMPK"])];
  assert.deepEqual(ids(computeLayers(steps)), [["EDU_PMPK", "SOC_MSE_REEXAM"], ["EDU_TUTOR"]]);
  assert.deepEqual(routeEdges(steps), [[1, 3]]);
});

test("longer chain takes the max depth of dependencies", () => {
  const steps = [node(1, "A"), node(2, "B", ["A"]), node(3, "C", ["B", "A"])];
  assert.deepEqual(ids(computeLayers(steps)), [["A"], ["B"], ["C"]]);
});

test("steps without dependencies share layer 0", () => {
  const steps = [node(1, "A"), node(2, "B"), node(3, "C")];
  assert.deepEqual(ids(computeLayers(steps)), [["A", "B", "C"]]);
  assert.deepEqual(routeEdges(steps), []);
});

test("dependency on a missing step is ignored", () => {
  const steps = [node(1, "SOC_MSE", ["MED_MSE_REF"]), node(2, "B")];
  assert.deepEqual(ids(computeLayers(steps)), [["SOC_MSE", "B"]]);
  assert.deepEqual(routeEdges(steps), []);
});

test("dependency listed before its parent in plan order", () => {
  const steps = [node(1, "CHILD", ["PARENT"]), node(2, "PARENT")];
  assert.deepEqual(ids(computeLayers(steps)), [["PARENT"], ["CHILD"]]);
});

test("a cycle does not hang", () => {
  const steps = [node(1, "A", ["B"]), node(2, "B", ["A"])];
  const layers = computeLayers(steps);
  assert.equal(layers.flat().length, 2);
});

test("empty plan", () => {
  assert.deepEqual(computeLayers([]), []);
});
