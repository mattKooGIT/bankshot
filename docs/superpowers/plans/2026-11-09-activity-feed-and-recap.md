# Activity Feed and Nightly Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A room activity feed with reactions and comments, nightly result posts, and an in-app recap (banner plus `/recap`), with a development preview page.

**Architecture:**
- Migration `0011` adds `room_events` and reactions, triggers, and the functions `post_comment`, `toggle_reaction`, `room_feed`, `post_night_results` and `my_recap`.
- The nightly sync calls `post_night_results`.
- The UI reads through server functions, with formatting in small pure helpers.

**Tech Stack:** Next.js 16.4, Supabase, PGlite, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-09-activity-feed-and-recap-design.md`

## Global Constraints
- **Copy and limits are verbatim from the spec:** the error texts, 1–280 characters, 5 comments per 60 seconds, and the emoji set 🔥 😂 💀 📉.
- **No feed for the Public room.**
- **Every UPDATE and DELETE has a WHERE clause** (safeupdate test).
- **Every new function is security definer** with `search_path = public`; `post_night_results` is revoked from `anon` and `authenticated`.
- **`/dev/recap-preview` returns 404 in production** unless `ENABLE_DEV_PREVIEW=1`.
- **Branch `feature/feed-recap`;** commit per task with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Deleting a room** that has events, reactions and members succeeds, with no trigger errors and no orphaned rows. (Task 1)
2. **The first night,** with no previous history: `change_pct` is measured from `starting_cash`, and `prev_rank` is null so the UI shows "–". (Task 2)
3. **Re-running the sync** for the same night doesn't duplicate night events. (Task 2)
4. **A non-member** can't read the feed, comment, or react on another room's events by event ID. (Task 1)
5. **The banner** never shows signed out, or once that night is dismissed. (Task 4, by unit-testing `shouldShowBanner`)

---

### Task 1: Feed schema, triggers, comments, reactions
**Files:** create `supabase/migrations/0011_feed_and_recap.sql` and `supabase/tests/feed.test.ts`.
- [ ] **Failing tests:**
  - a trade in a private room posts a `trade` event with side, ticker, shares and price
  - a Public trade posts nothing
  - joining posts `join`, and the creator's own row doesn't
  - leaving posts `leave`
  - `delete_room` succeeds and leaves zero events and reactions
  - `post_comment`: length errors, the rate limit on the 6th comment within 60s, and a non-member is rejected
  - `toggle_reaction` on, then off, then on; a non-member is rejected; an invalid emoji is rejected
  - `room_feed`: newest first, `p_before` paging, reaction counts and `mine`, a non-member gets 0 rows
- [ ] **Implement** per spec §1, without `post_night_results` and `my_recap` yet. Run `npm test`; expected: pass. Commit: "Feed: events, triggers, comments, reactions".

### Task 2: Night results and recap functions, wired into the sync
**Files:** modify the `0011` migration and `src/lib/sync.ts`; create `supabase/tests/recap.test.ts`.
- [ ] **Failing tests:**
  - after night 1, `post_night_results(1)` posts one event per private room, with change measured from `starting_cash` and a null `prev_rank`
  - calling it again posts 0
  - after night 2, `change_pct` and `prev_rank` come from night 1
  - finalized rooms are skipped
  - `my_recap()` is null before any night, and after nights 1 and 2 has one entry per membership with the right ranks
  - `best` and `worst` are the caller's highest and lowest `last_move.total` holdings in their current room
- [ ] **Implement** both functions. In `syncNights`, call the `post_night_results` RPC after each applied night inside try/catch, logging a warning and also writing it with `console.warn`.
- [ ] **Run `npm test`.** Expected: pass. Commit: "Night result posts and my_recap; sync posts results".

### Task 3: Feed UI on the room page
**Files:** create `src/lib/feed.ts` (with `relativeTime`, `formatEvent`, `rankMove`), `src/lib/feed.test.ts`, `src/app/rooms/[id]/Activity.tsx` (client) and `src/app/rooms/[id]/feed-actions.ts`; modify `src/app/rooms/[id]/page.tsx`.
- **Server functions:** `loadFeed(roomId, before?)`, `postComment(roomId, text)`, `toggleReaction(eventId, emoji)`.
- [ ] **Unit tests first:** `formatEvent` produces the texts from spec §2, `relativeTime` produces "just now", "5m ago", "3h ago" and "2d ago", and `rankMove` gives "▲2", "▼1" or "–". Then implement.
- [ ] **Build the Activity section:** the comment box, the event list, reaction chips, polling every 30s while visible, and "Show older".
- [ ] **Run** `npx next typegen && npx tsc --noEmit && npm run lint && npm run build`. Expected: pass. Commit: "Room activity feed UI".

### Task 4: Recap banner, `/recap`, development preview
**Files:** create `src/components/RecapBanner.tsx` (client, given recap data from the server header), `src/lib/recap.ts` (with `shouldShowBanner(recap, dismissedNight)` and `bannerText(recap, currentRoomId)`), `src/lib/recap.test.ts`, `src/app/recap/page.tsx`, `src/app/dev/recap-preview/page.tsx` and `src/lib/__fixtures__/recap.ts`; modify `src/components/SiteHeader.tsx`.
- [ ] **Unit tests first:** `shouldShowBanner` is false for a null recap or a dismissed night and true otherwise; `bannerText` matches the spec's format.
- [ ] **Implement.** The preview page renders the banner, the recap view and a night-results card from the fixtures, and calls `notFound()` in production unless the flag is set.
- [ ] **Build and smoke test:**
  - `/recap` returns 200 signed out and shows the sign-in prompt
  - `/dev/recap-preview` returns 200 under `next dev`, and also under `next start` with `ENABLE_DEV_PREVIEW=1`, and 404 without the flag
- [ ] **Commit:** "Recap banner, /recap page, dev preview".

### Task 5: Preview for the user, verification, review
- [ ] Ask the user to run migration `0011`.
- [ ] **Walk through the feed on the port 3001 preview** with a Playwright script, as the hidden demo account in a temporary room: trade, comment, react. Take screenshots, then delete the temporary room. Restart the preview with `ENABLE_DEV_PREVIEW=1` so the user can open `/dev/recap-preview` and try the feed themselves.
- [ ] Run the full suite, typecheck, lint and build, then a fresh whole-branch reviewer. Fix Critical and Important findings test-first, and list the minors.
