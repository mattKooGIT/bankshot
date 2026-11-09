// CLI for the real-data sync. Usage:
//   npm run sync                      catch up: apply every finished game night
//   npm run sync -- ingest 2026-11-08 store one date's games/box scores (no price moves)
//   npm run sync -- bootstrap [start] one-time: back-fill season, list rotation, reset prices
import { bootstrap, ingestDate, syncNights } from "../src/lib/sync";
import { createAdminClient } from "../src/lib/supabase/admin";

const SEASON_START = "2026-10-20"; // first day of 2026-27 regular season (preseason games are filtered anyway)

async function main() {
  const [cmd = "nights", arg] = process.argv.slice(2);
  if (cmd === "bootstrap") return bootstrap(arg ?? SEASON_START);
  if (cmd === "ingest") {
    if (!arg) throw new Error("Usage: npm run sync -- ingest YYYY-MM-DD");
    const r = await ingestDate(createAdminClient(), arg);
    return console.log(`${arg}: ${r.games.length} games (${r.games.filter((g) => g.status === "STATUS_FINAL").length} final), ${r.lines} stat lines`);
  }
  if (cmd === "nights") {
    const results = await syncNights();
    if (results.length === 0) console.log("Up to date.");
    for (const r of results) if (r.result !== "applied") console.log(`${r.date}: ${r.result}${r.detail ? ` (${r.detail})` : ""}`);
    return;
  }
  throw new Error(`Unknown command "${cmd}"`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
