import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs, setToday, signUp } from "./harness";
import { A, B, C, cashIn, migrated, privateRoom } from "./fixtures";


test("migrates existing users into Public", async () => {
  const { db, cashBefore } = await migrated();
  const [{ pub }] = await db.q(`select public_room_id() pub`);
  assert.equal(await cashIn(db, pub, A), cashBefore);
  const [h] = await db.q(`select room_id, shares from holdings where user_id = $1`, [A]);
  assert.deepEqual(h, { room_id: pub, shares: 3 });
  const [t] = await db.q(`select room_id from trades where user_id = $1`, [A]);
  assert.equal(t.room_id, pub);
  const cols = await db.q(`select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'cash'`);
  assert.equal(cols.length, 0);
});

test("new sign-up joins Public with 10000", async () => {
  const { db } = await migrated();
  await signUp(db, C, "c@example.com");
  const [{ pub }] = await db.q(`select public_room_id() pub`);
  assert.equal(await cashIn(db, pub, C), 10000);
});

test("cash is separate per room", async () => {
  const { db, cashBefore } = await migrated();
  const room = await privateRoom(db);
  const [{ pub }] = await db.q(`select public_room_id() pub`);
  await actAs(db, A);
  await db.q(`select execute_trade($1, 'SGA', 'buy', 2)`, [room]);
  assert.equal(await cashIn(db, pub, A), cashBefore);
  const [h] = await db.q(`select shares from holdings where room_id = $1 and user_id = $2 and ticker = 'SGA'`, [room, A]);
  assert.equal(h.shares, 2);
});

test("only Public trades move demand", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db);
  const demand = async () => Number((await db.q(`select pending_demand from players where ticker = 'SGA'`))[0].pending_demand);
  const start = await demand();
  await actAs(db, A);
  await db.q(`select execute_trade($1, 'SGA', 'buy', 2)`, [room]);
  assert.equal(await demand(), start);
  await db.q(`select execute_trade(public_room_id(), 'SGA', 'buy', 1)`);
  assert.equal(await demand(), start + 1);
});

test("non-member cannot trade", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db);
  await actAs(db, B);
  await assert.rejects(db.q(`select execute_trade($1, 'SGA', 'buy', 1)`, [room]), /You are not in this room\./);
});

test("trading allowed on end date, locked after (US Eastern)", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db, { ends_at: "2026-12-25" });
  await actAs(db, A);
  await setToday(db, "2026-12-25");
  await db.q(`select execute_trade($1, 'SGA', 'buy', 1)`, [room]);
  await setToday(db, "2026-12-26");
  await assert.rejects(db.q(`select execute_trade($1, 'SGA', 'buy', 1)`, [room]), /This room has ended\./);
});

test("finalized room is locked", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db);
  await db.q(`update rooms set finalized_at = now() where id = $1`, [room]);
  await actAs(db, A);
  await assert.rejects(db.q(`select execute_trade($1, 'SGA', 'sell', 1)`, [room]), /This room has ended\./);
});
