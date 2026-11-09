import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGameHeader } from "./espn";
import { staleGameIds } from "./sync-guard";

test("staleGameIds: unfinished rows on the date that the scoreboard no longer lists", () => {
  const rows = [
    { espn_id: "a", status: "STATUS_FINAL" },
    { espn_id: "b", status: "STATUS_SCHEDULED" },   // on scoreboard: not stale
    { espn_id: "moved", status: "STATUS_SCHEDULED" }, // not on scoreboard: stale
    { espn_id: "pp", status: "STATUS_POSTPONED" },   // already skipped by the price step
  ];
  assert.deepEqual(staleGameIds(rows, ["a", "b"]), ["moved"]);
});

test("parseGameHeader reads a moved game's real ET date and status from /summary", () => {
  const fx = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "summary-moved.json"), "utf8"));
  assert.deepEqual(parseGameHeader(fx), {
    espn_id: "401909999", game_date: "2026-11-23", start_time: "2026-11-24T00:30Z", status: "STATUS_SCHEDULED",
    home_team: "OKC", away_team: "DEN", home_score: null, away_score: null,
  });
});
