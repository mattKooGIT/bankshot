import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLabel, gamesWithin, matchup, nextGame, type ScheduledGame } from "./schedule";

const g = (id: string, date: string, home: string, away: string, status = "STATUS_SCHEDULED", startTime = `${date}T23:00Z`): ScheduledGame =>
  ({ id, date, startTime, status, home, away });

test("dayLabel: Tonight, Tomorrow, then weekday and date (ET calendar dates)", () => {
  assert.equal(dayLabel("2026-11-09", "2026-11-09"), "Tonight");
  assert.equal(dayLabel("2026-11-10", "2026-11-09"), "Tomorrow");
  assert.equal(dayLabel("2026-11-11", "2026-11-09"), "Wed Nov 11");
  assert.equal(dayLabel("2027-01-01", "2026-12-31"), "Tomorrow");
});

test("matchup: vs at home, @ on the road", () => {
  const game = g("1", "2026-11-11", "BOS", "LAL");
  assert.equal(matchup(game, "BOS"), "vs LAL");
  assert.equal(matchup(game, "LAL"), "@ BOS");
});

test("gamesWithin counts today through today+6, skipping postponed and other teams", () => {
  const games = [
    g("a", "2026-11-09", "LAL", "ATL"), g("b", "2026-11-15", "PHX", "LAL"),
    g("c", "2026-11-16", "LAL", "BOS"), g("d", "2026-11-12", "LAL", "MIA", "STATUS_POSTPONED"),
    g("e", "2026-11-10", "BOS", "NY"),
  ];
  assert.equal(gamesWithin(games, "LAL", "2026-11-09"), 2);
});

test("nextGame: earliest game that isn't final or postponed, else null", () => {
  const games = [
    g("old", "2026-11-08", "LAL", "DET", "STATUS_FINAL"),
    g("pp", "2026-11-10", "LAL", "MIA", "STATUS_POSTPONED"),
    g("later", "2026-11-12", "MIL", "LAL"), g("next", "2026-11-11", "LAL", "BOS"),
  ];
  assert.equal(nextGame(games, "LAL")?.id, "next");
  assert.equal(nextGame([games[0]], "LAL"), null);
});

import { dateLabel } from "./schedule";

test("dateLabel: plain weekday and date for past games", () => {
  assert.equal(dateLabel("2026-11-08"), "Sun Nov 8");
});
