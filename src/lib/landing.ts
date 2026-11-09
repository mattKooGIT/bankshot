import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import type { Player } from "@/lib/market";

/** Biggest risers and fallers from last night; players who didn't move are ignored. */
export function topMovers(players: Player[], n = 3): { up: Player[]; down: Player[] } {
  const moved = players.filter((p) => p.last_move && p.last_move.total !== 0);
  const by = (dir: 1 | -1) =>
    moved.filter((p) => dir * p.last_move!.total > 0).sort((a, b) => dir * (b.last_move!.total - a.last_move!.total)).slice(0, n);
  return { up: by(1), down: by(-1) };
}

/** Market line for the hero: real average prices once there are 2+ nights, otherwise a gentle synthetic rise. */
export function marketIndex(history: { night: number; avg: number }[]): number[] {
  if (history.length >= 2) return history.map((h) => h.avg);
  return Array.from({ length: 24 }, (_, i) => 50 + i * 0.6 + Math.sin(i * 0.9) * 1.8);
}

/** Average active-player price per night (market_index() in migration 0009). Empty if unavailable. */
export async function getMarketIndexHistory(): Promise<{ night: number; avg: number }[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("market");
  const { data, error } = await createPublicClient().rpc("market_index");
  if (error || !data) return []; // before 0009 is applied, the hero uses the synthetic line
  return (data as { night: number; avg: number | string }[]).map((r) => ({ night: r.night, avg: Number(r.avg) }));
}
