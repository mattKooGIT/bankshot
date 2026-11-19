// Analyst notes: short, suggestive explanations of why a player's production is
// changing, built from real box scores. Pure: no I/O. Rules and copy follow
// docs/superpowers/specs/2026-11-19-analyst-notes-design.md §2.

export type GameRow = { game_id: string; game_date: string; espn_id: string; team: string; min: number; fp: number };
export type Mate = { espn_id: string; name: string; avg_min: number; out_nights: number; injury_note: string | null };
/** `prices` are oldest first; the last value is the current price. */
export type NoteInput = { player: Mate & { team: string }; teammates: Mate[]; games: GameRow[]; prices: number[] };
export type NoteTag = "Bigger role" | "Role may shrink" | "Sidelined" | "Heating up" | "Cooling off";
export type Note = { tag: NoteTag; paragraphs: string[] };

const KEY_MIN = 24;
const SPLIT_MIN_WITHOUT = 3;
const SPLIT_MIN_WITH = 2;
const SPLIT_MIN_PCT = 0.15;
const SPLIT_MIN_FP = 3.0;
const SHRINK_FACTOR = 0.9;
const STREAK_MIN_GAMES = 8;
const STREAK_FP_PCT = 0.2;
const STREAK_MIN_PCT = 0.1;
const MARKET_PCT = 0.15;
const NOTE_MAX = 160;
const MAX_SIGNALS = 2;
const EPS = 1e-9;

type Signal = { tag: NoteTag; text: string; strength: number; market?: "up" | "down" };
type Split = { without: number; with: number; nWithout: number; pct: number };

