# Player Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upcoming games and recent game log on player pages; next game and games in the next 7 days on the portfolio.

**Architecture:**
- The nightly sync upserts all 30 team schedules into the existing `games` table.
- Cached, public reads in `src/lib/schedule.ts` feed the player page (static) and the portfolio (per-user).
- Pure helpers handle the ET labels and counts.

**Tech Stack:** Next.js 16.4 (Cache Components), Supabase, `tsx --test`, PGlite.

**Spec:** `docs/superpowers/specs/2026-11-09-player-schedules-design.md`

## Global Constraints
- **No migration.** Use the existing `games` columns: `espn_id`, `game_date`, `start_time`, `status`, `home_team`, `away_team`, `home_score`, `away_score`.
- **Only season types 2 and 3.** `game_date` is the US-Eastern date of `start_time`.
- **A schedule sync failure must not stop the nightly price step.**
- **Reads** use `createPublicClient()` with `"use cache"`, `cacheLife("minutes")` and `cacheTag("market")`.
- **Branch:** `feature/player-schedules`, off `feature/live-scores`. Commit per task with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `npx next typegen` before `tsc`.

## Review Focus
1. **Late tip-offs:** a 10:30 PM ET tip (02:30Z) is filed under that ET date, not the next day. Tested in Task 1.
2. **Postponed games:** a scheduled game that becomes postponed doesn't block that night's prices. Tested in Task 1 (database).
3. **Day labels around midnight:** "Tonight" and "Tomorrow" follow the ET date, not the browser's or the server's (UTC on Vercel). Tested in Task 2.
4. **A player with no games yet,** or a team with no upcoming games, shows the empty-state copy instead of erroring. Smoke-tested in Task 3.
5. **More than 1,000 games:** PostgREST caps responses at 1,000 rows, and the season has ~1,230 games. Each read is filtered by team and date, so none needs more than 1,000 rows; the sync upserts in chunks of 500. Covered by Task 1's chunking.

---

### Task 1: Schedule sync

**Files:**
- Modify: `src/lib/espn.ts` (add `fetchTeams()`, `parseTeamSchedule(json)`), `src/lib/sync.ts` (add `syncSchedule()` and call it first in `syncNights()`), `scripts/sync.ts` (log the count)
- Create: `src/lib/__fixtures__/team-schedule.json`, `src/lib/schedule-parse.test.ts`, `supabase/tests/schedule-postponed.test.ts`

**Interfaces:**
- `fetchTeams(): Promise<{ id: string; abbr: string }[]>`
- `parseTeamSchedule(json: unknown): EspnGame[]`, using the existing `EspnGame` type from `espn.ts`
- `syncSchedule(db?: Admin): Promise<number>`

- [ ] **Step 1:** Save a trimmed LAL `teams/13/schedule` fixture with 2 final games, 2 scheduled games, and one event with season type 1. Hand-set one scheduled game's date to `2026-11-20T02:30Z`.
- [ ] **Step 2:** Write the failing tests:
  - `parseTeamSchedule`: the 02:30Z game gets `game_date` `"2026-11-19"`. Final games have numeric scores; scheduled games have null scores. The type-1 event is dropped.
  - Database: insert a `STATUS_SCHEDULED` game for D, then update it to `STATUS_POSTPONED`, insert one final game on D, and check `apply_real_game_night(D)` succeeds.
- [ ] **Step 3:** Run `npm test`. Expected: the new tests fail.
- [ ] **Step 4:** Implement:
  - `syncSchedule` fetches 5 teams at a time, de-duplicates by ID, and upserts in chunks of 500.
  - `syncNights` wraps `syncSchedule` in try/catch and logs a warning on failure.
- [ ] **Step 5:** Run `npm test`. Expected: all pass.
- [ ] **Step 6:** Run `npm run sync -- ` once for real, so the live database gets the schedule. Expected: "Synced N scheduled games", with N around 1,230, and nights processed as before. Spot-check LAL's next 3 games against espn.com.
- [ ] **Step 7:** Commit: "Sync the full season schedule nightly".

### Task 2: Schedule reads and helpers (`src/lib/schedule.ts`)

**Interfaces:** exactly as in spec §2:
- `getTeamSchedule`, `getTeamsUpcoming`, `getGameLog`
- `dayLabel`, `matchup`, `gamesWithin`, `nextGame`
- the types `ScheduledGame` and `LoggedGame`

- [ ] **Step 1:** Write the failing tests in `src/lib/schedule.test.ts` for the pure helpers:
  - `dayLabel("2026-11-09", "2026-11-09")` is "Tonight"
  - `dayLabel("2026-11-10", "2026-11-09")` is "Tomorrow"
  - `dayLabel("2026-11-11", "2026-11-09")` is "Wed Nov 11"
  - `matchup` gives "vs BOS" or "@ BOS"
  - `gamesWithin` counts today through today + 6 and excludes day 7
  - `nextGame` returns the earliest non-final game, or null
- [ ] **Step 2:** Run it. Expected: fails. Then implement. The helpers format dates by parsing `YYYY-MM-DD` as UTC noon with `timeZone: "UTC"`, so the runtime's time zone never shifts the day.
- [ ] **Step 3:** Run `npm test`. Expected: pass. Commit: "Schedule reads and ET day labels".

### Task 3: Player page Schedule section

**Files:**
- Create: `src/app/players/[ticker]/Schedule.tsx` (server component)
- Modify: `src/app/players/[ticker]/page.tsx`

- [ ] **Step 1:** Implement the Upcoming and Recent games lists, with the copy from spec §3:
  - "No upcoming games scheduled."
  - "No games played yet this season."
  - "Postponed"
  - FP shown green or red against `expected_fp`.
- [ ] **Step 2:** Run `npx next typegen && npx tsc --noEmit && npm run lint && npm run build`. Expected: pass, and player pages are still prerendered.
- [ ] **Step 3:** Smoke test: `/players/LUKA` shows both lists. Also check a player with no team or espn_id renders the empty states (Review Focus 4).
- [ ] **Step 4:** Commit: "Show upcoming games and recent game log on player pages".

### Task 4: Portfolio columns

**Files:**
- Modify: `src/app/portfolio/page.tsx` (add `team` to the holdings select from `players`; one `getTeamsUpcoming` call; add the Next and Games (7d) columns)

- [ ] **Step 1:** Implement. Next reads `"{dayLabel} {matchup} · {time} ET"`, or "—" when nothing is scheduled.
- [ ] **Step 2:** Run `npm test && npx tsc --noEmit && npm run lint && npm run build`. Expected: pass. Smoke test: `/portfolio` returns 200.
- [ ] **Step 3:** Commit: "Show next game and games this week on the portfolio". Restart the preview on port 3001 for the user.

### Task 5: Final verification and review
- [ ] Run the full suite, typecheck, lint and build, then run a fresh whole-branch reviewer. Fix Critical and Important findings test-first, and defer the minors.
