// Fake ESPN server for previewing the live scoreboard without a real game on.
// Usage: npm run fake-espn  (in one terminal), then  npm run preview:fake-live  (another),
//        and open http://localhost:3001/scores
//
// Serves /scoreboard and /summary?event=<id> in ESPN's shape. Uses tonight's real
// schedule, makes the first three games live / halftime / final (OT), and invents
// box scores for the real listed players on those teams. Stats and the game clock
// advance with time so you can watch the page update itself.
import http from "node:http";

const PORT = Number(process.env.FAKE_ESPN_PORT ?? 8765);
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const started = Date.now();

const real = await (await fetch(`${ESPN}/scoreboard`)).json();
const players = SB_URL
  ? await (await fetch(`${SB_URL}/rest/v1/players?select=espn_id,name,team,avg_min,avg_pts,avg_reb,avg_ast,avg_stl,avg_blk,avg_tov&active=eq.true`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })).json()
  : [];
if (!Array.isArray(players)) throw new Error(`Couldn't load players: ${JSON.stringify(players)}`);

const events = (real.events ?? []).filter((e) => e.season?.type === 2 || e.season?.type === 3);
if (events.length === 0) throw new Error("No real games today to build fake ones from.");

// Game "progress" 0..1: live game advances over ~20 minutes of wall time.
const progress = () => Math.min(0.95, 0.55 + (Date.now() - started) / (20 * 60_000) * 0.4);
const PLAN = [
  { kind: "live", progress },
  { kind: "half", progress: () => 0.5 },
  { kind: "final", progress: () => 1.08 },
];

function teamsOf(e) {
  const c = e.competitions[0].competitors;
  return { home: c.find((t) => t.homeAway === "home"), away: c.find((t) => t.homeAway === "away") };
}

// Deterministic pseudo-random per player so numbers don't jump around between polls.
function rand(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function line(p, frac) {
  const hot = 0.6 + rand(p.espn_id) * 0.9; // 0.6x..1.5x of season averages
  const s = (avg) => Math.max(0, Math.round(Number(avg) * hot * frac));
  return { min: Math.round(Number(p.avg_min) * frac), pts: s(p.avg_pts), reb: s(p.avg_reb), ast: s(p.avg_ast),
           stl: s(p.avg_stl), blk: s(p.avg_blk), tov: s(p.avg_tov) };
}

function box(e, frac) {
  const NAMES = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"];
  const { home, away } = teamsOf(e);
  return {
    boxscore: {
      players: [away, home].map((t) => ({
        team: { abbreviation: t.team.abbreviation },
        statistics: [{
          names: NAMES,
          athletes: players.filter((p) => p.team === t.team.abbreviation).map((p) => {
            const l = line(p, frac);
            return {
              athlete: { id: p.espn_id, displayName: p.name }, didNotPlay: false,
              stats: [l.min, l.pts, "0-0", "0-0", "0-0", l.reb, l.ast, l.tov, l.stl, l.blk, 0, l.reb, 0, "0"].map(String),
            };
          }),
        }],
      })),
    },
  };
}

function scoreFor(e, abbr, frac) {
  const pts = players.filter((p) => p.team === abbr).reduce((s, p) => s + line(p, frac).pts, 0);
  return String(Math.max(pts, Math.round(110 * frac * (0.9 + rand(e.id + abbr) * 0.2))));
}

function fakeEvent(e, i) {
  const plan = PLAN[i];
  if (!plan) return e; // the rest stay upcoming
  const frac = plan.progress();
  const { home, away } = teamsOf(e);
  for (const t of [home, away]) t.score = scoreFor(e, t.team.abbreviation, frac);
  if (plan.kind === "live") {
    const q = Math.min(4, Math.floor(frac * 4) + 1);
    const left = 12 * (q - frac * 4);
    e.status = { period: q, displayClock: `${Math.floor(left)}:${String(Math.floor((left % 1) * 60)).padStart(2, "0")}`,
                 type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false } };
  } else if (plan.kind === "half") {
    e.status = { period: 2, displayClock: "0.0", type: { name: "STATUS_HALFTIME", state: "in", completed: false } };
  } else {
    e.status = { period: 5, displayClock: "0.0", type: { name: "STATUS_FINAL", state: "post", completed: true } };
  }
  return e;
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sb = { ...real, events: structuredClone(events).map(fakeEvent) };
  let body;
  if (url.pathname === "/scoreboard") body = sb;
  else if (url.pathname === "/summary") {
    const i = sb.events.findIndex((e) => e.id === url.searchParams.get("event"));
    body = i >= 0 ? box(sb.events[i], PLAN[i]?.progress() ?? 0) : { boxscore: { players: [] } };
  } else { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}).listen(PORT, () => {
  const names = events.slice(0, 3).map((e) => { const { home, away } = teamsOf(e); return `${away.team.abbreviation}@${home.team.abbreviation}`; });
  console.log(`Fake ESPN on http://127.0.0.1:${PORT} · live: ${names[0]}, halftime: ${names[1]}, final/OT: ${names[2]} · ${players.length} players`);
});
