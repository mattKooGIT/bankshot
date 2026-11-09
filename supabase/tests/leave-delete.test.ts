import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs, setToday, type Db } from "./harness";
import { A, B, C, migrated } from "./fixtures";

const PUBLIC = "00000000-0000-4000-8000-000000000001";

/** A owns a room; B joins, then C (so B is the earliest non-owner member). Everyone holds SGA there and in Public. */
async function world(opts: { ends?: string } = {}) {
  const { db } = await migrated();
  await db.q(`insert into auth.users (id, email) values ($1, 'c@example.com')`, [C]);
  await setToday(db, "2026-11-09");
  await actAs(db, A);
  const [{ r }] = await db.q(`select create_room('Friends', 5000, null, $1) r`, [opts.ends ?? null]);
  for (const u of [B, C]) {
    await actAs(db, u);
    await db.q(`select join_room($1)`, [r.invite_code]);
    await db.q(`select pg_sleep(0.01)`); // distinct joined_at
  }
  for (const u of [A, B, C]) {
    await actAs(db, u);
    await db.q(`select execute_trade($1, 'SGA', 'buy', 1)`, [r.id]);
    await db.q(`select execute_trade(public_room_id(), 'SGA', 'buy', 1)`);
  }
  return { db, room: r.id as string };
}
const members = (db: Db, room: string) => db.q(`select user_id from room_members where room_id = $1 order by joined_at`, [room]).then((r) => r.map((x) => x.user_id));
const owner = (db: Db, room: string) => db.q(`select owner_id from rooms where id = $1`, [room]).then((r) => r[0]?.owner_id);

test("leaving removes only your data in that room", async () => {
  const { db, room } = await world();
  await actAs(db, C);
  await db.q(`select leave_room($1)`, [room]);
  assert.deepEqual(await members(db, room), [A, B]);
  assert.equal((await db.q(`select 1 from holdings where user_id = $1 and room_id = $2`, [C, room])).length, 0);
  assert.equal((await db.q(`select 1 from trades where user_id = $1 and room_id = $2`, [C, room])).length, 0);
  assert.equal((await db.q(`select 1 from holdings where user_id = $1 and room_id = $2`, [C, PUBLIC])).length, 1);
});

test("owner leaving passes ownership to the earliest member", async () => {
  const { db, room } = await world();
  await actAs(db, A);
  await db.q(`select leave_room($1)`, [room]);
  assert.equal(await owner(db, room), B);
  assert.deepEqual(await members(db, room), [B, C]);
});

test("last member leaving deletes the room", async () => {
  const { db, room } = await world();
  for (const u of [C, B, A]) { await actAs(db, u); await db.q(`select leave_room($1)`, [room]); }
  assert.equal((await db.q(`select 1 from rooms where id = $1`, [room])).length, 0);
});

test("can't leave the Public room or a room that has ended; non-members can't leave", async () => {
  const { db, room } = await world({ ends: "2026-11-20" });
  await actAs(db, B);
  await assert.rejects(db.q(`select leave_room(public_room_id())`), /You can't leave the Public room\./);
  await setToday(db, "2026-11-21");
  await assert.rejects(db.q(`select leave_room($1)`, [room]), /This room has ended\./);
  await setToday(db, "2026-11-09");
  await db.q(`delete from room_members where room_id = $1 and user_id = $2`, [room, B]);
  await assert.rejects(db.q(`select leave_room($1)`, [room]), /You are not in this room\./);
});

test("only the owner can delete; deleting removes everyone's room data but not Public", async () => {
  const { db, room } = await world();
  await actAs(db, B);
  await assert.rejects(db.q(`select delete_room($1)`, [room]), /Only the room owner can do that\./);
  await assert.rejects(db.q(`select delete_room(public_room_id())`), /The Public room can't be changed\./);
  await actAs(db, A);
  await db.q(`select delete_room($1)`, [room]);
  assert.equal((await db.q(`select 1 from rooms where id = $1`, [room])).length, 0);
  assert.equal((await db.q(`select 1 from holdings where room_id = $1`, [room])).length, 0);
  assert.equal((await db.q(`select 1 from trades where room_id = $1`, [room])).length, 0);
  assert.equal((await db.q(`select 1 from holdings where room_id = $1`, [PUBLIC])).length, 3);
});

test("owner can delete a room after it has ended", async () => {
  const { db, room } = await world({ ends: "2026-11-20" });
  await setToday(db, "2026-11-25");
  await actAs(db, A);
  await db.q(`select delete_room($1)`, [room]);
  assert.equal((await db.q(`select 1 from rooms where id = $1`, [room])).length, 0);
});
