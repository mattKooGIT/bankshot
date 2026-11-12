# Feed Replies, Any-Emoji Reactions, and "Try the Demo" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replies and any-emoji reactions in room feeds, then a one-click "Try the demo" sandbox for portfolio visitors.

**Architecture:**
- Two migrations: `0012` (feed) and `0013` (demo). All the rules live in security-definer SQL functions with PGlite tests.
- The UI calls them through server actions.
- The demo is a Supabase anonymous user plus one service-role `seed_demo` function. Cleanup rides on the nightly sync.

**Tech Stack:** Next.js 16.4 (Cache Components), Supabase, PGlite, `tsx --test`, `frimousse@0.4.0`, Playwright.

**Specs:**
- `docs/superpowers/specs/2026-11-12-feed-replies-and-emoji-design.md`: Tasks 1–2
- `docs/superpowers/specs/2026-11-12-demo-guest-design.md`: Tasks 3–5

## Global Constraints
- **Copy is verbatim from the specs:**
  - "Not a supported emoji."
  - "That's enough reactions for one post."
  - "Replies are 1–280 characters."
  - "Slow down — try again in a minute."
  - "You are not in this room."
  - "Not a guest."
  - "Demo bots are missing."
  - "The demo couldn't start. Try again in a minute."
  - "Try the demo — no sign-up"
  - "Setting up your demo…"
  - "You're in a demo account. It resets in 24 hours."
  - "Demo accounts have no email."
- **Values:**
  - reaction cap: 50 distinct emojis per user per event
  - Popular row: 🔥 😂 💀 📉
  - replies preview: latest 3
  - guest lifetime: 24 hours
  - bots: `bucket_getter`, `fade_master`, `sixth_man`
- **Every UPDATE and DELETE has a WHERE clause** (the safeupdate test). Every new function is security definer with `search_path = public`. Service-role-only functions are revoked from `public`, `anon` and `authenticated`.
- **Never** prefix the service-role key with `NEXT_PUBLIC_`.
- **Branch `feature/demo-guest`.** Commit per task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Before writing Next.js code,** read the relevant guide in `node_modules/next/dist/docs/`, per AGENTS.md.

## Review Focus
1. **An anonymous guest opens a page that assumes an email** (header, settings, recap): no crash, and settings shows "Demo accounts have no email." (Task 4)
2. **`startDemo` while anonymous sign-ins are off in Supabase:** the visitor lands on `/login?error=demo` with the copy above, not a 500. (Task 4)
3. **Clicking "Try the demo" while already a guest** reuses the existing guest and room instead of creating a second anonymous user. (Task 4)
4. **A guest who joined a real user's room via invite is cleaned up:** the guest's membership goes, and the real room and its owner survive. (Task 3)
5. **Feed polling while the emoji menu is open:** the popover stays open and keeps its search text across a 30-second refresh. (Task 2: the popover state lives outside the polled list, keyed by event ID.)

---

### Task 1: Migration `0012`: replies and any-emoji reactions (database)
**Files:**
- Create: `supabase/migrations/0012_feed_replies_emoji.sql`, `supabase/tests/replies.test.ts`
- Modify: `supabase/tests/feed.test.ts:60`. It currently expects '👍' to be rejected; change it to expect 'lol' to be rejected.

**Interfaces:**
- **Produces:**
  - `is_single_emoji(text) → boolean`
  - `post_reply(p_event bigint, p_text text) → bigint`
  - `event_replies(p_event bigint) → table(id bigint, actor text, text text, created_at timestamptz, reactions jsonb, mine text[])`
  - `room_feed(...)` gains the columns `reply_count int` and `replies jsonb`. Each element of `replies` is `{id, actor, text, created_at, reactions, mine}`.
  - `room_events.parent_id`; the new `kind` value `'reply'`
- **Note:** `room_feed`'s return type changes, so `drop function room_feed(uuid,bigint,int)` and recreate it with the same grants.

