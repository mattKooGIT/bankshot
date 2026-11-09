import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs, setToday } from "./harness";
import { A, B, playNight } from "./fixtures";
import { feedWorld } from "./feed-fixtures";

type Standing = { username: string; net_worth: number; change_pct: number; rank: number; prev_rank: number | null };
const nightEvents = (db: Awaited<ReturnType<typeof feedWorld>>["db"], room: string) =>
  db.q<{ payload: { night: number; standings: Standing[] } }>(`select payload from room_events where room_id = $1 and kind = 'night' order by id`, [room]);

async function twoNights() {
  const w = await feedWorld();
  await actAs(w.db, A);
  await w.db.q(`select execute_trade($1, 'SGA', 'buy', 20)`, [w.room]);
  await actAs(w.db, null);
  await playNight(w.db, "2026-10-30");
  return w;
}

test("night 1: one post per private room, change from starting cash, no previous rank; re-run posts nothing", async () => {
  const { db, room } = await twoNights();
  assert.equal((await db.q(`select post_night_results(1) n`))[0].n, 1);
  const [ev] = await nightEvents(db, room);
  assert.equal(ev.payload.night, 1);
  assert.equal(ev.payload.standings.length, 2);
  for (const s of ev.payload.standings) {
    assert.equal(s.prev_rank, null);
    assert.ok(Math.abs(Number(s.change_pct) - (Number(s.net_worth) / 5000 - 1)) < 1e-4);
  }
  assert.equal((await db.q(`select post_night_results(1) n`))[0].n, 0);
  assert.equal((await nightEvents(db, room)).length, 1);
});

test("night 2: change and previous rank come from night 1", async () => {
  const { db, room } = await twoNights();
  await db.q(`select post_night_results(1)`);
  await playNight(db, "2026-10-31");
  await db.q(`select post_night_results(2)`);
  const [n1, n2] = (await nightEvents(db, room)).map((e) => e.payload.standings);
  for (const s of n2) {
    const before = n1.find((x) => x.username === s.username)!;
    assert.equal(s.prev_rank, before.rank);
    assert.ok(Math.abs(Number(s.change_pct) - (Number(s.net_worth) / Number(before.net_worth) - 1)) < 1e-4);
  }
});

test("a room gets its final night's results, and nothing after it ends", async () => {
  const { db } = await feedWorld();
  await setToday(db, "2026-10-29");
  await actAs(db, A);
  const [{ r }] = await db.q(`select create_room('Short', 5000, null, '2026-10-30') r`);
  await actAs(db, null);
  await playNight(db, "2026-10-30");
  await db.q(`select post_night_results(1)`);
  await playNight(db, "2026-10-31");
  await db.q(`select post_night_results(2)`);
  assert.deepEqual((await nightEvents(db, r.id)).map((e) => e.payload.night), [1]);
});

test("my_recap: null before any night; after two nights, ranks and best/worst holdings", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  assert.equal((await db.q(`select my_recap($1) r`, [room]))[0].r, null);
  await db.q(`select execute_trade($1, 'SGA', 'buy', 10)`, [room]);
  await db.q(`select execute_trade($1, 'JOKIC', 'buy', 10)`, [room]);
  await actAs(db, null);
  await playNight(db, "2026-10-30");
  await playNight(db, "2026-10-31");
  await actAs(db, A);
  const [{ r }] = await db.q(`select my_recap($1) r`, [room]);
  assert.equal(r.night, 2);
  const friends = r.rooms.find((x: { room_id: string }) => x.room_id === room);
  assert.equal(friends.size, 2);
  assert.ok([1, 2].includes(friends.rank) && [1, 2].includes(friends.prev_rank));
  assert.ok(r.rooms.some((x: { is_public: boolean }) => x.is_public));
  const moves = await db.q(`select ticker, (last_move->>'total')::numeric t from players where ticker in ('SGA','JOKIC')`);
  const hi = moves.reduce((a, b) => (Number(a.t) >= Number(b.t) ? a : b));
  const lo = moves.reduce((a, b) => (Number(a.t) < Number(b.t) ? a : b));
  assert.equal(r.best.ticker, hi.ticker);
  assert.equal(r.worst.ticker, lo.ticker);
  await actAs(db, B);
  assert.ok((await db.q(`select my_recap(null) r`))[0].r.rooms.length >= 1);
});
