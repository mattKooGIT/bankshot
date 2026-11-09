# Player Schedules — Design

**Date:** 2026-11-09
**Status:** Draft for review

## Goal

Show when each player plays next and how he's been doing lately:
- **Player page:** his next 10 games and his last 10 games played.
- **Portfolio:** each holding's next game and how many games his team plays in the next 7 days.

## Decisions

| Topic | Decision |
|---|---|
| Source | ESPN team schedule, `GET /teams/{teamId}/schedule`, one request per team, returning the whole season. Verified: 80 events for LAL, Oct 22 to Apr 12. |
| Storage | The existing `games` table. No migration. Every regular-season and playoff game is upserted by ESPN game ID. |
| Freshness | `syncSchedule()` runs at the start of every `npm run sync` and the cron endpoint, before prices are applied, so postponements and reschedules are current. |
| Recent games | Come from `player_game_stats`, which is already stored, joined to `games` for the opponent and result. |
| Labels | US Eastern: "Tonight", "Tomorrow", otherwise a short weekday and date, e.g. "Tue Nov 11". Tip-off times like "7:30 PM ET". |

## 1. Sync: `syncSchedule()` in `src/lib/sync.ts`

1. Fetch `/teams` to get the 30 team IDs and abbreviations.
2. Fetch each `/teams/{id}/schedule`, 5 at a time.
3. Parse each event with `parseTeamSchedule(json): EspnGame[]`, a new function in `src/lib/espn.ts`:
   - `espn_id` is the event ID.
   - `game_date` is the **US-Eastern calendar date of the tip-off time**.
   - `start_time` is the tip-off time.
   - `status` is the competition's `status.type.name`.
   - `home_team` and `away_team` are the competitors' abbreviations.
   - Scores are set only when the game is final.
   - Events with a season type other than 2 or 3 are kept out.
4. De-duplicate by event ID, since every game appears in two teams' schedules, then upsert into `games` in chunks of 500.
5. Return the number of games upserted. The CLI logs it.

**Ordering:** `syncNights()` calls `syncSchedule()` first. If `syncSchedule()` fails (ESPN down), the sync logs a warning and continues, because the nightly price move must not depend on it.

**Postponed games:** `apply_real_game_night()` already ignores `STATUS_POSTPONED` and `STATUS_CANCELED` when checking that a date is complete. A rescheduled game keeps its event ID and gets its new date on the next sync.

## 2. Reads: `src/lib/schedule.ts`

These are cached with `"use cache"`, `cacheLife("minutes")` and `cacheTag("market")`, through the public client.

- `getTeamSchedule(team: string, from: string, limit = 10): Promise<ScheduledGame[]>` returns games where the team is home or away, on or after `from` (an ET date), with status not final, ordered by `start_time`.
- `getTeamsUpcoming(teams: string[], from: string, to: string): Promise<ScheduledGame[]>` is one query covering several teams, for the portfolio.
- `getGameLog(espnId: string, limit = 10): Promise<LoggedGame[]>` returns his `player_game_stats` rows joined to `games`, newest first.

Types:
- `ScheduledGame = { id, date, startTime, status, home, away }`
- `LoggedGame = { date, opponent, home: boolean, result: "W" | "L" | null, teamScore, oppScore, min, pts, reb, ast, stl, blk, tov, fp }`

Pure helpers, unit-tested:
- `dayLabel(date: string, today: string): string` gives "Tonight", "Tomorrow", or e.g. "Tue Nov 11".
- `matchup(game, team): string` gives "vs BOS" or "@ BOS".
- `gamesWithin(games, team, today, days = 7): number`
- `nextGame(games, team): ScheduledGame | null`

## 3. Surfaces

**Player page:** a "Schedule" section after "Season averages".
- **Upcoming:** up to 10 rows of day label, matchup and tip-off time ET. Postponed games show "Postponed". If there are none: "No upcoming games scheduled."
- **Recent games:** up to 10 rows of date, matchup, result (`W 121–116`), MIN, PTS, REB, AST, STL, BLK, TO and FP. FP is green when at or above his current expected FP and red when below. If there are none: "No games played yet this season."
- **Static:** both lists are public data, so the section is cached and prerendered with the page. No `<Suspense>` is needed.

**Portfolio:** two new columns in the holdings table.
- **Next:** e.g. "Tonight @ MIA · 7:30 PM ET", "Tomorrow vs BOS · 8:00 PM ET" or "Tue Nov 11 vs BOS · 7:00 PM ET". It shows "—" if nothing is scheduled.
- **Games (7d):** the count of games in the next 7 days, from today through today + 6 in ET.

## 4. Testing

- **Fixture:** a trimmed real `teams/13/schedule` response (LAL), saved at `src/lib/__fixtures__/team-schedule.json`.
- **Unit tests:**
  - `parseTeamSchedule`: ET date for a late-night tip (e.g. 02:00Z belongs to the previous ET day), final scores, scheduled games with null scores, and non-regular-season events dropped.
  - `dayLabel`, `matchup`, `gamesWithin` and `nextGame`.
- **Database test:** a scheduled game on date D that becomes `STATUS_POSTPONED` doesn't block `apply_real_game_night(D)`.
- **Live check:** `npm run sync` loads the season. Spot-check one team's games against espn.com.
- **Smoke tests:** `/players/LUKA` shows both lists, and `/portfolio` builds.

## 5. Out of scope

Opponent strength or difficulty ratings, back-to-back flags, TV channels, and a full-season calendar view.
