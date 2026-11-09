# Live Scoreboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live scores, box scores and "your players tonight" with live fantasy points, display only.

**Architecture:**
- Pure parsing and polling logic lives in `src/lib/live.ts` and is unit-tested against saved ESPN JSON.
- One cached server endpoint, `/api/live`, serves every browser.
- A shared client store, `useLive()`, polls only while games are live.
- Three surfaces use it: `/scores`, the player page live line, and the header badge.

**Tech Stack:** Next.js 16.4 (Cache Components), React 19.3, TypeScript, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-09-live-scoreboard-design.md`

## Global Constraints
- **Display only.** No database writes and no price changes.
- **ESPN base:** `https://site.api.espn.com/apis/site/v2/sports/basketball/nba`. The scoreboard is called with **no** `dates` parameter, and box scores via `summary?event=<id>`. Only season types 2 and 3 are kept.
- **Fantasy points:** `pts + 1.2*reb + 1.5*ast + 3*stl + 3*blk - tov`, identical to `player_game_stats.fp`.
- **Timing:** server cache 15 seconds; client poll every 30 seconds; poll window is any `in` game, or a `pre` game tipping within 15 minutes. Polling pauses while the tab is hidden.
- **Times display in US Eastern** with an "ET" suffix.
- **Next 16 rules:** per-user reads go inside `<Suspense>`, and `node_modules/next/dist/docs/` is read before using any API not already used in this repo. Run `npx next typegen` before `tsc` when adding routes.
- **Work on branch `feature/live-scores`;** commit after each task with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Prefix shell commands with `source ~/.nvm/nvm.sh &&`.

## Review Focus
1. **A game that goes to overtime or halftime** shows "Half", "OT 2:31" or "Final/OT", not "Q5". Tested in Task 1.
2. **A player traded mid-season**, so the listed team differs from his box score team: matching uses the ESPN ID, never the team. Tested in Task 1 through `matchLines`.
3. **ESPN down on first load:** `/api/live` returns 200 with an empty result and `stale: true`, and `/scores` shows the delayed banner instead of crashing. Smoke-tested in Task 2 with a forced failure.
4. **A hidden tab** makes no requests, and resumes with an immediate fetch when shown again. Tested in Task 3 with a fake clock and visibility.
5. **No games today** (e.g. All-Star break) shows "No games today." on `/scores`, and the badge and live line render nothing. Tested in Task 4 with an empty fixture.

---

### Task 1: Parsing, fantasy points and poll rule (`src/lib/live.ts`)

**Files:**
- Create: `src/lib/live.ts`, `src/lib/live.test.ts`, `src/lib/__fixtures__/scoreboard.json`, `src/lib/__fixtures__/box-final.json`, `src/lib/__fixtures__/box-live.json`, `supabase/tests/fp-formula.test.ts`

**Interfaces:**
- Produces the types and functions exactly as named in spec §1: `LiveGame`, `LiveTeam`, `LiveLine`, `LiveData`, `parseScoreboard(json: unknown): LiveGame[]`, `parseBoxScore(json: unknown, gameId: string): LiveLine[]`, `fantasyPoints(l: Pick<LiveLine,"pts"|"reb"|"ast"|"stl"|"blk"|"tov">): number`, `shouldPoll(games: LiveGame[], now: Date): boolean`.
- Also produces `matchLines<T extends { espnId: string }>(items: T[], lines: LiveLine[]): Map<string, LiveLine>`, keyed by `espnId`.
- Status labels:
  - `pre`: `"7:30 PM ET"`
  - `in`, period 1–4: `"Q3 4:12"`
  - end of period 2: `"Half"`
  - period ≥ 5: `"OT 2:31"`, then `"2OT …"`
  - `post`: `"Final"`, `"Final/OT"` or `"Final/2OT"`

- [ ] **Step 1:** Save fixtures from live ESPN into `src/lib/__fixtures__/`:
  - **Scoreboard:** trim the no-date scoreboard to 4 events, then hand-edit them to give one `pre`, one `in` (period 3, clock "4:12"), one `in` at halftime (`STATUS_HALFTIME`, period 2), and one `post` with period 5. Also add one preseason event with `season.type = 1`.
  - **`box-final.json`:** trimmed from a recent final game.
  - **`box-live.json`:** the same game edited so one athlete has `stats` but 0 MIN, and one has `didNotPlay: true`.
  - Ruling to record: an `in` fixture is hand-made from a real event, because no game is live while building.
