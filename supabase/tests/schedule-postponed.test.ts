import { test } from "node:test";
import assert from "node:assert/strict";
import { migrated } from "./fixtures";

test("a scheduled game that gets postponed doesn't block that night's prices", async () => {
  const { db } = await migrated();
  // Stored by the schedule sync weeks ahead...
  await db.q(`insert into games values ('pp', '2026-11-20', '2026-11-21T00:00Z', 'STATUS_SCHEDULED', 'OKC', 'DEN', null, null)`);
  // ...then postponed, while another game that night goes final.
  await db.q(`update games set status = 'STATUS_POSTPONED' where espn_id = 'pp'`);
  await db.q(`insert into games values ('ok', '2026-11-20', '2026-11-21T00:30Z', 'STATUS_FINAL', 'LAL', 'BOS', 100, 90)`);
  const [{ n }] = await db.q(`select apply_real_game_night('2026-11-20') n`);
  assert.equal(n, 1);
});

test("a still-scheduled game does block the night (so stale schedules must be re-synced first)", async () => {
  const { db } = await migrated();
  await db.q(`insert into games values ('st', '2026-11-20', '2026-11-21T00:00Z', 'STATUS_SCHEDULED', 'OKC', 'DEN', null, null)`);
  await assert.rejects(db.q(`select apply_real_game_night('2026-11-20')`), /Not every game/);
});