- [ ] **Step 1: Write failing tests** in `replies.test.ts`, using `feedWorld()` from `feed-fixtures.ts`:
  - **`is_single_emoji` accepts** 🔥, 🐐, 👍🏽, 👨‍👩‍👧, 🇺🇸, ❤️ and #️⃣. **It rejects** '', 'lol', 'a', '🔥🔥', '🔥a', ' 🔥', '😂😂😂' and '!'. Assert each.
  - **Reaction cap:** insert 50 distinct reactions for one user and event directly (any 50 single emojis, e.g. code points U+1F600 to U+1F631). Then `toggle_reaction` with a 51st rejects `/enough reactions/`, and toggling one of the existing 50 off still works.
  - **A reply to a reply** has the top-level event as its `parent_id`.
  - **Shared rate limit:** 3 `post_comment` calls and 2 `post_reply` calls succeed, and the 6th call of either kind rejects `/Slow down/`.
  - **Non-members:** `post_reply` rejects `/not in this room/`, and `event_replies` returns 0 rows.
  - **Text length:** `post_reply` with '' or 281 characters rejects `/Replies are 1–280/`.
  - **`room_feed`:** with 5 replies on one event, the top level contains no `reply` rows, `reply_count = 5`, and `replies` holds the latest 3, oldest first.
  - **Cascades:** deleting the parent event (as superuser) and `delete_room` each leave 0 replies and 0 reactions on them.
- [ ] **Step 2:** Run `npm run test:db`. Expected: the new tests FAIL (missing functions or columns), and `feed.test.ts` fails on line 60.
- [ ] **Step 3: Implement the migration** per spec §1. `post_comment` changes only its rate-limit predicate, to `kind in ('comment','reply')`.
- [ ] **Step 4:** Run `npm run test:db`. Expected: all pass.
- [ ] **Step 5: Commit:** "Feed: replies and any-emoji reactions (migration 0012)".

### Task 2: Feed UI: the emoji menu and replies
**Files:**
- Create: `src/app/rooms/[id]/EmojiMenu.tsx` (client)
- Modify: `src/lib/feed.ts`, `src/lib/feed.test.ts`, `src/app/rooms/[id]/Activity.tsx`, `src/app/rooms/[id]/feed-actions.ts`, `package.json`

**Interfaces:**
- **Consumes:** Task 1's RPCs.
- **Produces:**
  - `sortReactions(r: Record<string, number>): [string, number][]`
  - `POPULAR = ["🔥","😂","💀","📉"]`. This replaces the `REACTIONS` export.
  - `FeedEvent` gains `reply_count: number` and `replies: Reply[]`, where `Reply = {id, actor, text, created_at, reactions, mine}`.
  - Server actions:
    - `postReply(eventId: string, text: string): Promise<FormState>`
    - `loadReplies(eventId: string): Promise<Reply[]>`
  - `<EmojiMenu mine={string[]} onPick={(emoji) => void} />`

- [ ] **Step 1: Unit test first:**
  - `sortReactions({"🐐":1,"🔥":3,"😂":3})` deep-equals `[["😂",3],["🔥",3],["🐐",1]]`. Ties are broken by `localeCompare`; assert the exact order the function produces once, then pin it.
  - `sortReactions({})` is `[]`.
- [ ] **Step 2:** Run `npm run test:unit`. Expected: FAIL. Then implement it, and the test PASSES.
- [ ] **Step 3:** Run `npm i frimousse@0.4.0`. Build `EmojiMenu`:
  - a ☺+ button with `aria-label="Add reaction"` and `aria-expanded`
  - a popover holding the Popular row, with `mine` highlighted, above `EmojiPicker.Root`, `.Search`, `.Viewport` and `.List`
  - `onEmojiSelect` calls `onPick` and leaves the popover open
  - closes on Escape or an outside click, then returns focus to the button
- [ ] **Step 4: Update `Activity.tsx`:**
  - Chips come from `sortReactions`. The viewer's own reactions are highlighted, and clicking a chip toggles it (optimistic, as now).
  - `EmojiMenu` appears on every event row and every reply row.
  - Each reply row has a "Reply" link. It opens an inline box under its thread; when replying to a reply, the box is prefilled with "@username ".
  - Replies are indented, each showing the author, text, relative time and chips.
  - "View all N replies" appears when `reply_count > 3` and calls `loadReplies`.
  - Errors show under the box.
  - **Review Focus 5:** the popover's open state and the reply box's open state and draft are each held in a `Map` keyed by event ID, above the polled list, so a refresh doesn't reset them.
