// Real-data sync. Used by `npm run sync` (scripts/sync.ts) and the cron route.
// Relative imports only, so it also runs outside Next.js.
import { createAdminClient } from "./supabase/admin";
import { addDays, easternToday } from "./dates";
import { fetchBoxScore, fetchGameHeader, fetchGames, fetchInjuries, fetchTeams, fetchTeamSchedule, headshotUrl, type EspnGame } from "./espn";
import { staleGameIds } from "./sync-guard";

type Admin = ReturnType<typeof createAdminClient>;
const SKIPPED = new Set(["STATUS_POSTPONED", "STATUS_CANCELED"]);

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

function check<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

/** Store a date's games, plus box scores for the ones that are final. Idempotent. */
export async function ingestDate(db: Admin, date: string): Promise<{ games: EspnGame[]; lines: number }> {
  const games = await fetchGames(date);
  if (games.length === 0) return { games, lines: 0 };
  check(await db.from("games").upsert(games), `upsert games ${date}`);

  const finals = games.filter((g) => g.status === "STATUS_FINAL");
  const lines = (await inBatches(finals, 4, fetchBoxScore)).flat();
  if (lines.length) {
    check(await db.from("player_game_stats").upsert(lines, { onConflict: "game_id,espn_id" }), `upsert box scores ${date}`);
  }
  return { games, lines: lines.length };
}

/** Write team, headshot, and injury notes onto listed players; returns ESPN ids listed as Out. */
async function refreshPlayerMeta(db: Admin): Promise<string[]> {
  const players = check(await db.from("players").select("ticker, espn_id, team").not("espn_id", "is", null), "load players") as
    { ticker: string; espn_id: string; team: string | null }[];
  const ids = players.map((p) => p.espn_id);

  // Latest team per player (handles trades between teams).
  // PostgREST caps responses at 1000 rows, so page through.
  const latestTeam = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const page = check(
      await db.from("player_game_stats").select("espn_id, team, game_date").in("espn_id", ids)
        .order("game_date", { ascending: false }).order("espn_id").range(from, from + 999),
      "load recent teams",
    ) as { espn_id: string; team: string }[];
    for (const r of page) if (!latestTeam.has(r.espn_id)) latestTeam.set(r.espn_id, r.team);
    if (page.length < 1000) break;
  }

  const injuries = await fetchInjuries();
  const injuryById = new Map(injuries.map((i) => [i.espn_id, i]));

  await inBatches(players, 10, async (p) => {
    const inj = injuryById.get(p.espn_id);
    check(await db.from("players").update({
      team: latestTeam.get(p.espn_id) ?? p.team,
      headshot_url: headshotUrl(p.espn_id),
      injury_note: inj ? `${inj.status}: ${inj.note}` : null,
    }).eq("ticker", p.ticker), `update ${p.ticker}`);
  });

  return injuries.filter((i) => i.status === "Out").map((i) => i.espn_id);
}

/**
 * One-time: back-fill the season's box scores, then list the rotation and set
 * opening prices from real averages. Refuses if any trades exist.
 */
export async function bootstrap(seasonStart: string, log = console.log) {
  const db = createAdminClient();
  const end = addDays(easternToday(), -1);
  let total = 0;
  for (let d = seasonStart; d <= end; d = addDays(d, 1)) {
    const { games, lines } = await ingestDate(db, d);
    total += lines;
    if (games.length) log(`${d}: ${games.length} games, ${lines} lines`);
  }
  log(`Back-filled ${total} stat lines through ${end}.`);

  const listed = check(await db.rpc("bootstrap_market"), "bootstrap_market");
  log(`Listed ${listed} rotation players.`);

  // Night 0 marks where real game nights begin: the first night applied is the day after `end`.
  check(await db.from("game_nights").insert({ night: 0, game_date: end }), "mark night 0");

  const out = await refreshPlayerMeta(db);
  // Opening state: anyone currently out can't be bought until they return.
  if (out.length) check(await db.from("players").update({ out_nights: 1 }).in("espn_id", out), "mark injured");
  log(`Updated team/headshot/injuries (${out.length} out).`);
}

/**
 * Upserts every team's full season schedule into `games` (each game appears in two
 * teams' schedules, so de-duplicate). Keeps postponements and reschedules current.
 */