const fp1 = (x: number) => x.toFixed(1);
const pctAbs = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const pctSigned = (x: number) => `${x >= 0 ? "+" : "−"}${pctAbs(x)}`;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monDay(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function analystNote(input: NoteInput): Note | null {
  const { player, teammates, prices } = input;
  const teamRows = input.games.filter((r) => r.team === player.team);

  // Team games, oldest first.
  const dates = new Map<string, string>();
  for (const r of teamRows) if (!dates.has(r.game_id)) dates.set(r.game_id, r.game_date);
  const teamGames = [...dates.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : 1))
    .map(([id, date]) => ({ id, date }));

  const played = (espnId: string) =>
    new Set(teamRows.filter((r) => r.espn_id === espnId && r.min > 0).map((r) => r.game_id));
  const order = new Map(teamGames.map((g, i) => [g.id, i]));
  const mine = teamRows
    .filter((r) => r.espn_id === player.espn_id && r.min > 0)
    .sort((a, b) => order.get(a.game_id)! - order.get(b.game_id)!);

  const split = (mateId: string): Split | null => {
    const theirs = played(mateId);
    const w = mine.filter((r) => theirs.has(r.game_id)).map((r) => r.fp);
    const wo = mine.filter((r) => !theirs.has(r.game_id)).map((r) => r.fp);
    if (wo.length < SPLIT_MIN_WITHOUT || w.length < SPLIT_MIN_WITH) return null;
    const withAvg = avg(w), withoutAvg = avg(wo);
    if (withAvg <= 0) return null;
    const pct = withoutAvg / withAvg - 1;
    if (pct < SPLIT_MIN_PCT - EPS || withoutAvg - withAvg < SPLIT_MIN_FP - EPS) return null;
    return { without: withoutAvg, with: withAvg, nWithout: wo.length, pct };
  };

  const signals: Signal[] = [];
  const keyMates = teammates.filter((t) => t.espn_id !== player.espn_id && t.avg_min >= KEY_MIN);

  // 3. Sidelined
  if (player.out_nights > 0) {
    signals.push({ tag: "Sidelined", strength: 1000, text: sidelinedText(player.name, player.injury_note) });
  }

  // 1. Bigger role: the largest valid split among key teammates who are out now.
  let best: { t: Mate; s: Split } | null = null;
  for (const t of keyMates) {
    if (t.out_nights <= 0) continue;
    const s = split(t.espn_id);
    if (s && (!best || s.pct > best.s.pct)) best = { t, s };
  }
  if (best) {
    const { t, s } = best;
    signals.push({
      tag: "Bigger role", strength: s.pct * 100, market: "up",
      text: `${player.name} is averaging ${fp1(s.without)} FP in the ${s.nWithout} games ${t.name} has missed, vs ${fp1(s.with)} with him (${pctSigned(s.pct)}). With ${t.name} out, that larger role could stick around.`,
    });
  }

  // 2. Role may shrink: a key teammate just came back after missing 3+ of the 5 before.
  const latest = teamGames.at(-1);
  if (latest) {
    const before = teamGames.slice(-6, -1);
    let shrink: { t: Mate; s: Split } | null = null;
    for (const t of keyMates) {
      if (t.out_nights > 0) continue;
      const theirs = played(t.espn_id);
      if (!theirs.has(latest.id)) continue;
      if (before.filter((g) => !theirs.has(g.id)).length < 3) continue;
      const s = split(t.espn_id);
      if (s && (!shrink || s.pct > shrink.s.pct)) shrink = { t, s };
    }
    if (shrink) {
      const { t, s } = shrink;
      signals.push({
        tag: "Role may shrink", strength: s.pct * 100 * SHRINK_FACTOR, market: "down",
        text: `${t.name} is back as of ${monDay(latest.date)}. ${player.name}'s numbers ran ${pctAbs(s.pct)} higher without him, so they may cool off from here.`,
      });
    }
  }

  // 4. Heating up / Cooling off
  if (mine.length >= STREAK_MIN_GAMES) {
    const last5 = mine.slice(-5);
    const fSeason = avg(mine.map((r) => r.fp)), f5 = avg(last5.map((r) => r.fp));
    const mSeason = avg(mine.map((r) => r.min)), m5 = avg(last5.map((r) => r.min));
    if (fSeason > 0 && mSeason > 0) {
      const fp = f5 / fSeason - 1, mn = m5 / mSeason - 1;
      const up = fp >= STREAK_FP_PCT - EPS && mn >= STREAK_MIN_PCT - EPS;
      const down = fp <= -STREAK_FP_PCT + EPS && mn <= -STREAK_MIN_PCT + EPS;
      if (up || down) {
        signals.push({
          tag: up ? "Heating up" : "Cooling off", strength: Math.abs(fp) * 100, market: up ? "up" : "down",
          text: `Playing ${fp1(m5)} minutes a night over his last 5 games (${up ? "up" : "down"} from ${fp1(mSeason)}), averaging ${fp1(f5)} FP vs ${fp1(fSeason)} on the season. ${up ? "Worth watching." : "May be worth keeping an eye on."}`,
        });
      }
    }
  }

  if (signals.length === 0) return null;
  const shown = signals.sort((a, b) => b.strength - a.strength).slice(0, MAX_SIGNALS);

  // Market line: once, on the first shown signal it applies to.
  const change = priceChange(prices);
  if (change !== null) {
    const dir = change >= MARKET_PCT - EPS ? "up" : change <= -MARKET_PCT + EPS ? "down" : null;
    const target = dir && shown.find((s) => s.market === dir);
    if (target) {
      target.text += dir === "up"
        ? ` The market has partly noticed: price up ${pctAbs(change)} in 5 nights.`
        : ` Price already down ${pctAbs(change)} in 5 nights.`;
    }
  }

  return { tag: shown[0].tag, paragraphs: shown.map((s) => s.text) };
}

/** Change over the last 5 nights, or null without 6 prices. */
function priceChange(prices: number[]): number | null {
  if (prices.length < 6) return null;
  const from = prices[prices.length - 6], to = prices[prices.length - 1];
  return from > 0 ? to / from - 1 : null;
}

function sidelinedText(name: string, note: string | null): string {
  let detail = (note ?? "").trim().replace(/^Out:\s*/i, "").replace(/\.+$/, "").trim();
  if (!detail) return `${name} is out. Worth watching for a return date.`;
  if (detail.length > NOTE_MAX) detail = detail.slice(0, NOTE_MAX - 1).trimEnd() + "…";
  return `${name} is out: ${detail}. Worth watching for a return date.`;
}