- [ ] **Step 5:** Run `npx next typegen && npx tsc --noEmit && npm run lint && npm run build`. Expected: pass.
- [ ] **Step 6: Commit:** "Feed UI: emoji menu and replies".

### Task 3: Migration `0013`: demo seed, demand guard, guest cleanup (database)
**Files:**
- Create: `supabase/migrations/0013_demo_guest.sql`, `supabase/tests/demo.test.ts`
- Modify: `supabase/tests/harness.ts`. Add `is_anonymous boolean not null default false` to the `auth.users` stub, plus a helper `makeUser(db, {anonymous?, createdAt?})`.

**Interfaces:**
- **Consumes:** Task 1's `post_reply`, the `reply` kind and `is_single_emoji`.
- **Produces:**
  - `seed_demo(p_guest uuid) → uuid` (the room ID)
  - `delete_stale_guests() → int`
  - `execute_trade` redefined: copy it from `0006_rooms.sql` unchanged, except that both `pending_demand` updates also require `not (select hidden from profiles where id = auth.uid())`.

- [ ] **Step 1: Write failing tests** in `demo.test.ts`:
  - **Setup:**
    - create the 3 bot users with usernames and `hidden`
    - use 3 game nights with `price_history` for at least 30 active players
    - create one anonymous guest
  - **`seed_demo`:**
    - returns a room named `Demo League`, owned by the guest, with 4 members
    - each member has 4 holdings, and cash equals 10000 minus the cost at first-night prices; each member spends between $8,000 and $9,500
    - `net_worth_history` has 3 rows per member
    - exactly 1 `night` event (for night N)
    - 3 comments with the spec's texts
    - 1 reply by `sixth_man`, "@fade_master check the standings first", whose `parent_id` is the "fade_master you're cooked" comment
    - reactions include 🐐 and 🧊
    - every `trade` event's `created_at` is earlier than `now() - 1 hour`
    - the guest's profile has `hidden = true` and a username matching `^guest_\d{4}$`
  - **Seeding twice** returns the same ID, and the counts of events, trades and holdings are unchanged.
  - **A non-anonymous user** rejects `/Not a guest/`. **Removing one bot profile** rejects `/Demo bots are missing/`.
  - **With no game nights:** the seed still succeeds, buying at `players.price`. There's no `night` event and no history.
  - **Demand:** a hidden user's Public buy leaves `pending_demand` unchanged, while a normal user's buy of the same player raises it by the shares bought.
  - **`delete_stale_guests`:**
    - **Removed:** a guest created 25 hours ago, together with their Demo League.
    - **Kept:**
      - a guest created 1 hour ago
      - the bots
      - a real user
    - **Review Focus 4:** the 25-hour guest had also joined a real user's private room. That room and its owner survive, and the guest's membership is gone.
    - Returns 1.
  - **Grants:** as `authenticated`, both functions reject with a permission error.
- [ ] **Step 2:** Run `npm run test:db`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** per the demo spec §1:
  - player ranks: guest 1, 5, 9, 13; `bucket_getter` 2, 3, 4, 6; `fade_master` 21–24; `sixth_man` 7, 12, 17, 22
  - share counts are each player's equal share of $8,700, rounded down
  - the night event reuses `post_night_results`' standings logic, scoped to the new room and including hidden members
  - trade events are back-dated with a WHERE-scoped `update room_events set created_at = …` keyed by room
- [ ] **Step 4:** Run `npm run test:db`. Expected: all pass.
- [ ] **Step 5: Commit:** "Demo seed, hidden-demand guard, guest cleanup (migration 0013)".

