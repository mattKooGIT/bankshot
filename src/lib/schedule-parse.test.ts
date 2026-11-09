import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTeamSchedule } from "./espn";

const fx = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "team-schedule.json"), "utf8"));

test("parseTeamSchedule drops non-regular-season events", () => {
  const games = parseTeamSchedule(fx);
  assert.equal(games.length, 4);
  assert.ok(!games.some((g) => g.espn_id === "999999999"));
});

test("parseTeamSchedule files a late tip-off under its US Eastern date", () => {
  const late = parseTeamSchedule(fx).find((g) => g.start_time === "2026-11-20T02:30Z")!;
  assert.equal(late.game_date, "2026-11-19");
});

test("parseTeamSchedule: finals have scores, scheduled games don't", () => {
  const games = parseTeamSchedule(fx);
  const final = games.find((g) => g.status === "STATUS_FINAL")!;
  assert.equal(typeof final.home_score, "number");
  assert.equal(typeof final.away_score, "number");
  const sched = games.find((g) => g.status === "STATUS_SCHEDULED")!;
  assert.equal(sched.home_score, null);
  assert.ok(sched.home_team && sched.away_team);
});
