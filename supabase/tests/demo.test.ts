import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs, asRole, setToday, type Db } from "./harness";
import { A, B, migrated } from "./fixtures";

const G = "00000000-0000-0000-0000-0000000000a1"; // the guest
const BOTS = { bucket_getter: "00000000-0000-0000-0000-0000000000b1", fade_master: "00000000-0000-0000-0000-0000000000b2", sixth_man: "00000000-0000-0000-0000-0000000000b3" };
const START_NIGHT_DATE = ["2026-11-06", "2026-11-07", "2026-11-08"];

/** 30 active players P01 (priciest) … P30 with prices for `nights` game nights; 3 hidden bots; one anonymous guest. */
async function demoWorld(nights = 3) {
  const { db } = await migrated();
  await setToday(db, "2026-11-09");
  await db.q(`update players set active = false where true`);
  for (let i = 1; i <= 30; i++) {
    await db.q(
      `insert into players (ticker, name, position, avg_pts, avg_reb, avg_ast, avg_stl, avg_blk, avg_tov, price)
       values ($1, $2, 'G', 20, 5, 5, 1, 1, 2, $3)`, [`P${String(i).padStart(2, "0")}`, `Player ${i}`, 131 - i]);
  }
  for (let k = 1; k <= nights; k++) {
    await db.q(`insert into game_nights (night, game_date) values ($1, $2)`, [k, START_NIGHT_DATE[k - 1]]);
    // Night k moves every price by a per-player amount, so standings change night to night.
    await db.q(`insert into price_history (ticker, night, price)
                select ticker, $1::int, round(price * (1 + ((substr(ticker, 2)::int % 5) - 2) * 0.01 * $1::int), 2)
                from players where active`, [k]);
  }
  if (nights > 0) {
    await db.q(`update players p set price = h.price from price_history h
                where h.ticker = p.ticker and h.night = $1`, [nights]);
  }
  for (const [name, id] of Object.entries(BOTS)) {
    await db.q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@bankshot.invalid`]);
    await db.q(`update profiles set hidden = true where id = $1`, [id]);
  }
  await db.q(`insert into auth.users (id, email, is_anonymous) values ($1, null, true)`, [G]);
  return db;
}

const seed = async (db: Db, who = G) => (await db.q(`select seed_demo($1) id`, [who]))[0].id as string;
const count = async (db: Db, sql: string, params: unknown[] = []) => Number((await db.q(`select count(*) n from (${sql}) x`, params))[0].n);

test("seed_demo builds a Demo League with bots, holdings, history and a lively feed", async () => {
  const db = await demoWorld();
  const room = await seed(db);
  const [r] = await db.q(`select name, owner_id, is_public, starting_cash from rooms where id = $1`, [room]);
  assert.deepEqual([r.name, r.owner_id, r.is_public, Number(r.starting_cash)], ["Demo League", G, false, 10000]);
  assert.equal(await count(db, `select 1 from room_members where room_id = $1`, [room]), 4);

  for (const user of [G, ...Object.values(BOTS)]) {
    const holdings = await db.q(`select h.shares, h.avg_cost, ph.price from holdings h
      join price_history ph on ph.ticker = h.ticker and ph.night = 1 where h.room_id = $1 and h.user_id = $2`, [room, user]);
    assert.equal(holdings.length, 4, `holdings for ${user}`);
    const spent = holdings.reduce((s, h) => s + h.shares * Number(h.price), 0);
    assert.ok(spent >= 8000 && spent <= 9500, `spent ${spent}`);
    assert.ok(holdings.every((h) => Number(h.avg_cost) === Number(h.price)));
    const [{ cash }] = await db.q(`select cash from room_members where room_id = $1 and user_id = $2`, [room, user]);
    assert.equal(Number(cash), Math.round((10000 - spent) * 100) / 100);
    assert.equal(await count(db, `select 1 from net_worth_history where room_id = $1 and user_id = $2`, [room, user]), 3);
  }
  const guestTickers = (await db.q(`select ticker from holdings where room_id = $1 and user_id = $2 order by ticker`, [room, G])).map((h) => h.ticker);
  const byPrice = (await db.q(`select ticker from players where active order by price desc, ticker`)).map((p) => p.ticker);
  assert.deepEqual(guestTickers, [byPrice[0], byPrice[4], byPrice[8], byPrice[12]].sort());

  const ev = await db.q(`select e.id, e.kind, e.parent_id, e.payload, e.created_at, p.username
    from room_events e left join profiles p on p.id = e.actor_id where e.room_id = $1 order by e.id`, [room]);
  assert.equal(ev.filter((e) => e.kind === "night").length, 1);
  assert.equal(ev.find((e) => e.kind === "night")!.payload.night, 3);
  const comments = ev.filter((e) => e.kind === "comment");
  assert.deepEqual(comments.map((c) => c.payload.text).sort(),
    ["buy low, cry later", "fade_master you're cooked", "welcome to the league 👋"]);
  const replies = ev.filter((e) => e.kind === "reply");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].username, "sixth_man");
  assert.equal(replies[0].payload.text, "@fade_master check the standings first");
  assert.equal(String(replies[0].parent_id), String(comments.find((c) => c.payload.text === "fade_master you're cooked")!.id));
  const trades = ev.filter((e) => e.kind === "trade");
  assert.equal(trades.length, 16);
  const [{ cutoff }] = await db.q(`select now() - interval '1 hour' cutoff`);
  assert.ok(trades.every((t) => new Date(t.created_at) < new Date(cutoff)), "trade events are back-dated");

  const emojis = (await db.q(`select emoji from room_event_reactions x join room_events e on e.id = x.event_id
    where e.room_id = $1`, [room])).map((x) => x.emoji);
  assert.ok(emojis.includes("🐐") && emojis.includes("🧊"));

  const [prof] = await db.q(`select username, hidden from profiles where id = $1`, [G]);
  assert.match(prof.username, /^guest_\d{4}$/);
  assert.equal(prof.hidden, true);
});

test("seeding twice returns the same room and adds nothing", async () => {
  const db = await demoWorld();
  const first = await seed(db);
  const before = [await count(db, `select 1 from room_events`), await count(db, `select 1 from trades`), await count(db, `select 1 from holdings`)];
  assert.equal(await seed(db), first);
  assert.deepEqual([await count(db, `select 1 from room_events`), await count(db, `select 1 from trades`), await count(db, `select 1 from holdings`)], before);
});

test("seed_demo rejects real users and needs the bots", async () => {
  const db = await demoWorld();
  await assert.rejects(seed(db, A), /Not a guest\./);
  await db.q(`delete from auth.users where id = $1`, [BOTS.fade_master]);
  await assert.rejects(seed(db), /Demo bots are missing\./);
});

test("with no game nights yet, the seed still works at current prices", async () => {
  const db = await demoWorld(0);
  const room = await seed(db);
  assert.equal(await count(db, `select 1 from holdings where room_id = $1`, [room]), 16);
  assert.equal(await count(db, `select 1 from room_events where room_id = $1 and kind = 'night'`, [room]), 0);
  assert.equal(await count(db, `select 1 from net_worth_history where room_id = $1`, [room]), 0);
  const [h] = await db.q(`select h.avg_cost, p.price from holdings h join players p using (ticker) where room_id = $1 limit 1`, [room]);
  assert.equal(Number(h.avg_cost), Number(h.price));
});

test("hidden accounts' Public trades never add to market demand", async () => {
  const db = await demoWorld();
  const demand = async () => Number((await db.q(`select pending_demand d from players where ticker = 'P02'`))[0].d);
  await actAs(db, BOTS.bucket_getter);
  await db.q(`select execute_trade(public_room_id(), 'P02', 'buy', 5)`);
  assert.equal(await demand(), 0);
  await actAs(db, A);
  await db.q(`select execute_trade(public_room_id(), 'P02', 'buy', 5)`);
  assert.equal(await demand(), 5);
  await db.q(`select execute_trade(public_room_id(), 'P02', 'sell', 2)`);
  assert.equal(await demand(), 3);
  await actAs(db, BOTS.bucket_getter);
  await db.q(`select execute_trade(public_room_id(), 'P02', 'sell', 5)`);
  assert.equal(await demand(), 3);
});

test("delete_stale_guests removes day-old guests and their rooms, and nothing else", async () => {
  const db = await demoWorld();
  const oldRoom = await seed(db);
  // The old guest also joined B's real room.
  await actAs(db, B);
  const [{ r: real }] = await db.q(`select create_room('Real league', 5000, null, null) r`);
  await actAs(db, G);
  await db.q(`select join_room($1)`, [real.invite_code]);
  await actAs(db, null);
  await db.q(`update auth.users set created_at = now() - interval '25 hours' where id = $1`, [G]);
  const NEW = "00000000-0000-0000-0000-0000000000a2";
  await db.q(`insert into auth.users (id, is_anonymous, created_at) values ($1, true, now() - interval '1 hour')`, [NEW]);
  const newRoom = await seed(db, NEW);

  assert.equal((await db.q(`select delete_stale_guests() n`))[0].n, 1);
  assert.equal(await count(db, `select 1 from auth.users where id = $1`, [G]), 0);
  assert.equal(await count(db, `select 1 from rooms where id = $1`, [oldRoom]), 0);
  assert.equal(await count(db, `select 1 from rooms where id = $1`, [newRoom]), 1);
  assert.equal(await count(db, `select 1 from rooms where id = $1`, [real.id]), 1);
  assert.equal(await count(db, `select 1 from room_members where room_id = $1 and user_id = $2`, [real.id, B]), 1);
  assert.equal(await count(db, `select 1 from room_members where room_id = $1 and user_id = $2`, [real.id, G]), 0);
  assert.equal(await count(db, `select 1 from auth.users where id = any($1)`, [[A, B, NEW, ...Object.values(BOTS)]]), 6);
});

test("seed_demo and delete_stale_guests are service-role only", async () => {
  const db = await demoWorld();
  await actAs(db, G);
  await asRole(db, "authenticated");
  await assert.rejects(seed(db), /permission denied/);
  await assert.rejects(db.q(`select delete_stale_guests()`), /permission denied/);
  await asRole(db, null);
});
