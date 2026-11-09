import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs } from "./harness";
import { migrated, playNight } from "./fixtures";

test("market_index returns one average price per night, signed out", async () => {
  const { db } = await migrated();
  await playNight(db, "2026-10-30");
  await actAs(db, null);
  const rows = await db.q<{ night: number; avg: string }>(`select * from market_index()`);
  assert.deepEqual(rows.map((r) => r.night), [0, 1]);
  const [{ avg0 }] = await db.q(`select round(avg(h.price), 2) avg0 from price_history h join players p using (ticker) where night = 0 and p.active`);
  assert.equal(rows[0].avg, avg0);
});
