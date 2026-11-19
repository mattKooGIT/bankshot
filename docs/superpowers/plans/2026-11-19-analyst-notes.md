# Analyst Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Player pages show a short, suggestive "Analyst note" built from real box scores.

**Architecture:**
- A pure `analystNote(input)` in `src/lib/analyst-note.ts` holds every rule and template, and is unit-tested with fixture box scores.
- A server loader, `getTeamGames(team)`, in `src/lib/analyst.ts` reads `player_game_stats` with `"use cache"` and tag `market`.
- A server component, `AnalystNote`, renders the box.

**Tech Stack:** Next.js 16.4 (Cache Components), Supabase, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-analyst-notes-design.md`

## Global Constraints
- **Thresholds, verbatim from the spec:**
  - key teammate: `avg_min ≥ 24`
  - split: at least 3 games without, at least 2 with, gain at least 15% and at least 3.0 FP
  - role may shrink: the teammate played the latest team game after missing at least 3 of the 5 before it
  - streak: at least 8 games played, last-5 FP at least 20% off the season average, last-5 minutes at least 10% off in the same direction
  - market line: at least 15% over 5 nights
  - at most 2 signals; Sidelined strength = 1000; the shrink strength factor is 0.9
- **Copy is verbatim from spec §2–3.** Footer: "Based on box scores. Not a recommendation." No output may contain "buy", "sell" or "hold".
- **FP = pts + 1.2·reb + 1.5·ast + 3·stl + 3·blk − tov.**
- **Branch `feature/analyst-notes`.** Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **A teammate who hasn't played at all this season** (0 games, but listed Out with high `avg_min` from last season): the split needs at least 2 "with" games, so there's no note, not a division by zero.
2. **A player with no games yet** (a rookie, or just listed): no note and no crash.
3. **Two teammates out at once:** only the largest split shows, plus at most one more signal.
4. **Injury text with quotes, very long text, or no "Out: " prefix:** trimmed safely to 160 characters, and rendered as text, not HTML.
5. **The player page still renders** if the box-score query fails: the note is skipped, and the page stays up.

---

### Task 1: `analystNote` (pure rules and templates)
**Files:** create `src/lib/analyst-note.ts` and `src/lib/analyst-note.test.ts`.

**Interfaces (Produces):**
- `type GameRow = { game_id: string; game_date: string; espn_id: string; team: string; min: number; fp: number }`
- `type Mate = { espn_id: string; name: string; avg_min: number; out_nights: number; injury_note: string | null }`
- `type NoteInput = { player: Mate & { team: string }; teammates: Mate[]; games: GameRow[]; prices: number[] }`. The `prices` are oldest first, and the last value is the current price.
- `type Note = { tag: "Bigger role" | "Role may shrink" | "Sidelined" | "Heating up" | "Cooling off"; paragraphs: string[] }`
- `analystNote(input: NoteInput): Note | null`

- [ ] **Step 1: Write the tests.** One per spec §4 unit bullet, plus the Review Focus items 1–4. Build the fixtures with a small helper, `season({ team, games: [{ date, mins: Record<espnId, [min, fp]> }] })`.
  - **Bigger role:** for a Hartenstein-like case, 12 games without T at FP 34.2 and 3 with T at 22.1. Assert the tag and the exact sentence:
    > "Isaiah Hartenstein is averaging 34.2 FP in the 12 games Chet Holmgren has missed, vs 22.1 with him (+55%). With Chet Holmgren out, that larger role could stick around."
  - **Wording:** every produced paragraph across all tests fails `/\b(buy|sell|hold)\b/i`.
- [ ] **Step 2:** Run `npx tsx --test src/lib/analyst-note.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement it per spec §2.** Notes:
  - Team games are distinct `game_id`s for the player's current team.
  - "Played" means `min > 0`.
  - The player's own games are restricted to his current team.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm run test:unit`, and everything passes.
- [ ] **Step 5: Commit:** "Analyst notes: rules and templates".

### Task 2: Loader, UI, smoke
**Files:** create `src/lib/analyst.ts` (with `getTeamGames`) and `src/app/players/[ticker]/AnalystNote.tsx`; modify `src/app/players/[ticker]/page.tsx`.

**Interfaces (Consumes):** Task 1's `analystNote`, `NoteInput`, `Note`; `getMarket()` and `getPriceHistory()` from `src/lib/market.ts`.

- [ ] **`getTeamGames(team: string): Promise<GameRow[]>`**
  - `"use cache"`, `cacheLife("minutes")`, `cacheTag("market")`
  - selects `game_id, game_date, espn_id, team, min, pts, reb, ast, stl, blk, tov` for the team, mapped to `fp`
  - pages past PostgREST's 1,000-row cap
- [ ] **`AnalystNote({ player })`** (async server component)
  - builds `NoteInput` from `getMarket()` (teammates), `getTeamGames`, and the last 6 `getPriceHistory` prices
  - renders null when there's no note
  - Review Focus 5: on a loader error it logs `console.warn` and renders null
  - markup and colours as in spec §3
- [ ] **Page:** render `<AnalystNote player={player} />` after `<InjuryReport …/>`, in its own `<Suspense fallback={null}>`.
- [ ] **Run** `npx next typegen && npx tsc --noEmit && npm run lint && npm test && npm run build`. Expected: pass.
- [ ] **Smoke:** rebuild the 3001 preview. Check that `/players/HARTENSTEI` shows the box (or, if no signal fires on live data, a player whose note does fire), and take a screenshot.
- [ ] **Commit:** "Analyst notes on player pages".
- [ ] **Final review:** a fresh reviewer on the whole branch. Fix Critical and Important findings test-first, and list the minors.
