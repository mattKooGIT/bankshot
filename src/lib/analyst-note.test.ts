import { test } from "node:test";
import assert from "node:assert/strict";
import { analystNote, type GameRow, type Mate, type Note, type NoteInput } from "./analyst-note";

// ---- fixture helpers -------------------------------------------------------

type Day = { date: string; mins: Record<string, [number, number]> };

function season({ team, games }: { team: string; games: Day[] }): GameRow[] {
  return games.flatMap((g) =>
    Object.entries(g.mins).map(([espn_id, [min, fp]]) => ({
      game_id: `${team}-${g.date}`, game_date: g.date, espn_id, team, min, fp,
    })),
  );
}

/** Consecutive November dates starting on the 1st. */
const day = (i: number) => `2026-11-${String(i + 1).padStart(2, "0")}`;

const mate = (espn_id: string, name: string, extra: Partial<Mate> = {}): Mate => ({
  espn_id, name, avg_min: 30, out_nights: 0, injury_note: null, ...extra,
});

const HART = { ...mate("h", "Isaiah Hartenstein", { avg_min: 22 }), team: "OKC" };
const CHET = mate("c", "Chet Holmgren", { out_nights: 4, injury_note: "Out: hip" });

const produced: string[] = [];
function run(input: NoteInput): Note | null {
  const note = analystNote(input);
  if (note) produced.push(...note.paragraphs);
  return note;
}

/** Hartenstein-like: 3 games with Chet (22.1), then 12 without (34.2). */
function hartSeason(): GameRow[] {
  const games: Day[] = [];
  for (let i = 0; i < 3; i++) games.push({ date: day(i), mins: { h: [22, 22.1], c: [30, 40] } });
  for (let i = 3; i < 15; i++) games.push({ date: day(i), mins: { h: [24, 34.2] } });
  return season({ team: "OKC", games });
}

// ---- 1. Bigger role --------------------------------------------------------

test("Bigger role fires with the exact sentence", () => {
  const note = run({ player: HART, teammates: [CHET], games: hartSeason(), prices: [] });
  assert.deepEqual(note, {
    tag: "Bigger role",
    paragraphs: [
      "Isaiah Hartenstein is averaging 34.2 FP in the 12 games Chet Holmgren has missed, vs 22.1 with him (+55%). With Chet Holmgren out, that larger role could stick around.",
    ],
  });
});

test("Bigger role silent: only 2 games without", () => {
  const games: Day[] = [];
  for (let i = 0; i < 5; i++) games.push({ date: day(i), mins: { h: [22, 22.1], c: [30, 40] } });
  for (let i = 5; i < 7; i++) games.push({ date: day(i), mins: { h: [24, 34.2] } });
  assert.equal(run({ player: HART, teammates: [CHET], games: season({ team: "OKC", games }), prices: [] }), null);
});

test("Bigger role silent: gain only +10%", () => {
  const games: Day[] = [];
  for (let i = 0; i < 3; i++) games.push({ date: day(i), mins: { h: [22, 30], c: [30, 40] } });
  for (let i = 3; i < 8; i++) games.push({ date: day(i), mins: { h: [22, 33] } });
  assert.equal(run({ player: HART, teammates: [CHET], games: season({ team: "OKC", games }), prices: [] }), null);
});

test("Bigger role silent: gain only +2 FP (even though +20%)", () => {
  const games: Day[] = [];
  for (let i = 0; i < 3; i++) games.push({ date: day(i), mins: { h: [22, 10], c: [30, 40] } });
  for (let i = 3; i < 8; i++) games.push({ date: day(i), mins: { h: [22, 12] } });
  assert.equal(run({ player: HART, teammates: [CHET], games: season({ team: "OKC", games }), prices: [] }), null);
});

test("Bigger role silent: teammate is not a key player (avg_min 20)", () => {
  const note = run({ player: HART, teammates: [{ ...CHET, avg_min: 20 }], games: hartSeason(), prices: [] });
  assert.equal(note, null);
});

test("Bigger role silent: out teammate has not played at all this season", () => {
  const games = hartSeason().filter((r) => r.espn_id !== "c");
  assert.equal(run({ player: HART, teammates: [CHET], games, prices: [] }), null);
});

test("Two teammates out: only the largest split shows", () => {
  const SGA = mate("s", "Shai Gilgeous-Alexander", { out_nights: 2 });
  const games: Day[] = [];
  // Chet plays 0-2 (h 22.1); SGA plays 0-5 (so h without SGA = games 6-14)
  for (let i = 0; i < 15; i++) {
    const mins: Day["mins"] = { h: [24, i < 3 ? 22.1 : 34.2] };
    if (i < 3) mins.c = [30, 40];
    if (i < 6) mins.s = [34, 50];
    games.push({ date: day(i), mins });
  }
  const note = run({ player: HART, teammates: [CHET, SGA], games: season({ team: "OKC", games }), prices: [] })!;
  assert.equal(note.tag, "Bigger role");
  assert.equal(note.paragraphs.length, 1);
  assert.match(note.paragraphs[0], /Chet Holmgren has missed/);
});