- [ ] **Step 2:** Write the failing tests:
  - `parseScoreboard`: the preseason game is dropped. Order is in, in, pre, post. The labels are `"Q3 4:12"`, `"Half"`, `"7:30 PM ET"` (from that event's start time) and `"Final/OT"`. Scores are null for `pre`.
  - `parseBoxScore`: line count matches non-DNP athletes. The 0-MIN-with-stats athlete is kept and the DNP athlete dropped. `fp` equals `fantasyPoints`.
  - `fantasyPoints({pts:24,reb:5,ast:5,stl:1,blk:0,tov:2})` = `24 + 6 + 7.5 + 3 + 0 - 2` = `38.5`.
  - `shouldPoll`:
    - true with an `in` game
    - true with a `pre` game tipping in 10 minutes
    - false with one tipping in 2 hours
    - false when all games are `post`
    - false for `[]`
  - `matchLines` matches by ESPN ID even when the item's team differs from the line's team (Review Focus 2).
  - `supabase/tests/fp-formula.test.ts` inserts a stat line into `player_game_stats` in PGlite and asserts the generated `fp` equals `fantasyPoints` for the same numbers.
- [ ] **Step 3:** Run `npm test`. Expected: the new tests fail because the module is missing.
- [ ] **Step 4:** Implement `src/lib/live.ts`. Reuse `toPosition` and the column-index approach from `src/lib/espn.ts`; don't import `espn.ts`'s fetch helpers.
- [ ] **Step 5:** Run `npm test`. Expected: all pass. Commit: "Live scores: ESPN parsing, fantasy points, poll rule".

### Task 2: `/api/live` endpoint

**Files:**
- Create: `src/lib/live-server.ts`, `src/app/api/live/route.ts`

**Interfaces:**
- `getLiveData(): Promise<LiveData>` in `live-server.ts`, cached for 15 seconds. It fetches the scoreboard, then box scores of `in` and `post` games 4 at a time, and remembers the last good result in a module variable. On any error it returns `{ ...lastGood ?? { games: [], lines: [] }, updatedAt: lastGood?.updatedAt ?? now, stale: true }`.
- `GET /api/live` returns `Response.json(await getLiveData(), { headers: { "Cache-Control": "no-store" } })`.

- [ ] **Step 1:** Read `node_modules/next/dist/docs` on caching inside route handlers under Cache Components. Use `"use cache"` with `cacheLife({ stale: 15, revalidate: 15, expire: 60 })` on the fetching function, and keep the error fallback outside the cached scope so failures aren't cached.
- [ ] **Step 2:** Implement. Run `npx next typegen && npx tsc --noEmit && npm run lint && npm run build`. Expected: pass.
- [ ] **Step 3:** Smoke test on `next start`:
  - `curl /api/live` returns 200 and JSON with the keys `games`, `lines`, `updatedAt` and `stale`
  - two calls within 15 seconds return the same `updatedAt`
  - Review Focus 3: with `LIVE_ESPN_BASE=http://127.0.0.1:9` (an env override read only by `live-server.ts`), the response is 200 with `stale: true` and empty arrays
- [ ] **Step 4:** Commit: "Add cached /api/live endpoint".

### Task 3: Shared poller and header badge

**Files:**
- Create: `src/lib/useLive.ts`, `src/lib/live-store.ts`, `src/lib/live-store.test.ts`, `src/components/LiveBadge.tsx`
- Modify: `src/components/SiteHeader.tsx` (add the "Scores" link and `<LiveBadge />`)

**Interfaces:**
- `live-store.ts` is pure and testable: `createLiveStore(deps: { fetchLive: () => Promise<LiveData>; now: () => Date; setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (t: unknown) => void; isVisible: () => boolean })`. It returns `{ subscribe(fn): () => void; getSnapshot(): { data: LiveData | null; error: boolean }; onVisibilityChange(): void }`.
  - It fetches when the first subscriber arrives.
  - It schedules the next fetch in 30 seconds only if `shouldPoll` is true and the tab is visible.
  - `onVisibilityChange` fetches immediately when the tab becomes visible.
  - It stops when the last subscriber leaves.
- `useLive()` wraps a singleton store with `useSyncExternalStore`.

- [ ] **Step 1:** Write the failing tests in `live-store.test.ts`, using a fake timer queue and a counter in the fake fetch:
  - one fetch for two subscribers
  - re-polls after 30 seconds while a game is `in`
  - no re-poll when all games are `post`
  - while hidden, a due timer doesn't fetch; `onVisibilityChange` with the tab visible fetches immediately (Review Focus 4)
  - a fetch error keeps the previous data and sets `error: true`
- [ ] **Step 2:** Run `npm run test:unit`. Expected: fails.
- [ ] **Step 3:** Implement the store, the hook and `LiveBadge`. The badge shows a pulsing dot and "Live · N" linking to `/scores` when N `in` games are on, and `null` otherwise. Add a "Scores" link to the nav.
- [ ] **Step 4:** Run `npm test && npx tsc --noEmit && npm run lint && npm run build`. Expected: pass. Commit: "Add shared live poller and header Live badge".

### Task 4: `/scores` page

**Files:**
- Create: `src/app/scores/page.tsx`, `src/app/scores/ScoresView.tsx`, `src/app/scores/GameCard.tsx`

**Interfaces:**
- The server page renders the static heading and a `<Suspense>` that loads:
  - `holdings: { ticker; name; espnId; team; expectedFp; shares; out: boolean }[]` for the current room, or `null` when signed out
  - `tickerByEspnId: Record<string,string>` from `getMarket()`

  These are passed to the client `ScoresView`.
- `ScoresView` uses `useLive()` and renders the panel and cards exactly as spec §2.

- [ ] **Step 1:** Implement:
  - **Copy, verbatim:**
    - "Prices update overnight from final box scores. Live numbers don't move prices yet."
    - "No games today."
    - "Live data delayed · last updated {time} ET"
    - "Not playing tonight ({n})"
  - **FP comparison** reads "31.5 FP vs 46.0 exp", green (`text-emerald-400`) when at or above expected and red (`text-red-400`) when below.
  - **Box score** (`GameCard` expanded): rows are sorted by MIN, with a ticker link when `tickerByEspnId` has the player.
- [ ] **Step 2:** Run `npx next typegen && npx tsc --noEmit && npm run lint && npm run build`. Expected: pass.
- [ ] **Step 3:** Smoke test, signed out: `/scores` returns 200 with the sign-in prompt in place of "Your players tonight". With ESPN returning no events (Review Focus 5), point `LIVE_ESPN_BASE` at a tiny local server serving `{"events":[]}` and check `/scores` contains "No games today." and the header has no badge.
- [ ] **Step 4:** Commit: "Add /scores page with your players and box scores".

### Task 5: Player page live line

**Files:**
- Create: `src/app/players/[ticker]/LiveLine.tsx`
- Modify: `src/app/players/[ticker]/page.tsx` (render `<LiveLine espnId team expectedFp />` under the header)

- [ ] **Step 1:** Implement with `useLive()`:
  - It finds the game where `team` is home or away; if there's none, it renders `null`.
  - It finds the line by `espnId`.
  - It renders: "Live · {status} · {pts} PTS {reb} REB {ast} AST {stl} STL {blk} BLK {tov} TOV · {fp} FP vs {expected} expected", or "Final · …", or "Tips {time} ET tonight".
- [ ] **Step 2:** Run `npx tsc --noEmit && npm run lint && npm run build`. Expected: pass. Smoke test: `/players/SGA` returns 200.
- [ ] **Step 3:** Commit: "Show live stat line on player pages".

### Task 6: Final verification
- [ ] Run `npm test && npx tsc --noEmit && npm run lint && npm run build`. Expected: all pass.
- [ ] Ask the user to open `/scores` during tonight's games and confirm the scores tick and their players' FP update.
