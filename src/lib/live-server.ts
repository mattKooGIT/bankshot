import { cacheLife } from "next/cache";
import { boxScorePlan, parseBoxScore, parseScoreboard, withStaleness, type LiveData, type LiveLine } from "./live";

// LIVE_ESPN_BASE lets tests point at a dead or fake server.
const BASE = process.env.LIVE_ESPN_BASE ?? "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "courtside-exchange/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

async function fetchBox(id: string): Promise<LiveLine[]> {
  return parseBoxScore(await getJson(`${BASE}/summary?event=${id}`), id);
}

/** A finished game's box score never changes, so it's fetched once and kept for hours. */
async function fetchFinalBox(id: string): Promise<LiveLine[]> {
  "use cache";
  cacheLife("hours");
  return fetchBox(id);
}

/** Scoreboard plus box scores. Shared by every viewer for 15s. */
async function fetchLive(): Promise<LiveData> {
  "use cache";
  cacheLife({ stale: 15, revalidate: 15, expire: 30 });

  const games = parseScoreboard(await getJson(`${BASE}/scoreboard`));
  const plan = boxScorePlan(games);
  // All in parallel (5s timeout each), so a slow ESPN can't stack up waits.
  const results = await Promise.allSettled([...plan.live.map(fetchBox), ...plan.final.map(fetchFinalBox)]);
  // One missing box score shouldn't blank the whole board.
  const lines = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return { games, lines, updatedAt: new Date().toISOString(), stale: false };
}

// Best effort: a fresh serverless instance starts without one.
let lastGood: LiveData | null = null;

/** Live data, or the last good result marked stale when ESPN is down or changed shape. */
export async function getLiveData(): Promise<LiveData> {
  try {
    const data = await fetchLive();
    lastGood = data;
    return withStaleness(data, new Date());
  } catch {
    return {
      games: lastGood?.games ?? [],
      lines: lastGood?.lines ?? [],
      updatedAt: lastGood?.updatedAt ?? new Date().toISOString(),
      stale: true,
    };
  }
}
