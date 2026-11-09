import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs } from "./harness";
import { A, B, migrated, privateRoom } from "./fixtures";

test("a hidden account still sees itself on its own leaderboards; others never do", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db); // A owns it and is its only member
  await db.q(`update profiles set hidden = true where id = $1`, [A]);
  await actAs(db, A);
  const mine = await db.q(`select is_me from leaderboard($1)`, [room]);
  assert.deepEqual(mine.map((r) => r.is_me), [true]);
  const pub = await db.q(`select is_me from leaderboard(public_room_id())`);
  assert.ok(pub.some((r) => r.is_me));
  await actAs(db, B);
  const [{ username }] = await db.q(`select username from profiles where id = $1`, [A]);
  assert.ok(!(await db.q(`select username from leaderboard(public_room_id())`)).some((r) => r.username === username));
});
