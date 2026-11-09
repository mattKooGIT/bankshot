# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A landing page at `/` with an animated live-market hero, how it works, a product demo video, rooms and live pitches, and today's movers. Plus a hidden demo account and a scripted demo recording.

**Architecture:**
- The page is prerendered from cached market data, and only the call-to-action area reads the session, inside `<Suspense>`.
- Migration `0009` hides flagged profiles from leaderboards.
- A Playwright script records the demo against the fake-live preview.

**Tech Stack:** Next.js 16.4, Tailwind v4, Playwright (dev only), PGlite, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-09-landing-page-design.md`

## Global Constraints
- **Copy is verbatim from the spec,** including the headline, subhead, button labels and footer lines.
- **No NBA footage or logos.** The hero's decorative layers are `aria-hidden`, and `prefers-reduced-motion` stops every animation.
- **No horizontal page scroll at 375px width.**
- **Branch `feature/landing-page`;** commit per task with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `npx next typegen` before `tsc`. Load the `frontend-design:frontend-design` skill before Task 2.

## Review Focus
1. **Before the first game night:** no `last_move` and a single price-history night. The movers section hides itself, and the hero price line uses its synthetic fallback. Tested in Task 2 (unit) and Task 3 (smoke).
2. **Signed-in vs signed-out buttons:** a signed-in visitor never sees "Start a league with friends". Smoke-tested with a fake session cookie in Task 3, which falls back to signed-out; the signed-in case is checked by the user.
3. **Reduced motion:** with `prefers-reduced-motion`, the tape and line don't animate. Checked in Task 3 by grepping the CSS for the media query.
4. **A hidden account on top of a leaderboard** doesn't consume rank 1. Tested in Task 1.
5. **The demo video file is missing** (e.g. a fresh clone): the "See it in action" section doesn't render a broken player. Tested in Task 3 with a server-side file check.

---

### Task 1: Migration 0009, hidden profiles
**Files:** create `supabase/migrations/0009_hidden_profiles.sql` and `supabase/tests/hidden.test.ts`.
- [ ] **Test (failing):**
  - A is hidden with the highest net worth. `leaderboard(public)` doesn't include A, B is rank 1, and the ranks are 1..n with no gaps.
  - A can still trade.
- [ ] **Implement:** add `profiles.hidden` (default false), and `create or replace leaderboard(uuid,int)` with `and not pr.hidden` in the `w` CTE. Keep the grants.
- [ ] **Run `npm test`.** Expected: pass. Commit: "Hide flagged profiles from leaderboards".

### Task 2: Landing data helpers and hero components
**Files:** create `src/lib/landing.ts`, `src/lib/landing.test.ts`, `src/components/landing/TickerTape.tsx`, `src/components/landing/HeroChart.tsx`; modify `src/app/globals.css` (keyframes and reduced motion).
- **Interfaces:**
  - `topMovers(players: Player[], n = 3): { up: Player[]; down: Player[] }` excludes players with no `last_move` or a zero total. `up` is sorted by total descending, `down` ascending, and only negative moves count as down.
  - `marketIndex(history: { night: number; avg: number }[]): number[]` returns `history.map(h => h.avg)` when there are at least 2 nights, otherwise a fixed synthetic 24-point gentle uptrend.
  - `getMarketIndexHistory(): Promise<{ night; avg }[]>` is cached and tagged `market`. It returns the average `price_history.price` per night, in one query, never exceeding 1,000 rows.
- [ ] **Tests (failing),** then implement, then run `npm test`.
- [ ] **Components:**
  - `TickerTape`: two rows, CSS marquee (`translateX`), items duplicated for a seamless loop, `aria-hidden`.
  - `HeroChart`: an SVG polyline with a gradient fill under it and a stroke-dashoffset draw-in, `aria-hidden`.
- [ ] **Commit:** "Landing: movers, market index, ticker tape, hero chart".

### Task 3: Landing page
**Files:** replace `src/app/page.tsx`; create `src/app/HeroActions.tsx` (server, inside Suspense); modify `src/components/SiteHeader.tsx` (logo link is already `/`, so just confirm it).
- [ ] **Build all 7 sections** per spec §1. "See it in action" renders only if `public/demo.webm` exists (checked with `fs.existsSync` at build/prerender time).
- [ ] **Run** `npx next typegen && npx tsc --noEmit && npm run lint && npm run build`. Expected: pass, with `/` shown as ◐ or ○.
- [ ] **Smoke tests:**
  - `/` returns 200 with the headline, both signed-out buttons and the footer lines
  - `/market` returns 200
  - the reduced-motion media query is present in the CSS
  - the movers section is absent when there are no moves (Review Focus 1)
  - there's no `<video>` while `public/demo.webm` is missing (Review Focus 5)
- [ ] **Commit:** "Add landing page".

### Task 4: Demo recording
**Files:** create `scripts/record-demo.ts`; modify `package.json` (devDependency `playwright`; script `"record-demo": "tsx --env-file=.env.local scripts/record-demo.ts"`); outputs `public/demo.webm` and `public/demo-poster.png`.
- [ ] **Install** with `npm i -D playwright && npx playwright install chromium`.
- [ ] **Implement** per spec §3: the admin-created hidden demo user, a magic link via `generateLink`, the injected cursor and caption overlay, the scenes with verbatim captions, the saved video and poster, and cleanup with `delete_room`.
- [ ] **Run:** the user has run migration `0009`; start `npm run fake-espn` and `npm run preview:fake-live`, then `npm run record-demo`. Expected: `public/demo.webm`, 45–60 seconds. Check the length with Playwright's video path and an `ffprobe`-free duration read (the `<video>` element's duration in a headless page), plus frames saved at each scene.
- [ ] **Rebuild** so the "See it in action" section appears. Restart the preview for the user to watch.
- [ ] **Commit** (including the video files): "Record product demo video".

### Task 5: Final verification and review
- [ ] Run `npm test`, typecheck, lint and build, then a fresh whole-branch reviewer. Fix Critical and Important findings test-first, list the minors, merge to `main` when the user approves.
