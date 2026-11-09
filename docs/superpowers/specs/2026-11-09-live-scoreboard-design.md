# Live Scoreboard — Design

**Date:** 2026-11-09
**Status:** Draft for review

## Goal

Make game nights feel live. Show tonight's NBA games with live scores and box scores. Show how the players you hold in your current room are doing right now, with live fantasy points against what's expected of them.

The scoreboard is **display only**. Prices still move once per night from final box scores, so nothing live affects trading.

## Decisions

| Topic | Decision |
|---|---|
| Data path | One server endpoint, `GET /api/live`, fetches ESPN and caches the result for ~15 seconds. Browsers poll that endpoint, never ESPN directly. |
| "Tonight" | Whatever ESPN's scoreboard returns with no `dates` parameter. It keeps last night's games into the early morning. |
| Polling | Every 30 seconds while any game is live or tips off within 15 minutes. Stops when every game is final or nothing is scheduled. Pauses while the tab is hidden. |
| Personal data | Never passes through `/api/live`. Your holdings come from the page's server render and are matched to live lines in the browser by ESPN player ID. |
| Surfaces | The `/scores` page, a live line on the player page, and a "Live" badge in the header. |

## 1. Data

### `src/lib/live.ts` (pure, no Next.js imports)

Types:
- `LiveGame = { id, state: "pre" | "in" | "post", status: string, period: number, clock: string, startTime: string, home: LiveTeam, away: LiveTeam }`
  - `status` is a short display label, e.g. "Q3 4:12", "Half", "Final", "Final/OT", or "7:30 PM ET".
- `LiveTeam = { abbr: string, score: number | null }`
- `LiveLine = { espnId, name, team, gameId, min, pts, reb, ast, stl, blk, tov, fp }`
- `LiveData = { games: LiveGame[], lines: LiveLine[], updatedAt: string, stale: boolean }`

Functions:
- **`parseScoreboard(json): LiveGame[]`**. ESPN's `status.type.state` maps to `pre`, `in` and `post`. Only regular-season and postseason games are kept, matching the sync. Games are sorted live first, then upcoming by tip-off time, then final.
- **`parseBoxScore(json, gameId): LiveLine[]`**. Same column lookup as `fetchBoxScore`. It keeps every athlete who isn't marked `didNotPlay` and has a non-empty `stats` array, so a player who has just checked in shows up with 0 MIN.
- **`fantasyPoints(line)`** is `pts + 1.2·reb + 1.5·ast + 3·stl + 3·blk − tov`. This must equal the database's generated `fp` column, and a test checks that against the SQL formula.
- **`shouldPoll(games, now): boolean`** is true when any game is `in`, or any `pre` game tips off within 15 minutes of `now`.

### `GET /api/live` (`src/app/api/live/route.ts`)
1. Fetches the no-date scoreboard, then box scores for `in` and `post` games, 4 at a time.
2. Caches the combined `LiveData` for 15 seconds using `"use cache"` with a 15-second `cacheLife`. Check `node_modules/next/dist/docs` for how to cache a route handler under Cache Components.
3. If ESPN fails, it returns the last good `LiveData` with `stale: true`. The last good result is held in a module-level variable, which is best-effort: a fresh serverless instance won't have one. If there's no previous good result, it returns an empty result with `stale: true`, status 200.
4. The response is `Cache-Control: no-store` for browsers, because freshness comes from the server cache.

### `useLive()` (`src/lib/useLive.ts`, client)
- Returns `{ data: LiveData | null, error: boolean }`.
- Fetches once on mount, then repeats every 30 seconds while `shouldPoll` is true and `document.visibilityState === "visible"`.
- Re-checks as soon as the tab becomes visible again.
- All components on a page share one poller through a module-level store with subscribers, so the header badge and the page body cause only one request every 30 seconds.

## 2. Surfaces

### `/scores` (new; "Scores" link in the nav)
- **Your players tonight** (signed in): built from your holdings in the current room. The server passes `{ ticker, name, espnId, team, expectedFp, shares }[]`.
  - Each holding whose team appears in today's games gets a row with the ticker (linked to its player page), name, and status: the game's label, or "Out" when `out_nights > 0`.
  - Live or finished rows add the stat line and **"31.5 FP vs 46.0 exp"**, in green when at or above expected and red when below.
  - Holdings with no game today are collapsed under "Not playing tonight (N)".
  - Note: "Prices update overnight from final box scores. Live numbers don't move prices yet."
  - Signed out: a sign-in prompt in place of the panel.
- **Tonight's games:** one card per game showing the away team @ home team, both scores (or the tip-off time), and the status.
  - Clicking a card expands both teams' box scores, sorted by minutes, with MIN, PTS, REB, AST, STL, BLK, TOV and FP.
  - Players who are listed in the market show their ticker, linked to `/players/<ticker>`. This uses the cached market data mapped by `espn_id`.
- **Empty:** "No games today."
- **Stale data:** a banner reads "Live data delayed · last updated 9:41 PM ET".

### Player page
A client component under the price header shows **"Live · Q3 4:12 · 18 PTS 6 REB 4 AST 1 STL 0 BLK 2 TOV · 31.5 FP vs 46.0 expected"**:
- for a final game it shows "Final" instead of the clock
- before tip-off it shows "Tips 7:30 PM ET tonight"
- it renders nothing when his team has no game today

### Header badge
A client component next to the nav shows a pulsing dot and **"Live · N"**, linking to `/scores`, while N > 0 games are live. It renders nothing otherwise.

## 3. Error handling
- If ESPN changes its format, parsing throws, and `/api/live` falls back to the stale path. It never sends a broken shape to clients.
- Network errors in the browser keep the last data and show the "delayed" banner on `/scores`. The badge and the player line simply keep their last state.

## 4. Testing
- **Fixtures:** real ESPN JSON trimmed to a few games, saved under `src/lib/__fixtures__/`:
  - a scoreboard with `pre`, `in` and `post` games
  - one in-progress box score
  - one final box score
- **Unit tests:**
  - `parseScoreboard`: status labels, ordering, preseason filtering
  - `parseBoxScore`: columns and the MIN rule
  - `fantasyPoints`: matches the SQL formula on a sample line
  - `shouldPoll`: live, tips within 15 minutes, tips later, all final, empty
- **Smoke tests on `next start`:**
  - `/api/live` returns 200 with `games`, `lines`, `updatedAt` and `stale`
  - `/scores` renders signed out
  - a player page still renders

## 5. Out of scope
- Live or intraday price moves.
- Push or Realtime updates.
- Play-by-play and notifications.
- The Vercel nightly schedule (still parked).