// ---- 2. Role may shrink ----------------------------------------------------

function shrinkSeason(): GameRow[] {
  const games: Day[] = [];
  // 0-4: with Chet at 22; 5-9: without (Chet misses 5 before the latest); 10: Chet back
  for (let i = 0; i < 5; i++) games.push({ date: day(i), mins: { h: [22, 22], c: [30, 40] } });
  for (let i = 5; i < 10; i++) games.push({ date: day(i), mins: { h: [22, 33] } });
  games.push({ date: day(10), mins: { h: [22, 22], c: [30, 40] } });
  return season({ team: "OKC", games });
}

test("Role may shrink fires with the exact sentence", () => {
  const note = run({ player: HART, teammates: [{ ...CHET, out_nights: 0 }], games: shrinkSeason(), prices: [] });
  assert.deepEqual(note, {
    tag: "Role may shrink",
    paragraphs: [
      "Chet Holmgren is back as of Nov 11. Isaiah Hartenstein's numbers ran 50% higher without him, so they may cool off from here.",
    ],
  });
});

test("Role may shrink silent: teammate missed only 2 of the 5 before", () => {
  // Chet misses days 0-2 and 7-8; the 5 before the latest (days 5-9) hold only 2 misses
  const games: Day[] = [];
  for (let i = 0; i < 11; i++) {
    const out = i <= 2 || i === 7 || i === 8;
    games.push({ date: day(i), mins: out ? { h: [22, 33] } : { h: [22, 22], c: [30, 40] } });
  }
  const note = run({ player: HART, teammates: [{ ...CHET, out_nights: 0 }], games: season({ team: "OKC", games }), prices: [] });
  assert.equal(note, null);
});

test("Role may shrink silent: teammate did not play the latest game", () => {
  const games = shrinkSeason().filter((r) => !(r.espn_id === "c" && r.game_date === day(10)));
  assert.equal(run({ player: HART, teammates: [{ ...CHET, out_nights: 0 }], games, prices: [] }), null);
});

// ---- 3. Sidelined ----------------------------------------------------------

test("Sidelined fires with the note text after 'Out: '", () => {
  const note = run({
    player: { ...HART, out_nights: 3, injury_note: "Out: Hamstring strain, re-evaluated in two weeks." },
    teammates: [], games: [], prices: [],
  });
  assert.deepEqual(note, {
    tag: "Sidelined",
    paragraphs: ["Isaiah Hartenstein is out: Hamstring strain, re-evaluated in two weeks. Worth watching for a return date."],
  });
});

test("Sidelined trims long, quoted, unprefixed notes to 160 characters", () => {
  const long = `He said "it's sore" <b>` + "x".repeat(300);
  const note = run({ player: { ...HART, out_nights: 1, injury_note: long }, teammates: [], games: [], prices: [] })!;
  const body = note.paragraphs[0].slice("Isaiah Hartenstein is out: ".length, -". Worth watching for a return date.".length);
  assert.equal(body.length, 160);
  assert.ok(body.endsWith("…"));
  assert.ok(body.startsWith(`He said "it's sore" <b>`));
});

test("Sidelined with no injury note", () => {
  const note = run({ player: { ...HART, out_nights: 1, injury_note: null }, teammates: [], games: [], prices: [] })!;
  assert.deepEqual(note.paragraphs, ["Isaiah Hartenstein is out. Worth watching for a return date."]);
});

test("Ordering: Sidelined comes before a split; at most 2 signals", () => {
  const player = { ...HART, out_nights: 2, injury_note: "Out: ankle" };
  const note = run({ player, teammates: [CHET], games: hartSeason(), prices: [] })!;
  assert.equal(note.tag, "Sidelined");
  assert.equal(note.paragraphs.length, 2);
  assert.match(note.paragraphs[1], /Chet Holmgren has missed/);
});

test("Limit: three firing signals still give 2 paragraphs", () => {
  // sidelined + bigger role + heating up (last 5 way up in fp and minutes)
  const games: Day[] = [];
  for (let i = 0; i < 3; i++) games.push({ date: day(i), mins: { h: [15, 12], c: [30, 40] } });
  for (let i = 3; i < 10; i++) games.push({ date: day(i), mins: { h: [15, 14] } });
  for (let i = 10; i < 15; i++) games.push({ date: day(i), mins: { h: [32, 40] } });
  const note = run({
    player: { ...HART, out_nights: 1, injury_note: "Out: knee" },
    teammates: [CHET], games: season({ team: "OKC", games }), prices: [],
  })!;
  assert.equal(note.paragraphs.length, 2);
});

