import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";

export type LastMove = {
  night: number;
  date?: string;
  status: "played" | "injured" | "rest" | "idle";
  line: { pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; min?: number } | null;
  fp: number | null;
  expected: number;
  perf: number;
  gap: number;
  demand: number;
  demand_shares: number;
  noise: number;
  total: number;
};

export type Player = {
  ticker: string;
  name: string;
  position: "G" | "F" | "C";
  team: string | null;
  headshot_url: string | null;
  price: number;
  expected_fp: number;
  avg_pts: number; avg_reb: number; avg_ast: number;
  avg_stl: number; avg_blk: number; avg_tov: number;
  avg_min: number;
  games_played: number;
  out_nights: number;
  injury_note: string | null;
  last5: number[];
  last_move: LastMove | null;
};

const PLAYER_COLUMNS =
  "ticker,name,position,team,headshot_url,price,expected_fp,avg_pts,avg_reb,avg_ast,avg_stl,avg_blk,avg_tov,avg_min,games_played,out_nights,injury_note,last5,last_move";

// Postgres numeric comes back as a string; normalise once here.
function toPlayer(row: Record<string, unknown>): Player {
  const n = (k: string) => Number(row[k] ?? 0);
  return {
    ...(row as unknown as Player),
    price: n("price"), expected_fp: n("expected_fp"),
    avg_pts: n("avg_pts"), avg_reb: n("avg_reb"), avg_ast: n("avg_ast"),
    avg_stl: n("avg_stl"), avg_blk: n("avg_blk"), avg_tov: n("avg_tov"), avg_min: n("avg_min"),
    last5: ((row.last5 as unknown[]) ?? []).map(Number),
  };
}

/** Every listed player. Prices change once per game night, so a few minutes of caching is safe. */
export async function getMarket(): Promise<Player[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("market");
  const { data, error } = await createPublicClient()
    .from("players").select(PLAYER_COLUMNS).eq("active", true).order("price", { ascending: false });
  if (error) throw new Error(`Couldn't load the market: ${error.message}`);
  return (data ?? []).map(toPlayer);
}

export async function getPlayer(ticker: string): Promise<Player | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("market", `player:${ticker}`);
  const { data, error } = await createPublicClient()
    .from("players").select(PLAYER_COLUMNS).eq("ticker", ticker).eq("active", true).maybeSingle();
  if (error) throw new Error(`Couldn't load ${ticker}: ${error.message}`);
  return data ? toPlayer(data) : null;
}

export async function getPriceHistory(ticker: string): Promise<{ night: number; price: number }[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("market", `player:${ticker}`);
  const { data, error } = await createPublicClient()
    .from("price_history").select("night,price").eq("ticker", ticker).order("night");
  if (error) throw new Error(`Couldn't load price history: ${error.message}`);
  return (data ?? []).map((r) => ({ night: r.night, price: Number(r.price) }));
}

/** The most recent game night that moved prices (null before the first one). */
export async function getLatestNight(): Promise<{ night: number; game_date: string | null } | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("market");
  const { data } = await createPublicClient()
    .from("game_nights").select("night,game_date").order("night", { ascending: false }).limit(1).maybeSingle();
  return data;
}
