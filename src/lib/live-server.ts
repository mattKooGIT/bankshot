import { cacheLife } from "next/cache";
import { parseBoxScore, parseScoreboard, type LiveData, type LiveLine } from "./live";

// LIVE_ESPN_BASE lets tests point at a dead or fake server.
const BASE = process.env.LIVE_ESPN_BASE ?? "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "courtside-exchange/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

/** Scoreboard plus box scores for live and finished games. Shared by every viewer for 15s. */
async function fetchLive(): Promise<LiveData> {
  "use cache";
  cacheLife({ stale: 15, revalidate: 15, expire: 60 });

  const games = parseScoreboard(await getJson(`${BASE}/scoreboard`));
  const started = games.filter((g) => g.state !== "pre");
  const lines: LiveLine[] = [];
  for (let i = 0; i < started.length; i += 4) {
    const batch = await Promise.allSettled(
      started.slice(i, i + 4).map(async (g) => parseBoxScore(await getJson(`${BASE}/summary?event=${g.id}`), g.id)),
    );
    // One missing box score shouldn't blank the whole board.
    for (const r of batch) if (r.status === "fulfilled") lines.push(...r.value);
  }
  return { games, lines, updatedAt: new Date().toISOString(), stale: false };
}

// Best effort: a fresh serverless instance starts without one.
let lastGood: LiveData | null = null;

/** Live data, or the last good result marked stale when ESPN is down or changed shape. */
export async function getLiveData(): Promise<LiveData> {
  try {
    const data = await fetchLive();
    lastGood = data;
    return data;
  } catch {
    return {
      games: lastGood?.games ?? [],
      lines: lastGood?.lines ?? [],
      updatedAt: lastGood?.updatedAt ?? new Date().toISOString(),
      stale: true,
    };
  }
}
