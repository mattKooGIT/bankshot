import { test } from "node:test";
import assert from "node:assert/strict";
import { niceTicks, tickLabel } from "./chart-ticks";

test("niceTicks always covers the highest and lowest value", () => {
  const cases: [number, number][] = [[32.8, 41.45], [30.2, 30.9], [1.02, 1.97], [9.5, 120], [50, 50], [99.99, 100.01]];
  for (const [min, max] of cases) {
    const t = niceTicks(min, max);
    assert.ok(t[0] <= min, `${min}-${max}: bottom ${t[0]}`);
    assert.ok(t.at(-1)! >= max, `${min}-${max}: top ${t.at(-1)}`);
    assert.ok(t.length >= 2 && t.length <= 6, `${min}-${max}: ${t.length} ticks`);
  }
});

test("Hartenstein's range gets a tick above $41.45", () => {
  assert.deepEqual(niceTicks(32.8, 41.45), [32.5, 35, 37.5, 40, 42.5]);
});

test("tickLabel keeps the decimals a tick needs", () => {
  assert.equal(tickLabel(32.5), "$32.50");
  assert.equal(tickLabel(40), "$40");
  assert.equal(tickLabel(1.25), "$1.25");
  assert.equal(tickLabel(5), "$5.00");
});