// ---- 4. Heating up / Cooling off -------------------------------------------

function streak(base: [number, number], last: [number, number], n = 10): GameRow[] {
  const games: Day[] = [];
  for (let i = 0; i < n - 5; i++) games.push({ date: day(i), mins: { h: base } });
  for (let i = n - 5; i < n; i++) games.push({ date: day(i), mins: { h: last } });
  return season({ team: "OKC", games });
}

test("Heating up fires with the exact sentence", () => {
  // season: min (20*5+30*5)/10 = 25, fp (20*5+40*5)/10 = 30; last 5: 30 min, 40 fp (+33%)
  const note = run({ player: HART, teammates: [], games: streak([20, 20], [30, 40]), prices: [] });
  assert.deepEqual(note, {
    tag: "Heating up",
    paragraphs: [
      "Playing 30.0 minutes a night over his last 5 games (up from 25.0), averaging 40.0 FP vs 30.0 on the season. Worth watching.",
    ],
  });
});

test("Cooling off fires with the exact sentence", () => {
  // season: min 25, fp 30; last 5: 20 min, 20 fp (-33%)
  const note = run({ player: HART, teammates: [], games: streak([30, 40], [20, 20]), prices: [] });
  assert.deepEqual(note, {
    tag: "Cooling off",
    paragraphs: [
      "Playing 20.0 minutes a night over his last 5 games (down from 25.0), averaging 20.0 FP vs 30.0 on the season. May be worth keeping an eye on.",
    ],
  });
});

test("Streak silent: fewer than 8 games played", () => {
  assert.equal(run({ player: HART, teammates: [], games: streak([20, 20], [30, 40], 7), prices: [] }), null);
});

test("Streak silent: FP up but minutes flat", () => {
  assert.equal(run({ player: HART, teammates: [], games: streak([25, 20], [25, 40]), prices: [] }), null);
});

// ---- Market line -----------------------------------------------------------

test("Market line appears at +15% after Heating up", () => {
  const note = run({ player: HART, teammates: [], games: streak([20, 20], [30, 40]), prices: [100, 101, 105, 108, 112, 115] })!;
  assert.match(note.paragraphs[0], / Worth watching\. The market has partly noticed: price up 15% in 5 nights\.$/);
});

test("Market line absent at +14%", () => {
  const note = run({ player: HART, teammates: [], games: streak([20, 20], [30, 40]), prices: [100, 101, 105, 108, 112, 114] })!;
  assert.doesNotMatch(note.paragraphs[0], /market/);
});

test("Market line after Bigger role", () => {
  const note = run({ player: HART, teammates: [CHET], games: hartSeason(), prices: [10, 10, 11, 12, 12, 12] })!;
  assert.match(note.paragraphs[0], /could stick around\. The market has partly noticed: price up 20% in 5 nights\.$/);
});

test("Down line after Cooling off at -15%", () => {
  const note = run({ player: HART, teammates: [], games: streak([30, 40], [20, 20]), prices: [100, 99, 95, 90, 88, 85] })!;
  assert.match(note.paragraphs[0], /keeping an eye on\. Price already down 15% in 5 nights\.$/);
});

// ---- Trades, empties, wording ----------------------------------------------

test("Trade: only games with the current team count", () => {
  // 10 games with NYK at a low level, then 5 with OKC at a steady level → no streak on OKC
  const nyk = season({ team: "NYK", games: Array.from({ length: 10 }, (_, i) => ({ date: day(i), mins: { h: [10, 5] as [number, number] } })) });
  const okc = season({ team: "OKC", games: Array.from({ length: 10 }, (_, i) => ({ date: day(i + 10), mins: { h: [30, 30] as [number, number] } })) });
  assert.equal(run({ player: HART, teammates: [], games: [...nyk, ...okc], prices: [] }), null);
});

test("No games and no signal: null", () => {
  assert.equal(run({ player: HART, teammates: [CHET], games: [], prices: [] }), null);
});

test("Wording: nothing produced says buy, sell or hold", () => {
  assert.ok(produced.length > 10, "the other tests produced text");
  for (const p of produced) assert.doesNotMatch(p, /\b(buy|sell|hold)\b/i, p);
});

test("Sidelined stays first even against a split over +1000%", () => {
  const games: Day[] = [];
  for (let i = 0; i < 2; i++) games.push({ date: day(i), mins: { h: [5, 1], c: [30, 40] } });
  for (let i = 2; i < 5; i++) games.push({ date: day(i), mins: { h: [20, 15] } });
  const note = run({
    player: { ...HART, out_nights: 1, injury_note: "Out: ankle" },
    teammates: [CHET], games: season({ team: "OKC", games }), prices: [],
  })!;
  assert.equal(note.tag, "Sidelined");
  assert.match(note.paragraphs[1], /\+1400%/);
});
