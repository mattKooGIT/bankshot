import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { addDays, easternToday } from "@/lib/dates";
import { fantasyPoints } from "@/lib/live";

export type ScheduledGame = { id: string; date: string; startTime: string; status: string; home: string; away: string };

export type LoggedGame = {
  date: string; opponent: string; home: boolean; result: "W" | "L" | null;
  teamScore: number | null; oppScore: number | null;
  min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; fp: number;
};

const OFF = new Set(["STATUS_POSTPONED", "STATUS_CANCELED"]);
const involves = (g: ScheduledGame, team: string) => g.home === team || g.away === team;

// ───────────── Pure helpers (ET calendar dates as YYYY-MM-DD) ─────────────

// Format a YYYY-MM-DD as that calendar day regardless of the runtime's time zone.
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const tip = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/** "Wed Nov 11" for a YYYY-MM-DD calendar date. */
export function dateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${weekday.format(d)} ${monthDay.format(d)}`;
}

/** "Tonight", "Tomorrow", or "Wed Nov 11". `today` is the US-Eastern date. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Tonight";
  if (date === addDays(today, 1)) return "Tomorrow";
  return dateLabel(date);
}

/** "7:30 PM ET" */
export function tipTime(startTime: string): string {
  return `${tip.format(new Date(startTime)).replace(/ /g, " ")} ET`;
}

/** "vs LAL" at home, "@ BOS" on the road. */
export function matchup(g: ScheduledGame, team: string): string {
  return g.home === team ? `vs ${g.away}` : `@ ${g.home}`;
}

/** Games the team plays from today through today + days - 1 (postponed/canceled don't count). */
export function gamesWithin(games: ScheduledGame[], team: string, today: string, days = 7): number {
  const last = addDays(today, days - 1);
  return games.filter((g) => involves(g, team) && !OFF.has(g.status) && g.date >= today && g.date <= last).length;
}

/** The team's next game that will actually be played, or null. */
export function nextGame(games: ScheduledGame[], team: string): ScheduledGame | null {
  return games
    .filter((g) => involves(g, team) && g.status !== "STATUS_FINAL" && !OFF.has(g.status))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0] ?? null;
}

// ───────────── Cached reads (public data; refreshed with the market) ─────────────

type GameRow = { espn_id: string; game_date: string; start_time: string; status: string; home_team: string; away_team: string };
const toGame = (r: GameRow): ScheduledGame =>
  ({ id: r.espn_id, date: r.game_date, startTime: r.start_time, status: r.status, home: r.home_team, away: r.away_team });
const GAME_COLS = "espn_id,game_date,start_time,status,home_team,away_team";

/** A team's next `limit` games that aren't final, from `from` (ET date) on. Postponed ones included, labeled by the UI. */
export async function getTeamSchedule(team: string, from: string, limit = 10): Promise<ScheduledGame[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("market");
  const { data, error } = await createPublicClient().from("games").select(GAME_COLS)
    .or(`home_team.eq.${team},away_team.eq.${team}`).gte("game_date", from).neq("status", "STATUS_FINAL")
    .order("start_time").limit(limit);
  if (error) throw new Error(`Couldn't load ${team}'s schedule: ${error.message}`);
  return (data as GameRow[]).map(toGame);
}

/** Every game for these teams between two ET dates (one query for the whole portfolio). */
export async function getTeamsUpcoming(teams: string[], from: string, to: string): Promise<ScheduledGame[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("market");
  if (teams.length === 0) return [];
  const list = [...new Set(teams)].sort().join(",");
  const { data, error } = await createPublicClient().from("games").select(GAME_COLS)
    .or(`home_team.in.(${list}),away_team.in.(${list})`).gte("game_date", from).lte("game_date", to)
    .order("start_time");
  if (error) throw new Error(`Couldn't load upcoming games: ${error.message}`);
  return (data as GameRow[]).map(toGame);
}

/** A player's most recent games played, newest first, with opponent and result. */
export async function getGameLog(espnId: string, limit = 10): Promise<LoggedGame[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("market");
  const { data, error } = await createPublicClient().from("player_game_stats")
    .select("game_date,team,min,pts,reb,ast,stl,blk,tov,games(home_team,away_team,home_score,away_score)")
    .eq("espn_id", espnId).order("game_date", { ascending: false }).limit(limit);
  if (error) throw new Error(`Couldn't load game log: ${error.message}`);
  type Row = { game_date: string; team: string; min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number;
    games: { home_team: string; away_team: string; home_score: number | null; away_score: number | null } | null };
  return (data as unknown as Row[]).map((r) => {
    const g = r.games;
    const home = g ? g.home_team === r.team : true;
    const teamScore = g ? (home ? g.home_score : g.away_score) : null;
    const oppScore = g ? (home ? g.away_score : g.home_score) : null;
    return {
      date: r.game_date, opponent: g ? (home ? g.away_team : g.home_team) : "?", home,
      result: teamScore === null || oppScore === null ? null : teamScore > oppScore ? "W" : "L",
      teamScore, oppScore, min: r.min, pts: r.pts, reb: r.reb, ast: r.ast, stl: r.stl, blk: r.blk, tov: r.tov,
      fp: fantasyPoints(r),
    };
  });
}

/**
 * Everything the player page's Schedule section needs. Computes "today" (ET) inside the
 * cache so prerendered player pages can use it; refreshed with the market.
 */
export async function getPlayerSchedule(team: string | null, espnId: string | null) {
  "use cache";
  cacheLife("minutes");
  cacheTag("market");
  const today = easternToday();
  const [upcoming, log] = await Promise.all([
    team ? getTeamSchedule(team, today, 10) : Promise.resolve([]),
    espnId ? getGameLog(espnId, 10) : Promise.resolve([]),
  ]);
  return { today, upcoming, log };
}
