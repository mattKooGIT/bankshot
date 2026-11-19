import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import type { GameRow } from "@/lib/analyst-note";

const PAGE = 1000; // PostgREST's default row cap

/** Every box-score row for a team this season (the table only holds the current season). */
export async function getTeamGames(team: string): Promise<GameRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("market");
  const rows: GameRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await createPublicClient()
      .from("player_game_stats")
      .select("game_id,game_date,espn_id,team,min,pts,reb,ast,stl,blk,tov")
      .eq("team", team)
      .order("game_date").order("game_id").order("espn_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't load ${team} box scores: ${error.message}`);
    for (const r of data ?? []) {
      rows.push({
        game_id: r.game_id, game_date: r.game_date, espn_id: r.espn_id, team: r.team, min: r.min,
        fp: r.pts + 1.2 * r.reb + 1.5 * r.ast + 3 * r.stl + 3 * r.blk - r.tov,
      });
    }
    if (!data || data.length < PAGE) return rows;
  }
}
