// Live scoreboard: pure parsing and polling rules for ESPN's public NBA JSON.
// No Next.js imports, so it runs in the browser, on the server, and in tests.

export type LiveTeam = { abbr: string; score: number | null };

export type LiveGame = {
  id: string;
  state: "pre" | "in" | "post";
  status: string; // "Q3 4:12", "Half", "7:30 PM ET", "Final/OT"
  period: number;
  clock: string;
  startTime: string;
  home: LiveTeam;
  away: LiveTeam;
};

export type LiveLine = {
  espnId: string;
  name: string;
  team: string;
  gameId: string;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number;
  fp: number;
};

export type LiveData = { games: LiveGame[]; lines: LiveLine[]; updatedAt: string; stale: boolean };

/** Same formula as the database's player_game_stats.fp, rounded to 0.1. */
export function fantasyPoints(l: Pick<LiveLine, "pts" | "reb" | "ast" | "stl" | "blk" | "tov">): number {
  return Math.round((l.pts + 1.2 * l.reb + 1.5 * l.ast + 3 * l.stl + 3 * l.blk - l.tov) * 10) / 10;
}

const tipTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

function overtime(period: number) {
  const n = period - 4;
  return n === 1 ? "OT" : `${n}OT`;
}

function statusLabel(state: LiveGame["state"], name: string, period: number, clock: string, startTime: string): string {
  if (state === "pre") return `${tipTime.format(new Date(startTime))} ET`;
  if (state === "post") return period > 4 ? `Final/${overtime(period)}` : "Final";
  if (name === "STATUS_HALFTIME") return "Half";
  const p = period > 4 ? overtime(period) : `Q${period}`;
  if (name === "STATUS_END_PERIOD") return `End ${p}`;
  return `${p} ${clock}`;
}

const ORDER = { in: 0, pre: 1, post: 2 } as const;

type SbEvent = {
  id: string; date: string; season?: { type?: number };
  status: { period?: number; displayClock?: string; type: { name: string; state: string } };
  competitions: { competitors: { homeAway: "home" | "away"; score?: string; team: { abbreviation: string } }[] }[];
};

/** Tonight's regular-season and playoff games: live first, then upcoming by tip-off, then final. */
export function parseScoreboard(json: unknown): LiveGame[] {
  const events = ((json as { events?: SbEvent[] }).events ?? []).filter(
    (e) => e.season?.type === 2 || e.season?.type === 3,
  );
  return events
    .map((e): LiveGame => {
      const state = (["pre", "in", "post"].includes(e.status.type.state) ? e.status.type.state : "pre") as LiveGame["state"];
      const period = e.status.period ?? 0;
      const clock = e.status.displayClock ?? "";
      const team = (side: "home" | "away"): LiveTeam => {
        const c = e.competitions[0].competitors.find((t) => t.homeAway === side)!;
        return { abbr: c.team.abbreviation, score: state === "pre" ? null : Number(c.score ?? 0) };
      };
      return {
        id: e.id, state, period, clock, startTime: e.date,
        status: statusLabel(state, e.status.type.name, period, clock, e.date),
        home: team("home"), away: team("away"),
      };
    })
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
}

type Box = { boxscore: { players?: {
  team: { abbreviation: string };
  statistics: { names?: string[]; labels?: string[]; athletes: {
    athlete: { id: string; displayName: string }; didNotPlay?: boolean; stats: string[];
  }[] }[];
}[] } };

/** Every athlete who has played (including someone who just checked in with 0 MIN); DNPs skipped. */
export function parseBoxScore(json: unknown, gameId: string): LiveLine[] {
  const lines: LiveLine[] = [];
  for (const team of (json as Box).boxscore.players ?? []) {
    const block = team.statistics[0];
    const names = block.names ?? block.labels ?? [];
    const col = (k: string) => {
      const i = names.indexOf(k);
      if (i < 0) throw new Error(`ESPN box score for ${gameId} has no ${k} column`);
      return i;
    };
    const idx = { MIN: col("MIN"), PTS: col("PTS"), REB: col("REB"), AST: col("AST"), STL: col("STL"), BLK: col("BLK"), TO: col("TO") };
    for (const a of block.athletes) {
      if (a.didNotPlay || a.stats.length === 0) continue;
      const v = (k: keyof typeof idx) => parseInt(a.stats[idx[k]], 10) || 0;
      const line = { pts: v("PTS"), reb: v("REB"), ast: v("AST"), stl: v("STL"), blk: v("BLK"), tov: v("TO") };
      lines.push({
        espnId: a.athlete.id, name: a.athlete.displayName, team: team.team.abbreviation, gameId,
        min: v("MIN"), ...line, fp: fantasyPoints(line),
      });
    }
  }
  return lines;
}

export const TIP_WINDOW_MS = 15 * 60 * 1000;

/** Keep polling while a game is live or one tips off within 15 minutes. */
export function shouldPoll(games: LiveGame[], now: Date): boolean {
  return games.some((g) =>
    g.state === "in" || (g.state === "pre" && new Date(g.startTime).getTime() - now.getTime() <= TIP_WINDOW_MS));
}

/** Live lines for these players, matched by ESPN id (never by team: players get traded). */
export function matchLines<T extends { espnId: string }>(items: T[], lines: LiveLine[]): Map<string, LiveLine> {
  const byId = new Map(lines.map((l) => [l.espnId, l]));
  const out = new Map<string, LiveLine>();
  for (const it of items) {
    const l = byId.get(it.espnId);
    if (l) out.set(it.espnId, l);
  }
  return out;
}

const STALE_AFTER_MS = 45_000;

/** Data older than 45s counts as delayed even if the cache still serves it. */
export function withStaleness(d: LiveData, now: Date): LiveData {
  const old = now.getTime() - new Date(d.updatedAt).getTime() > STALE_AFTER_MS;
  return old && !d.stale ? { ...d, stale: true } : d;
}

/** Live games' box scores are refetched every cycle; final ones never change, so they're cached long. */
export function boxScorePlan(games: LiveGame[]): { live: string[]; final: string[] } {
  return {
    live: games.filter((g) => g.state === "in").map((g) => g.id),
    final: games.filter((g) => g.state === "post").map((g) => g.id),
  };
}
