import { test } from "node:test";
import assert from "node:assert/strict";
import { marketIndex, topMovers } from "./landing";
import type { Player } from "./market";

const p = (ticker: string, total: number | null) =>
  ({ ticker, last_move: total === null ? null : { total } } as unknown as Player);

test("topMovers: biggest risers and fallers, ignoring unmoved players", () => {
  const players = [p("A", 0.05), p("B", -0.08), p("C", 0.12), p("D", null), p("E", 0), p("F", -0.01), p("G", 0.02)];
  const { up, down } = topMovers(players, 2);
  assert.deepEqual(up.map((x) => x.ticker), ["C", "A"]);
  assert.deepEqual(down.map((x) => x.ticker), ["B", "F"]);
});

test("topMovers: nothing before the first game night", () => {
  assert.deepEqual(topMovers([p("A", null), p("B", null)]), { up: [], down: [] });
});

test("marketIndex: real history when there are 2+ nights, else a gentle synthetic line", () => {
  assert.deepEqual(marketIndex([{ night: 0, avg: 40 }, { night: 1, avg: 41 }]), [40, 41]);
  const fake = marketIndex([{ night: 0, avg: 40 }]);
  assert.equal(fake.length, 24);
  assert.ok(fake[23] > fake[0]);
});
