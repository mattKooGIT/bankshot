# Landing Page and Product Demo — Design

**Date:** 2026-11-09
**Status:** Draft for review

## Goal

A real home page that sells the idea, "fantasy basketball meets the stock market, played with your friends", and sends visitors to the market or into a room with friends. It includes a recorded product demo of the actual site.

## Decisions

| Topic | Decision |
|---|---|
| Route | `/` is the landing page. The market stays at `/market`. The header logo links to `/`. |
| Hero background | An animated live market built from our own data: a scrolling ticker tape and a self-drawing price line. No NBA footage, logos or video file in the hero. |
| Demo video | Recorded by a Playwright script driving the real app, with a visible cursor and captions. Saved as `public/demo.webm` plus `public/demo-poster.png`. |
| Demo account | A dedicated Supabase user, `courtside_demo`, hidden from all leaderboards by a new `profiles.hidden` flag. |
| Legal footer | "Paper trading only. No real money." and "Not affiliated with the NBA or its teams." |

## 1. Page: `src/app/page.tsx` (replaces the redirect)

The static parts are prerendered. Market data comes from the cached `getMarket()` and `getLatestNight()`. Only the CTA area reads the session, inside `<Suspense>`, so signed-in visitors see "Go to the market" and "Your rooms" instead of the sign-up button.

**Sections:**
1. **Hero** (min-height: the viewport):
   - **Headline:** "The stock market, but for the NBA."
   - **Subhead:** "Buy and sell real players with $10,000 in paper money. Prices move every night on real box scores. Beat your friends."
   - **Buttons (signed out):**
     - **Primary:** "Start a league with friends", linking to `/login?next=/rooms`.
     - **Secondary:** "Go to the market", linking to `/market`.
   - **Buttons (signed in):** "Go to the market" (primary) and "Your rooms".
   - **Background:**
     - **Ticker tape:** two rows scrolling in opposite directions, each item showing ticker, price and last-night change. It shows the top 30 players by price. Changes are colored, and the text is dimmed so the headline stays readable.
     - **Price line:** an SVG polyline of the market's average price over recent nights, falling back to a synthetic gentle line when there's no history yet. It draws itself once with a CSS `stroke-dashoffset` animation.
     - **Reduced motion:** when the visitor's device asks for reduced motion (`prefers-reduced-motion: reduce`), both animations stop and the tape shows statically.
2. **How it works:** 4 numbered steps, each with a one-line example:
   1. "Get $10,000" (paper money, no real money)
   2. "Buy players like stocks"
   3. "Prices move every night", e.g. "Luka drops 45 → his price jumps; injuries and trader demand count too"
   4. "Climb the leaderboard" (in your room, or against everyone)
3. **See it in action:** `<video src="/demo.webm" poster="/demo-poster.png" muted loop playsInline controls preload="none">`. The captions are burned into the recording. If the file is missing, the section is hidden.
4. **Play with friends:** a short explanation of rooms: your own bankroll, invite link, member cap, end date and final standings. Button: "Create a room".
5. **Live on game nights:** a pitch for `/scores`. It has a "See tonight's games" link and the `<LiveBadge>` component, which only shows while games are live.
6. **Today's movers:** the top 3 risers and top 3 fallers by `last_move.total`, linking to their player pages. It's hidden before the first game night.
7. **Footer:** the legal lines from the Decisions table.

**Design:** keep the existing dark trading-terminal look (tokens in `globals.css`, emerald for gains and red for losses), with larger type in the hero. Use the frontend-design guidance during the build. It must work on phone widths, with no horizontal page scroll; the ticker tape is clipped by an overflow-hidden wrapper.

**Accessibility:**
- The ticker tape is decorative (`aria-hidden`).
- Every button is a real link with its text.
- The video has visible controls.

## 2. Hidden demo account (migration `0009_hidden_profiles.sql`)

- Add `profiles.hidden boolean not null default false`.
- Replace `leaderboard(p_room, p_limit)` with the 0006 version plus `and not pr.hidden`. Rank is calculated after the filter, so hidden accounts don't leave gaps in the numbering.
- Nothing else changes. Hidden users can trade normally.

## 3. Demo recording: `scripts/record-demo.ts` (`npm run record-demo`)

**Setup:**
- Playwright is a dev dependency, Chromium only.
- **Prerequisites:** the fake ESPN server (`npm run fake-espn`) and a production server on port 3001 (`npm run preview:fake-live`).

**Steps:**
1. **Ensure the demo user exists.** The script uses the service-role admin API to create `demo@courtside.invalid` with confirmed email if missing. It sets the username `courtside_demo` and `hidden = true`.
2. **Sign in.** It gets a magic link with `auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: "http://localhost:3001/auth/callback?next=/market" } })` and opens it in the browser context, so the session cookie is set.
3. **Record** at 1280×720 using Playwright's `recordVideo`. Injected page script draws a cursor dot that follows mouse moves and pulses on clicks, plus a caption bar at the bottom. Each scene:
   - **Market:** "Every NBA rotation player is a stock." Hover, sort by Last night.
   - **Player page:** "Prices move on real box scores." Scroll through the chart, "Why it moved", and the schedule.
   - **Buy:** "Buy with paper money." Type 5 shares, click Buy, show the confirmation.
   - **Scores:** "Watch your players live." The live game card opens.
   - **Rooms:** "Start a league with friends." Fill the create-room form and submit. The room page appears, then hover Copy invite link.
   - **End card:** "Courtside Exchange. Play free."
4. **Save** the video to `public/demo.webm`, and a screenshot of the first scene to `public/demo-poster.png`.
5. **Clean up.** The demo user's private room is deleted with `delete_room`. Its Public trades remain, but it's hidden from leaderboards.

Moves are slow and deliberate, about 600–900 ms each, with a short pause per scene, to land at 45–60 seconds.

## 4. Testing

- **Database:** leaderboard ranks skip hidden accounts (a hidden #1 doesn't take a rank, and the visible players are ranked 1..n).
- **Unit:** `topMovers(players, n)` returns the top risers and fallers by `last_move.total`, ignoring players with no move.
- **Smoke tests:**
  - `/` returns 200 signed out and shows the headline and both buttons
  - `/market` still works
  - the logo links to `/`
- **Build checks:** the build passes, and the hero is prerendered (◐).
- **Recording:** `npm run record-demo` produces a video of 45–60 seconds. Watch it before committing.

## 5. Out of scope

Global or season-long leagues beyond rooms, audio narration, marketing analytics, and SEO beyond page metadata.