export async function syncSchedule(db: Admin = createAdminClient()): Promise<number> {
  const teams = await fetchTeams();
  const byId = new Map<string, EspnGame>();
  for (const g of (await inBatches(teams, 5, (t) => fetchTeamSchedule(t.id))).flat()) byId.set(g.espn_id, g);
  const games = [...byId.values()];
  for (let i = 0; i < games.length; i += 500) {
    check(await db.from("games").upsert(games.slice(i, i + 500)), "upsert schedule");
  }
  return games.length;
}

export type NightResult = { date: string; result: "applied" | "no-games" | "waiting"; night?: number; detail?: string };

/**
 * Catch up: apply every date after the last applied one, in order, up to `until`
 * (default: yesterday, US Eastern). Stops at the first date whose games aren't final.
 */
export async function syncNights(until = addDays(easternToday(), -1), log = console.log): Promise<NightResult[]> {
  const db = createAdminClient();
  const last = check(
    await db.from("game_nights").select("game_date").not("game_date", "is", null).order("game_date", { ascending: false }).limit(1).maybeSingle(),
    "load last night",
  ) as { game_date: string } | null;
  if (!last) throw new Error("Market not bootstrapped yet. Run `npm run sync -- bootstrap` first.");

  // Schedule first, so postponed games are marked before we check that a night is complete.
  // A failure here must not block the nightly price move.
  try {
    log(`Synced ${await syncSchedule(db)} scheduled games.`);
  } catch (e) {
    const msg = `Warning: schedule sync failed (${e instanceof Error ? e.message : e}); continuing with prices.`;
    log(msg);
    console.warn(msg); // the cron route passes a silent logger; this still reaches the server log
  }

  const results: NightResult[] = [];
  for (let d = addDays(last.game_date, 1); d <= until; d = addDays(d, 1)) {
    const { games } = await ingestDate(db, d);
    const playable = games.filter((g) => !SKIPPED.has(g.status));
    if (playable.length === 0) {
      // Off day: nothing to price. It's re-checked next run, which costs one scoreboard request.
      results.push({ date: d, result: "no-games" });
      continue;
    }
    if (playable.some((g) => g.status !== "STATUS_FINAL")) {
      results.push({ date: d, result: "waiting", detail: "not every game is final" });
      break;
    }
    // Our stored schedule may still have a game on this date that ESPN moved elsewhere.
    // Re-resolve those from ESPN; if any still block the night, wait instead of erroring.
    const stored = check(await db.from("games").select("espn_id, status").eq("game_date", d), `load games ${d}`) as
      { espn_id: string; status: string }[];
    const stale = staleGameIds(stored, games.map((g) => g.espn_id));
    if (stale.length) {
      const fixed = (await Promise.allSettled(stale.map(fetchGameHeader))).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (fixed.length) check(await db.from("games").upsert(fixed), `re-resolve moved games ${d}`);
      const still = staleGameIds(fixed.filter((g) => g.game_date === d), games.map((g) => g.espn_id))
        .concat(stale.filter((id) => !fixed.some((g) => g.espn_id === id)));
      if (still.length) {
        results.push({ date: d, result: "waiting", detail: `stored games not resolved: ${still.join(", ")}` });
        break;
      }
    }

    const out = await refreshPlayerMeta(db);
    const applied = await db.rpc("apply_real_game_night", { p_date: d, p_out: out });
    if (applied.error?.message.includes("Not every game")) {
      results.push({ date: d, result: "waiting", detail: applied.error.message });
      break;
    }
    const night = check(applied, `apply ${d}`) as number;
    const listed = check(await db.rpc("list_rotation_players"), "list_rotation_players") as number;
    // Room feeds get a results post for this night. Never blocks prices.
    const posted = await db.rpc("post_night_results", { p_night: night });
    if (posted.error) {
      const msg = `Warning: couldn't post night ${night} results (${posted.error.message}).`;
      log(msg);
      console.warn(msg);
    }
    if (listed) await refreshPlayerMeta(db);
    log(`${d}: applied as night ${night}${listed ? `, listed ${listed} new players` : ""}`);
    results.push({ date: d, result: "applied", night });
  }
  return results;
}
