import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs, setToday, type Db } from "./harness";
import { A, B, migrated, playNight, privateRoom } from "./fixtures";

const board = (db: Db, room: string) =>
  db.q<{ rank: number; username: string; net_worth: string; is_me: boolean }>(`select * from leaderboard($1)`, [room]);

test("net worth recorded per room", async () => {
  const { db } = await migrated();
  await privateRoom(db);
  await playNight(db, "2026-10-30");
  const rows = await db.q(`select room_id from net_worth_history where user_id = $1`, [A]);
  assert.equal(rows.length, 2);
});

test("finalizes on first game night on or after ends_at", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db, { ends_at: "2026-10-23" });
  await playNight(db, "2026-10-24");
  const [r] = await db.q(`select finalized_at from rooms where id = $1`, [room]);
  assert.notEqual(r.finalized_at, null);
  const members = await db.q(`select final_net_worth from room_members where room_id = $1`, [room]);
  assert.ok(members.every((m) => m.final_net_worth !== null));
});

test("member who never traded finalizes at starting cash", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db, { ends_at: "2026-10-23" });
  await db.q(`insert into room_members (room_id, user_id, cash) values ($1, $2, 5000)`, [room, B]);
  await playNight(db, "2026-10-24");
  const [m] = await db.q(`select final_net_worth from room_members where room_id = $1 and user_id = $2`, [room, B]);
  assert.equal(m.final_net_worth, "5000.00");
  const [{ username }] = await db.q(`select username from profiles where id = $1`, [B]);
  await actAs(db, A);
  const usernames = (await board(db, room)).map((r) => r.username);
  assert.ok(usernames.includes(username));
});

test("final standings frozen after finalization", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db, { ends_at: "2026-10-23" });
  await setToday(db, "2026-10-23");
  await actAs(db, A);
  await db.q(`select execute_trade($1, 'SGA', 'buy', 10)`, [room]);
  await actAs(db, null);
  await playNight(db, "2026-10-24");
  await actAs(db, A);
  const before = await board(db, room);
  await actAs(db, null);
  await db.q(`update players set price = price * 2 where ticker = 'SGA'`);
  await playNight(db, "2026-10-25");
  await actAs(db, A);
  assert.deepEqual(await board(db, room), before);
});

test("public leaderboard works signed out", async () => {
  const { db } = await migrated();
  await actAs(db, null);
  const rows = await board(db, "00000000-0000-4000-8000-000000000001");
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((r) => r.is_me === false));
});

test("private leaderboard hidden from non-members", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db);
  await actAs(db, B);
  assert.equal((await board(db, room)).length, 0);
});
