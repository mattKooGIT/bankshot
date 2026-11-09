import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs, addRealPlayers, applyMigration, freshDb, setToday, signUp, type Db } from "./harness";

export const A = "00000000-0000-0000-0000-00000000000a";
export const B = "00000000-0000-0000-0000-00000000000b";
const ROSTER = [
  { espn_id: "1", name: "Shai Gilgeous-Alexander", team: "OKC", pos: "G" as const },
  { espn_id: "2", name: "Nikola Jokic", team: "DEN", pos: "C" as const },
];

/** Pre-rooms world (0001–0005) where A owns 3 SGA, then 0006 applied. */
async function migrated(): Promise<{ db: Db; cashBefore: number }> {
  const db = await freshDb({ through: "0005" });
  await addRealPlayers(db, ROSTER);
  await signUp(db, A, "a@example.com");
  await signUp(db, B, "b@example.com");
  await actAs(db, A);
  await db.q(`select execute_trade('SGA', 'buy', 3)`);
  const [{ cash }] = await db.q(`select cash from profiles where id = $1`, [A]);
  await actAs(db, null);
  await applyMigration(db, "0006");
  return { db, cashBefore: Number(cash) };
}

/** A private room owned by A with A as a member holding `cash`. */
async function privateRoom(db: Db, opts: { cash?: number; ends_at?: string | null } = {}) {
  const [{ id }] = await db.q(
    `insert into rooms (name, owner_id, invite_code, starting_cash, ends_at)
     values ('Friends', $1, 'abc123abc123', $2, $3) returning id`,
    [A, opts.cash ?? 5000, opts.ends_at ?? null],
  );
  await db.q(`insert into room_members (room_id, user_id, cash) values ($1, $2, $3)`, [id, A, opts.cash ?? 5000]);
  return id as string;
}

const cashIn = async (db: Db, room: string, user: string) =>
  Number((await db.q(`select cash from room_members where room_id = $1 and user_id = $2`, [room, user]))[0].cash);

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
  const C = "00000000-0000-0000-0000-00000000000c";
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
