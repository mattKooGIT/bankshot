// Characterization tests for migrations 0001–0005 (behavior already shipped).
import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs, addRealPlayers, freshDb, signUp } from "./harness";

const ROSTER = [
  { espn_id: "1", name: "Nikola Jokic", team: "DEN", pos: "C" as const },
  { espn_id: "2", name: "Zion Williamson", team: "NO", pos: "F" as const },
  { espn_id: "3", name: "Kenrich Williams", team: "OKC", pos: "F" as const },
  { espn_id: "4", name: "Jalen Green", team: "PHX", pos: "G" as const },
  { espn_id: "5", name: "Javonte Green", team: "DET", pos: "F" as const },
];
const A = "00000000-0000-0000-0000-00000000000a";

async function market() {
  const db = await freshDb({ through: "0005" });
  await addRealPlayers(db, ROSTER);
  return db;
}

test("bootstrap links seed JOKIC to accent-free 'Nikola Jokic'", async () => {
  const db = await market();
  const [row] = await db.q(`select espn_id, active from players where ticker = 'JOKIC'`);
  assert.deepEqual(row, { espn_id: "1", active: true });
});

test("readable tickers: WILLIAMSON and JALGREEN", async () => {
  const db = await market();
  const rows = await db.q<{ ticker: string; name: string }>(`select ticker, name from players where espn_id in ('2','4')`);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.name, r.ticker])),
    { "Zion Williamson": "WILLIAMSON", "Jalen Green": "JALGREEN" });
});

test("buying an injured player succeeds", async () => {
  const db = await market();
  await db.q(`update players set out_nights = 2 where ticker = 'JOKIC'`);
  await signUp(db, A, "a@example.com");
  await actAs(db, A);
  const [{ r }] = await db.q(`select execute_trade('JOKIC', 'buy', 1) r`);
  assert.equal(r.shares, 1);
});

test("applying the same game night twice throws", async () => {
  const db = await market();
  await db.q(`insert into games values ('n1', '2026-10-30', '2026-10-30T23:00Z', 'STATUS_FINAL', 'DEN', 'NO', 1, 2)`);
  await db.q(`select apply_real_game_night('2026-10-30')`);
  await assert.rejects(db.q(`select apply_real_game_night('2026-10-30')`), /already applied/);
});

test("an unfinished date throws", async () => {
  const db = await market();
  await db.q(`insert into games values ('n2', '2026-10-31', '2026-10-31T23:00Z', 'STATUS_IN_PROGRESS', 'DEN', 'NO', null, null)`);
  await assert.rejects(db.q(`select apply_real_game_night('2026-10-31')`), /Not every game/);
});
