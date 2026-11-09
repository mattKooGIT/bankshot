// Live fantasy points (TypeScript) must equal the database's generated fp column.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness";
import { fantasyPoints } from "../../src/lib/live";

test("fantasyPoints equals player_game_stats.fp", async () => {
  const db = await freshDb();
  await db.q(`insert into games values ('fp', '2026-11-01', '2026-11-01T23:00Z', 'STATUS_FINAL', 'A', 'B', 1, 2)`);
  const line = { pts: 31, reb: 9, ast: 7, stl: 2, blk: 3, tov: 4 };
  await db.q(`insert into player_game_stats (game_id, espn_id, name, team, position, game_date, min, pts, reb, ast, stl, blk, tov)
              values ('fp', 'p', 'P', 'A', 'G', '2026-11-01', 36, $1, $2, $3, $4, $5, $6)`,
    [line.pts, line.reb, line.ast, line.stl, line.blk, line.tov]);
  const [{ fp }] = await db.q(`select fp from player_game_stats where game_id = 'fp'`);
  assert.equal(Number(fp), fantasyPoints(line));
});
