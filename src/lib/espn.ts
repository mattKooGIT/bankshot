// ESPN's public (unofficial, keyless) NBA JSON. Shapes verified Nov 2026; if ESPN
// changes them, parsing fails loudly here rather than writing bad data.

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

export type EspnGame = {
  espn_id: string;
  game_date: string; // YYYY-MM-DD (US Eastern scoreboard date)
  start_time: string;
  status: string; // STATUS_FINAL, STATUS_SCHEDULED, ...
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
};

export type EspnLine = {
  game_id: string;
  espn_id: string;
  name: string;
  team: string;
  position: "G" | "F" | "C";
  game_date: string;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number;
};

export type EspnInjury = { espn_id: string; name: string; status: string; note: string };

async function getJson<T>(url: string, attempt = 1): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "courtside-exchange/1.0" }, cache: "no-store" });
  if (res.ok) return res.json() as Promise<T>;
  if (attempt < 3 && (res.status >= 500 || res.status === 429)) {
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return getJson(url, attempt + 1);
  }
  throw new Error(`ESPN ${res.status} for ${url}`);
}

/** Collapse ESPN positions (PG, SG, SF, PF, G-F, F-C …) into G / F / C by their first part. */
export function toPosition(abbr: string | undefined): "G" | "F" | "C" {
  const first = (abbr ?? "").toUpperCase().split("-")[0];
  if (first.endsWith("G")) return "G";
  if (first === "C") return "C";
  return "F";
}

/** Regular-season (2) and postseason (3) games on a US-Eastern date. Preseason is skipped. */
export async function fetchGames(date: string): Promise<EspnGame[]> {
  type Sb = { events?: {
    id: string; date: string; season?: { type?: number };
    status: { type: { name: string } };
    competitions: { competitors: { homeAway: "home" | "away"; score?: string; team: { abbreviation: string } }[] }[];
  }[] };
  const sb = await getJson<Sb>(`${BASE}/scoreboard?dates=${date.replaceAll("-", "")}&limit=100`);
  return (sb.events ?? [])
    .filter((e) => e.season?.type === 2 || e.season?.type === 3)
    .map((e) => {
      const c = e.competitions[0].competitors;
      const home = c.find((t) => t.homeAway === "home")!;
      const away = c.find((t) => t.homeAway === "away")!;
      const final = e.status.type.name === "STATUS_FINAL";
      return {
        espn_id: e.id, game_date: date, start_time: e.date, status: e.status.type.name,
        home_team: home.team.abbreviation, away_team: away.team.abbreviation,
        home_score: final ? Number(home.score) : null, away_score: final ? Number(away.score) : null,
      };
    });
}

/** Stat lines for everyone who played (MIN > 0) in a game. */
export async function fetchBoxScore(game: EspnGame): Promise<EspnLine[]> {
  type Box = { boxscore: { players?: {
    team: { abbreviation: string };
    statistics: { names?: string[]; labels?: string[]; athletes: {
      athlete: { id: string; displayName: string; position?: { abbreviation?: string } };
      didNotPlay?: boolean; stats: string[];
    }[] }[];
  }[] } };
  const box = await getJson<Box>(`${BASE}/summary?event=${game.espn_id}`);
  const lines: EspnLine[] = [];
  for (const team of box.boxscore.players ?? []) {
    const block = team.statistics[0];
    const names = block.names ?? block.labels ?? [];
    const col = (k: string) => {
      const i = names.indexOf(k);
      if (i < 0) throw new Error(`ESPN box score for ${game.espn_id} has no ${k} column`);
      return i;
    };
    const idx = { MIN: col("MIN"), PTS: col("PTS"), REB: col("REB"), AST: col("AST"), STL: col("STL"), BLK: col("BLK"), TO: col("TO") };
    for (const a of block.athletes) {
      if (a.didNotPlay || a.stats.length === 0) continue;
      const v = (k: keyof typeof idx) => parseInt(a.stats[idx[k]], 10) || 0;
      if (v("MIN") <= 0) continue;
      lines.push({
        game_id: game.espn_id, espn_id: a.athlete.id, name: a.athlete.displayName,
        team: team.team.abbreviation, position: toPosition(a.athlete.position?.abbreviation),
        game_date: game.game_date,
        min: v("MIN"), pts: v("PTS"), reb: v("REB"), ast: v("AST"), stl: v("STL"), blk: v("BLK"), tov: v("TO"),
      });
    }
  }
  return lines;
}

/** League-wide injury report. */
export async function fetchInjuries(): Promise<EspnInjury[]> {
  type Inj = { injuries: { injuries: {
    status: string; shortComment?: string; longComment?: string;
    athlete: { displayName: string; links?: { href: string }[] };
  }[] }[] };
  const data = await getJson<Inj>(`${BASE}/injuries`);
  const out: EspnInjury[] = [];
  for (const team of data.injuries) {
    for (const i of team.injuries) {
      const id = i.athlete.links?.map((l) => l.href.match(/\/id\/(\d+)/)?.[1]).find(Boolean);
      if (id) out.push({ espn_id: id, name: i.athlete.displayName, status: i.status, note: i.shortComment ?? i.longComment ?? i.status });
    }
  }
  return out;
}

export const headshotUrl = (espnId: string) => `https://a.espncdn.com/i/headshots/nba/players/full/${espnId}.png`;