### Task 4: Demo sign-in: server, buttons, guest bar
**Files:**
- Create:
  - `src/lib/demo.ts`
  - `src/lib/demo.test.ts`
  - `src/app/demo/actions.ts`
  - `src/components/DemoButton.tsx` (client; uses `useFormStatus` for "Setting up your demo…")
  - `src/components/GuestBar.tsx`
- Modify:
  - `src/app/HeroActions.tsx`: signed-out view only
  - `src/app/login/page.tsx`: the button, plus the `error=demo` message
  - `src/components/SiteHeader.tsx`: render `GuestBar` inside the existing Suspense when the user is a guest
  - `src/app/settings/page.tsx` and `src/app/settings/SettingsForms.tsx`
  - `src/lib/sync.ts`: after the nights, call `delete_stale_guests` in try/catch, with a warning on failure

**Interfaces:**
- **Consumes:** `seed_demo`, `delete_stale_guests`.
- **Produces:**
  - `isGuest(claims: { is_anonymous?: boolean } | null | undefined): boolean`
  - `ensureDemoBots(admin: SupabaseClient): Promise<void>`
  - `startDemo(): Promise<void>` (a server action that redirects)
  - `signOutToLogin(): Promise<void>`

- [ ] **Step 1: Unit tests first:**
  - `isGuest({is_anonymous:true})` is true
  - `isGuest({is_anonymous:false})`, `isGuest(null)` and `isGuest(undefined)` are false
- [ ] **Step 2:** Run `npm run test:unit`. Expected: FAIL. Implement, and it PASSES.
- [ ] **Step 3: Implement `ensureDemoBots`:**
  - for each bot, `admin.auth.admin.createUser({ email: "<name>@bankshot.invalid", email_confirm: true })`, ignoring "already" errors
  - then update the profile's `username` and `hidden = true`, looked up by ID via `listUsers` or the create result
  - memoize the success in a module-level promise; reset it on failure
- [ ] **Step 4: Implement `startDemo`:**
  1. If the current claims are already a guest (Review Focus 3), skip sign-in.
  2. Otherwise call `supabase.auth.signInAnonymously()`.
  3. Call `ensureDemoBots`, then `seed_demo` via the service-role client.
  4. Set the `room` cookie and `redirect('/rooms/<id>')`.

  **On any failure** (Review Focus 2): if this call signed the user in, sign them out, then `redirect('/login?error=demo')`. Make sure the redirect isn't swallowed by catch: call `redirect` outside the try.
- [ ] **Step 5: Guest-facing UI:**
  - **Settings, for a guest** (Review Focus 1): the email section shows "Demo accounts have no email."; the username form still works.
  - **Guest bar:** the "Sign up" link is a form button calling `signOutToLogin`.
- [ ] **Step 6:** Run `npx next typegen && npx tsc --noEmit && npm run lint && npm test && npm run build`. Expected: pass.
- [ ] **Step 7: Commit:** "Try the demo: guest sign-in, buttons, guest bar, nightly cleanup".

### Task 5: Live setup, preview walkthrough, verification, review
- [ ] **Ask the user to:**
  - run `0012`, then `0013`, in the Supabase SQL Editor
  - turn on **Allow anonymous sign-ins**

  Then verify from here: as the service role, `seed_demo` exists, and anonymous sign-in returns a session.
- [ ] **Playwright walkthrough on the 3001 preview:** rebuild with `npm run preview:fake-live` and `ENABLE_DEV_PREVIEW=1`, then write `scripts/try-demo.ts`, which:
  1. opens `/` and clicks "Try the demo — no sign-up"
  2. waits for `/rooms/<uuid>`
  3. asserts the night card, the 3 comments and the reply are visible
  4. opens ☺+ and picks 🐐 from search, then posts a reply
  5. visits `/portfolio`, and asserts 4 holdings rows and the guest bar
  6. takes screenshots into the scratchpad

  Then it deletes the guest via the admin API, which also deletes the room through `delete_stale_guests` semantics or an explicit room delete.
- [ ] **Run** the full suite, typecheck, lint and build. Then run a fresh whole-branch reviewer on the most capable model. Fix Critical and Important findings test-first, and list the minors.
