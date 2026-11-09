import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fantasyPoints, matchLines, parseBoxScore, parseScoreboard, shouldPoll, type LiveGame } from "./live";

const fx = (f: string) => JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", f), "utf8"));

test("parseScoreboard drops preseason and orders live, upcoming, final", () => {
  const games = parseScoreboard(fx("scoreboard.json"));
  assert.deepEqual(games.map((g) => g.id), ["401909952", "401909953", "401909955", "401909956"]);
  assert.deepEqual(games.map((g) => g.state), ["in", "in", "pre", "post"]);
});

test("parseScoreboard status labels: quarter clock, halftime, tip time ET, final in OT", () => {
  const byId = Object.fromEntries(parseScoreboard(fx("scoreboard.json")).map((g) => [g.id, g]));
  assert.equal(byId["401909952"].status, "Q3 4:12");
  assert.equal(byId["401909953"].status, "Half");
  assert.equal(byId["401909955"].status, "7:30 PM ET");
  assert.equal(byId["401909956"].status, "Final/OT");
});

test("parseScoreboard: scores null before tip, numbers once live", () => {
  const byId = Object.fromEntries(parseScoreboard(fx("scoreboard.json")).map((g) => [g.id, g]));
  assert.equal(byId["401909955"].home.score, null);
  assert.equal(typeof byId["401909952"].home.score, "number");
});

test("parseBoxScore keeps everyone who has played and computes fp", () => {
  const lines = parseBoxScore(fx("box-final.json"), "g1");
  assert.equal(lines.length, 14);
  const jake = lines.find((l) => l.name === "Jake LaRavia")!;
  assert.deepEqual([jake.min, jake.pts, jake.reb, jake.ast, jake.tov], [29, 5, 1, 2, 0]);
  assert.equal(jake.fp, 9.2);
  assert.equal(jake.gameId, "g1");
});

test("parseBoxScore (live): keeps a 0-MIN player with stats, drops DNP", () => {
  const lines = parseBoxScore(fx("box-live.json"), "g1");
  assert.equal(lines.length, 13);
  assert.ok(lines.some((l) => l.espnId === "999001" && l.min === 0 && l.pts === 2));
  assert.ok(!lines.some((l) => l.espnId === "999002"));
});

test("fantasyPoints matches the market formula", () => {
  assert.equal(fantasyPoints({ pts: 24, reb: 5, ast: 5, stl: 1, blk: 0, tov: 2 }), 38.5);
});

const at = (iso: string) => new Date(iso);
const game = (state: LiveGame["state"], startTime: string): LiveGame =>
  ({ id: "x", state, status: "", period: 0, clock: "", startTime, home: { abbr: "A", score: null }, away: { abbr: "B", score: null } });

test("shouldPoll: live game, tip within 15 minutes, otherwise no", () => {
  const now = at("2026-11-10T00:00:00Z");
  assert.equal(shouldPoll([game("in", "2026-11-09T23:00:00Z")], now), true);
  assert.equal(shouldPoll([game("pre", "2026-11-10T00:10:00Z")], now), true);
  assert.equal(shouldPoll([game("pre", "2026-11-10T02:00:00Z")], now), false);
  assert.equal(shouldPoll([game("post", "2026-11-09T22:00:00Z")], now), false);
  assert.equal(shouldPoll([], now), false);
});

test("matchLines matches by ESPN id even when the team differs (traded player)", () => {
  const lines = parseBoxScore(fx("box-final.json"), "g1");
  const jake = lines.find((l) => l.name === "Jake LaRavia")!;
  const m = matchLines([{ espnId: jake.espnId, team: "SOMEWHERE_ELSE" }], lines);
  assert.equal(m.get(jake.espnId)?.pts, 5);
});
