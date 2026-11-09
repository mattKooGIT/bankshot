import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs } from "./harness";
import { A, B, migrated } from "./fixtures";

test("hidden accounts are left off leaderboards without leaving a gap in the ranks", async () => {
  const { db } = await migrated(); // A owns SGA, so A has the top Public net worth
  await db.q(`update profiles set hidden = true where id = $1`, [A]);
  const rows = await db.q<{ rank: string; username: string }>(`select rank, username from leaderboard(public_room_id())`);
  const [{ username: aName }] = await db.q(`select username from profiles where id = $1`, [A]);
  const [{ username: bName }] = await db.q(`select username from profiles where id = $1`, [B]);
  assert.ok(!rows.some((r) => r.username === aName));
  assert.equal(rows[0].username, bName);
  assert.deepEqual(rows.map((r) => Number(r.rank)), rows.map((_, i) => i + 1));
});

test("hidden accounts can still trade", async () => {
  const { db } = await migrated();
  await db.q(`update profiles set hidden = true where id = $1`, [A]);
  await actAs(db, A);
  const [{ r }] = await db.q(`select execute_trade(public_room_id(), 'SGA', 'buy', 1) r`);
  assert.equal(r.shares, 1);
});
