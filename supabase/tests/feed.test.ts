import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs } from "./harness";
import { A, B, C } from "./fixtures";
import { events, feedWorld } from "./feed-fixtures";

test("joining posts a join event; the creator's own membership doesn't", async () => {
  const { db, room } = await feedWorld();
  const ev = await events(db, room);
  assert.deepEqual(ev.map((e) => [e.kind, e.actor_id]), [["join", B]]);
});

test("a trade in a private room posts a trade event; a Public trade posts nothing", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  await db.q(`select execute_trade($1, 'SGA', 'buy', 3)`, [room]);
  await db.q(`select execute_trade(public_room_id(), 'SGA', 'buy', 1)`);
  const trades = (await events(db, room)).filter((e) => e.kind === "trade");
  assert.equal(trades.length, 1);
  assert.equal(trades[0].actor_id, A);
  assert.deepEqual({ ...trades[0].payload, price: Number(trades[0].payload.price) > 0 },
    { side: "buy", ticker: "SGA", shares: 3, price: true });
  assert.equal((await db.q(`select 1 from room_events where room_id = public_room_id()`)).length, 0);
});

test("leaving posts a leave event", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, B);
  await db.q(`select leave_room($1)`, [room]);
  assert.deepEqual((await events(db, room)).map((e) => e.kind), ["join", "leave"]);
});

test("deleting a room with events and reactions leaves nothing behind", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  const [{ id }] = await db.q(`select post_comment($1, 'gg') id`, [room]);
  await db.q(`select toggle_reaction($1, '🔥')`, [id]);
  await db.q(`select delete_room($1)`, [room]);
  assert.equal((await db.q(`select 1 from room_events`)).length, 0);
  assert.equal((await db.q(`select 1 from room_event_reactions`)).length, 0);
});

test("post_comment: length, rate limit, members only", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  await assert.rejects(db.q(`select post_comment($1, '   ')`, [room]), /Comments are 1–280 characters\./);
  await assert.rejects(db.q(`select post_comment($1, $2)`, [room, "x".repeat(281)]), /Comments are 1–280 characters\./);
  for (let i = 0; i < 5; i++) await db.q(`select post_comment($1, $2)`, [room, `msg ${i}`]);
  await assert.rejects(db.q(`select post_comment($1, 'one more')`, [room]), /Slow down — try again in a minute\./);
  await actAs(db, C);
  await assert.rejects(db.q(`select post_comment($1, 'hi')`, [room]), /You are not in this room\./);
});

test("toggle_reaction: on, off, on; members only; valid emoji only", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  const [{ id }] = await db.q(`select post_comment($1, 'lol') id`, [room]);
  const t = async () => (await db.q(`select toggle_reaction($1, '😂') is_on`, [id]))[0].is_on;
  assert.deepEqual([await t(), await t(), await t()], [true, false, true]);
  await assert.rejects(db.q(`select toggle_reaction($1, 'lol')`, [id]), /emoji/i);
  await actAs(db, C);
  await assert.rejects(db.q(`select toggle_reaction($1, '🔥')`, [id]), /You are not in this room\./);
});

test("room_feed: newest first, paging, reaction counts and mine; non-members get nothing", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  const ids: string[] = [];
  for (const m of ["one", "two", "three"]) ids.push((await db.q(`select post_comment($1, $2) id`, [room, m]))[0].id);
  await db.q(`select toggle_reaction($1, '🔥')`, [ids[2]]);
  await actAs(db, B);
  await db.q(`select toggle_reaction($1, '🔥')`, [ids[2]]);
  const page = await db.q(`select id, kind, actor, payload, reactions, mine from room_feed($1, null, 2)`, [room]);
  assert.deepEqual(page.map((r) => r.payload.text), ["three", "two"]);
  assert.deepEqual(page[0].reactions, { "🔥": 2 });
  assert.deepEqual(page[0].mine, ["🔥"]);
  const older = await db.q(`select payload from room_feed($1, $2, 10)`, [room, page[1].id]);
  assert.deepEqual(older.map((r) => r.payload.text ?? r.payload.kind ?? "join"), ["one", "join"]);
  await actAs(db, C);
  assert.equal((await db.q(`select 1 from room_feed($1)`, [room])).length, 0);
});
