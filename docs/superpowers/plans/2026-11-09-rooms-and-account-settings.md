# Rooms and Account Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private rooms with invite links and separate per-room portfolios, plus a settings page to change username and email.

**Architecture:**
- All rules and money moves live in one new Postgres migration, `0006_rooms.sql`, built up across Tasks 2–4 and tested on PGlite with Supabase stubs.
- The Next.js app reads the current room from a `room` cookie, which `src/lib/rooms.ts` validates. Trade, portfolio, leaderboard and header become room-aware in one cutover task, Task 5.
- The user runs `0006` in the Supabase SQL Editor once the app is ready for it (end of Task 5). The new pages follow after that.

**Tech Stack:** Next.js 16.4 App Router with Cache Components, React 19.3, TypeScript, Tailwind v4, Supabase (`@supabase/ssr` 0.12, `supabase-js` 2.119), PGlite 0.3 for database tests, `tsx --test` (node:test) for tests.

**Spec:** `docs/superpowers/specs/2026-11-09-rooms-and-account-settings-design.md`

## Global Constraints

- **Next 16 conventions:**
  - `proxy.ts`, not middleware.
  - `cookies()`, `headers()`, `params` and `searchParams` are async.
  - Per-user reads go inside `<Suspense>`, because `cacheComponents: true` is on.
  - `refresh()` from `next/cache` only inside Server Functions.
  - Read `node_modules/next/dist/docs/` before using any API not already used in this repo.
- **Supabase safeupdate:** every `UPDATE` and `DELETE` in `0006` must have a `WHERE` clause (use `where true` for intentional all-rows). Task 1 adds a test that enforces this.
- **Money and membership changes happen only in `security definer` functions** with `set search_path = public`. No direct table writes from the app.
- **Public room ID** is the constant `00000000-0000-4000-8000-000000000001`, named `PUBLIC_ROOM_ID` in TypeScript and `public_room_id()` in SQL.
- **Room limits:**
  - name 1–40 characters
  - `starting_cash` 1,000–1,000,000
  - `member_cap` 2–50 or null
  - `ends_at` strictly after `eastern_today()` at creation
- **Invite code:** `left(replace(gen_random_uuid()::text, '-', ''), 12)`. No pgcrypto, which PGlite lacks.
- **Username rule:** `^[a-zA-Z0-9_]{3,20}$`, unique ignoring case.
- **"Today" in SQL is always `eastern_today()`,** a new function returning `(now() at time zone 'America/New_York')::date`. Tests override it with `create or replace` to control the date.
- **Removed:** `profiles.cash`, the old `execute_trade(text,text,int)`, `leaderboard(int)` and `play_game_night()` (stale simulation code that reads dropped columns).
- **No passwords anywhere.**
- **Commit after every task,** ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Node runs through nvm:** prefix shell commands with `source ~/.nvm/nvm.sh &&`.

## Review Focus

1. **End-date boundary in US Eastern.** A trade on the `ends_at` day succeeds, and the next day fails with "This room has ended." The test lives in Task 3.
2. **Case-only username change.** `matt` renaming to `Matt` succeeds, while taking another user's name in any case fails. The test lives in Task 4.
3. **Stale room cookie.** After removal from a room, or with a garbage cookie value, every page falls back to Public instead of erroring. The smoke test lives in Task 5.
4. **A member who never traded,** when the room finalizes, gets `final_net_worth` equal to `starting_cash` and still appears in final standings. The test lives in Task 3.
5. **Signed-out invite round trip.** `/join/<code>` leads to sign-in (email link or Google) and back to `/join/<code>`, with `next` preserved through `/auth/callback`. The smoke test lives in Task 8.

---

### Task 1: Database test harness in the repo

Moves the scratch PGlite tests into the repo so every later database task is test-first.

**Files:**
- Create: `supabase/tests/harness.ts`, `supabase/tests/existing.test.ts`, `supabase/tests/safeupdate.test.ts`
- Modify: `package.json` (devDependency `@electric-sql/pglite@^0.3.16`; scripts below)

**Interfaces:**
- Produces, from `supabase/tests/harness.ts`:
  - `freshDb(opts?: { through?: string }): Promise<Db>` loads the Supabase stubs (roles `anon` and `authenticated`, `auth.users`, and `auth.uid()` reading `request.jwt.claim.sub`), then every file in `supabase/migrations` in order up to and including `through`, which defaults to all. It also loads `seed.sql` right after `0001`.
  - `type Db = { q<T = any>(sql: string, params?: unknown[]): Promise<T[]>; exec(sql: string): Promise<void> }`
  - `signUp(db, id: string, email: string): Promise<void>` inserts into `auth.users`, which fires `handle_new_user`.
  - `actAs(db, id: string | null): Promise<void>` sets or clears `request.jwt.claim.sub`.
  - `addRealPlayers(db, rows: { espn_id: string; name: string; team: string; pos: "G"|"F"|"C" }[], games = 3): Promise<void>` inserts final games and identical stat lines (25 MIN, 15 PTS, 5 REB, 3 AST, 1 STL, 1 BLK, 2 TOV), then calls `bootstrap_market()`.
  - `setToday(db, date: string): Promise<void>` replaces `eastern_today()` (once Task 2 creates it).
- `package.json` scripts:
  - `"test:db": "tsx --test 'supabase/tests/**/*.test.ts'"`
  - `"test:unit": "tsx --test 'src/**/*.test.ts'"`
  - `"test": "npm run test:db && npm run test:unit"`

- [ ] **Step 1:** Port the existing scratch scenarios into `existing.test.ts`, run against migrations `0001`–`0005`. Required tests:
  - bootstrap links the seed `JOKIC` to "Nikola Jokic"
  - readable tickers (`WILLIAMSON`, `JALGREEN`)
  - buying an injured player succeeds
  - `apply_real_game_night` twice on one date throws "already applied"
  - an unfinished date throws "Not every game"
- [ ] **Step 2:** Write `safeupdate.test.ts`. For each migration numbered `>= 0006`, every match of `/\b(?<!do\s)update\s+[\w.]+(\s+\w+)?\s+set\b[^;]*;/gi` and `/\bdelete\s+from\s+[\w.]+[^;]*;/gi` must contain `\bwhere\b`. If no such file exists the test passes, and it must fail on a fixture string `"update players set price = 1;"`.
- [ ] **Step 3:** Run `source ~/.nvm/nvm.sh && npm run test:db`. Expected: all pass.
- [ ] **Step 4:** Commit: "Add PGlite database test harness".

---

### Task 2: Migration 0006, part 1: rooms schema, data migration and room-aware trading

**Files:**
- Create: `supabase/migrations/0006_rooms.sql`
- Test: `supabase/tests/rooms-trading.test.ts`

**Interfaces:**
- Produces in SQL:
  - `public_room_id() returns uuid` (immutable) and `eastern_today() returns date` (stable)
  - Tables `rooms` and `room_members`, with exactly the columns and constraints in spec §1. A partial unique index `on rooms (is_public) where is_public` allows only one public room.
  - `room_id uuid not null` on `holdings`, `trades` and `net_worth_history`, with composite foreign keys to `room_members (room_id, user_id) on delete cascade`.
  - Primary keys: `holdings (room_id, user_id, ticker)`; `net_worth_history (room_id, user_id, night)`.
  - The trades index is replaced with `(room_id, user_id, created_at desc)`.
  - `profiles.cash` is dropped.
  - `handle_new_user()` also inserts a Public membership with $10,000.
  - `execute_trade(p_room uuid, p_ticker text, p_side text, p_shares int) returns json`, with the same JSON shape as today, where `cash` is the room cash. It is granted to `authenticated`. The old 3-argument version is dropped.
  - `play_game_night()` is dropped.
- RLS:
  - `rooms` select: `is_public or exists (membership for auth.uid())`. Column `invite_code` has `select` revoked from `anon` and `authenticated`.
  - `room_members`, `holdings`, `trades` and `net_worth_history` select: `user_id = auth.uid()`.

- [ ] **Step 1: Write failing tests** in `rooms-trading.test.ts`. First load migrations through `0005`, sign up two users, buy 3 `SGA` as user A, then load `0006`. Tests:
  - `migrates existing users into Public`: user A's `room_members` row in `public_room_id()` has `cash` equal to its pre-migration value. The holding and the trade carry `room_id = public_room_id()`. Column `profiles.cash` no longer exists.
  - `new sign-up joins Public with 10000`.
  - `cash is separate per room`: insert a private room directly (as test setup), add A with 5000 cash, buy 2 `SGA` there. A's Public cash is unchanged, and the private holding is 2 shares.
  - `only Public trades move demand`: after the private buy, `players.pending_demand` for `SGA` changes by 0. After a Public buy of 1, it changes by +1.
  - `non-member cannot trade`: user B trading in A's private room throws "You are not in this room."
  - Review Focus 1, `trading allowed on end date, locked after`: with `ends_at = '2026-12-25'`, `setToday('2026-12-25')` lets a buy succeed, and `setToday('2026-12-26')` makes it throw "This room has ended."
  - `finalized room is locked`: `finalized_at` is set, so a trade throws "This room has ended."
- [ ] **Step 2:** Run `npm run test:db`. Expected: the new tests fail because `0006` doesn't exist yet.
- [ ] **Step 3:** Implement the `0006` schema, data migration (spec §1 "Migrating existing data", in that order), `handle_new_user` and `execute_trade`, with RLS as above. Error messages verbatim:
  - "You are not in this room."
  - "This room has ended."
  - "Not enough cash. You can afford % shares." (existing)
  - "You own % shares of %." (existing)
- [ ] **Step 4:** Run `npm run test:db`. Expected: all pass, including `safeupdate.test.ts`.
- [ ] **Step 5:** Commit: "Migration 0006: rooms schema and room-aware trading".

---

### Task 3: Migration 0006, part 2: nightly finalize and room leaderboard

**Files:**
- Modify: `supabase/migrations/0006_rooms.sql` (append)
- Test: `supabase/tests/rooms-night.test.ts`

**Interfaces:**
- Produces:
  - `apply_real_game_night(p_date date, p_out text[])`: same signature and pricing. Net worth is recorded per `room_members` row for rooms with `finalized_at is null`. Then it finalizes rooms with `ends_at <= p_date and finalized_at is null` (spec §3).
  - `leaderboard(p_room uuid, p_limit int default 50) returns table (rank bigint, username text, net_worth numeric, is_me boolean)`. It returns no rows when the room is private and the caller isn't a member. For a finalized room it ranks by `final_net_worth`. It is granted to `anon` and `authenticated`. Old `leaderboard(int)` is dropped.

- [ ] **Step 1: Write failing tests:**
  - `net worth recorded per room`: A is in Public and a private room. After one game night there is one `net_worth_history` row per room for A.
  - `finalizes on first game night on or after ends_at`: with `ends_at = '2026-10-23'` and a game night on `2026-10-24`, `finalized_at` is not null and every member's `final_net_worth` is set.
  - Review Focus 4, `member who never traded finalizes at starting cash`: B joined with 5000 and never traded, so `final_net_worth = 5000.00` and B appears in `leaderboard(room)`.
  - `final standings frozen`: after finalization, another game night changes prices, but `leaderboard(room)` values are unchanged.
  - `public leaderboard works signed out`: `actAs(db, null)`, then `leaderboard(public_room_id())` returns rows.
  - `private leaderboard hidden from non-members`: as B (not a member), `leaderboard(privateRoom)` returns 0 rows.
- [ ] **Step 2:** Run `npm run test:db`. Expected: the new tests fail.
- [ ] **Step 3:** Implement both functions in `0006`.
- [ ] **Step 4:** Run `npm run test:db`. Expected: all pass.
- [ ] **Step 5:** Commit: "Migration 0006: room finalization and per-room leaderboard".

---

### Task 4: Migration 0006, part 3: room management and username functions

**Files:**
- Modify: `supabase/migrations/0006_rooms.sql` (append)
- Test: `supabase/tests/rooms-manage.test.ts`

**Interfaces.** All functions are `security definer` and granted to `authenticated` unless noted:
- `create_room(p_name text, p_starting_cash numeric, p_member_cap int, p_ends_at date) returns json` gives `{ "id": uuid, "invite_code": text }`. The creator becomes owner and member.
- `join_room(p_invite_code text) returns uuid` locks the room row `for update` before the cap check.
- `room_preview(p_invite_code text) returns json` gives `{ id, name, owner_username, member_count, member_cap, starting_cash, ends_at, ended boolean }`, or `null`. It is also granted to `anon`.
- `room_invite(p_room uuid) returns text` is owner only.
- `room_roster(p_room uuid) returns table (user_id uuid, username text, joined_at timestamptz, is_owner boolean)` is members only.
- `remove_member(p_room uuid, p_user uuid) returns void`.
- `reset_invite(p_room uuid) returns text` returns the new code.
- `set_username(p_username text) returns text` returns the stored username.
- Error messages verbatim:
  - "Room name must be 1–40 characters."
  - "Starting cash must be between $1,000 and $1,000,000."
  - "Member cap must be between 2 and 50."
  - "End date must be in the future."
  - "This invite link is no longer valid."
  - "This room is full."
  - "This room has ended."
  - "You're already in this room."
  - "Only the room owner can do that."
  - "You can't remove yourself."
  - "The Public room can't be changed."
  - "Usernames are 3–20 letters, numbers, or underscores."
  - "That username is taken."

- [ ] **Step 1: Write failing tests:**
  - `create_room validates limits`: one case per limit message above. Starting cash 999 and 1,000,001 both reject, and 1,000 and 1,000,000 both accept.
  - `create then join`: B joins with A's code and gets `cash = starting_cash`. The roster shows 2 members, with `is_owner` true only for A.
  - `member cap enforced`: cap 2, A and B are in, C's join throws "This room is full."
  - `rejoin rejected`: throws "You're already in this room."
  - `ended room rejects join`: `setToday` is after `ends_at`.
  - `reset invite kills old link`: after `reset_invite`, `room_preview(old)` is null and `join_room(old)` throws "no longer valid"; the new code works.
  - `owner-only actions`: B calling `remove_member`, `reset_invite` or `room_invite` throws "Only the room owner can do that."
  - `remove cascades only that room`: B holds shares in the room and in Public. After A removes B, B's room holdings, trades and membership are gone and B's Public data is intact.
  - `members cannot read invite_code or others' cash`: as B, `select invite_code from rooms` errors with permission denied, and `select * from room_members` returns only B's rows.
  - `room_preview works signed out`.
  - Review Focus 2, `set_username`: `matt` to `Matt` succeeds. Taking `JOE` when `joe` exists throws "That username is taken." `ab` and `bad-name!` throw the format message.
- [ ] **Step 2:** Run `npm run test:db`. Expected: the new tests fail.
- [ ] **Step 3:** Implement the functions and grants.
- [ ] **Step 4:** Run `npm run test:db`. Expected: all pass, including safeupdate.
- [ ] **Step 5:** Commit: "Migration 0006: room management and set_username".

---

### Task 5: App cutover to rooms (current room, switcher, trading, portfolio, leaderboard)

After this task the app works **only** against `0006`. The final steps hand the migration to the user.

**Files:**
- Create: `src/lib/dates.ts` (move `easternToday` and `addDays` here from `src/lib/sync.ts`, which re-imports them), `src/lib/rooms.ts`, `src/lib/rooms.test.ts`, `src/app/rooms/actions.ts`, `src/components/RoomSwitcher.tsx`
- Modify:
  - `src/components/SiteHeader.tsx` (switcher, room cash, and links to Rooms and Settings)
  - `src/app/players/[ticker]/TradePanel.tsx`, `TradeForm.tsx` and `actions.ts`
  - `src/app/portfolio/page.tsx`
  - `src/app/leaderboard/page.tsx`

**Interfaces:**
- `src/lib/rooms.ts` is server-only, except the pure `isRoomEnded`:
  - `PUBLIC_ROOM_ID = "00000000-0000-4000-8000-000000000001"`
  - `type Room = { id: string; name: string; is_public: boolean; owner_id: string | null; starting_cash: number; member_cap: number | null; ends_at: string | null; finalized_at: string | null }`
  - `isRoomEnded(room: Pick<Room, "ends_at" | "finalized_at">, today?: string): boolean` is true when finalized or `ends_at < today`. `today` defaults to `easternToday()`.
  - `getMyRooms(): Promise<Room[]>` returns Public first, then the rest by name.
  - `getCurrentRoom(): Promise<{ userId: string; room: Room; cash: number } | null>` returns null when signed out. It reads the `room` cookie, keeps it only if it's a room you're a member of, and otherwise uses Public.
- `src/app/rooms/actions.ts`: `switchRoom(roomId: string): Promise<void>` sets the `room` cookie (httpOnly, sameSite lax, path `/`, 1 year), then calls `refresh()`.
- The trade Server Function reads `room` from a hidden form field and calls `execute_trade` with `p_room`.

- [ ] **Step 1:** Write `src/lib/rooms.test.ts` for `isRoomEnded`:
  - `{ ends_at: "2026-12-25", finalized_at: null }` is false on `2026-12-25` and true on `2026-12-26`
  - null `ends_at` is false
  - a set `finalized_at` is true
- [ ] **Step 2:** Run `npm run test:unit`. Expected: fails because the module is missing.
- [ ] **Step 3:** Implement `dates.ts`, `rooms.ts`, `switchRoom` and `RoomSwitcher` (a client `<select>` calling `switchRoom`). The header shows the switcher and "{cash} cash" for the current room; signed-out visitors see no switcher.
- [ ] **Step 4:** Update the trade panel:
  - It shows "Trading in: {room.name}" with the room's cash and the holding filtered by `room_id`.
  - When `isRoomEnded`, it renders "This room has ended." instead of the form.
  - The label shows in every room, Public included, as the spec requires.
- [ ] **Step 5:** Update the portfolio page:
  - Read `room_members.cash` instead of `profiles.cash`, and filter all queries by `room_id`.
  - `STARTING_CASH` becomes `room.starting_cash`.
  - The heading reads "Portfolio · {room.name}".
- [ ] **Step 6:** Update the leaderboard page: call `leaderboard({ p_room, p_limit: 100 })` with the current room (Public when signed out), make the return % relative to the room's `starting_cash`, and show the room name in the heading.
- [ ] **Step 7:** Run `npm run test:unit && npx tsc --noEmit && npm run lint && npm run build`. Expected: all pass, with no Suspense or blocking-route errors.
- [ ] **Step 8:** Commit: "Make trading, portfolio and leaderboard room-aware". Then ask the user to run `supabase/migrations/0006_rooms.sql` in the SQL Editor, and wait for them.
- [ ] **Step 9:** After the user runs it, verify live with the service key:
  - every profile has a Public membership
  - no `holdings` or `trades` row has a null `room_id`
  - the `profiles.cash` column is gone
- [ ] **Step 10:** Smoke test on `next start`:
  - `/market`, `/players/SGA`, `/portfolio` and `/leaderboard` return 200 when signed out
  - Review Focus 3: with a cookie `room=not-a-uuid`, and with a cookie for a room the caller isn't in, `/portfolio` and `/leaderboard` render Public with no error in the server log
- [ ] **Step 11:** Ask the user to buy and sell once in Public, and confirm the header cash changes.

---

### Task 6: Settings page (username and email)

**Files:**
- Create: `src/app/settings/page.tsx`, `src/app/settings/actions.ts`, `src/app/settings/SettingsForms.tsx`, `src/lib/forms.ts`

**Interfaces:**
- `updateUsername(prev: FormState, fd: FormData): Promise<FormState>` calls `set_username` then `refresh()`.
- `updateEmail(prev: FormState, fd: FormData): Promise<FormState>` calls `supabase.auth.updateUser({ email }, { emailRedirectTo: <origin>/auth/callback?next=/settings })`. Build the origin the same way as `src/app/login/actions.ts`.
- `src/lib/forms.ts` exports `type FormState = { ok?: boolean; message?: string }`, which Tasks 7 and 8 reuse.

- [ ] **Step 1:** Implement the page, with all user reads inside `<Suspense>`:
  - Signed-out visitors get a sign-in link to `/login?next=/settings`.
  - The username form is prefilled.
  - The email form shows the current email.
  - The success copy is verbatim: "Check both your old and new inbox. The change takes effect after you confirm from both."
  - "Sign-in methods" lists "Email link" plus "Google" when `user.identities` includes provider `google`.
- [ ] **Step 2:** Run `npx tsc --noEmit && npm run lint && npm run build`. Expected: all pass.
- [ ] **Step 3:** Smoke test: a signed-out `/settings` shows the sign-in prompt. Then the user renames themselves, and the header and `/leaderboard` show the new name.
- [ ] **Step 4:** Commit: "Add settings page: change username and email".

---

### Task 7: Rooms list, create form, and room page with owner controls

**Files:**
- Create: `src/app/rooms/page.tsx`, `src/app/rooms/CreateRoomForm.tsx`, `src/app/rooms/[id]/page.tsx`, `src/app/rooms/[id]/OwnerControls.tsx`
- Modify: `src/app/rooms/actions.ts`

**Interfaces.** These are added to `src/app/rooms/actions.ts`:
- `createRoom(prev: FormState, fd: FormData): Promise<FormState>` calls `create_room`, sets the `room` cookie to the new room, then redirects to `/rooms/<id>`.
- `removeMember(roomId: string, userId: string): Promise<FormState>` calls `remove_member` then `refresh()`.
- `resetInvite(roomId: string): Promise<FormState>` calls `reset_invite` then `refresh()`.
- The invite URL is `<origin>/join/<code>`, with the origin built as in the login actions.

- [ ] **Step 1:** `/rooms`, signed in:
  - Lists `getMyRooms()` with your rank and net worth from `leaderboard(room)`, plus the end date or a "Final" badge.
  - Has a create form with name, starting cash (default 10000), an optional member cap and an optional end date. The `min` on the date input is tomorrow in US Eastern.
  - Signed out, it shows a sign-in prompt.
- [ ] **Step 2:** `/rooms/[id]`:
  - A member sees standings from `leaderboard`, the roster from `room_roster`, the end date or "Final · Winner: {rank 1 username}", and a "Switch to this room" button.
  - The owner also sees the invite link from `room_invite` with a Copy button (client, `navigator.clipboard`), "Reset invite link", and a "Remove" button per non-owner member behind a `confirm()` dialog.
  - A non-member, or an invalid ID, gets `notFound()`.
  - With no `generateStaticParams`, this page is fully per-request. Put everything inside `<Suspense>`.
- [ ] **Step 3:** Run `npx tsc --noEmit && npm run lint && npm run build`. Expected: all pass.
- [ ] **Step 4:** User check:
  - create a room with a $5,000 bankroll
  - it becomes the current room with $5,000 cash
  - buy a player
  - switch to Public, where the cash is unchanged
  - the room page lists you as owner
- [ ] **Step 5:** Commit: "Add rooms list, create form and room page".

---

### Task 8: Join flow

**Files:**
- Create: `src/app/join/[code]/page.tsx`
- Modify: `src/app/rooms/actions.ts`

**Interfaces:**
- `joinRoom(code: string): Promise<FormState>` calls `join_room`, sets the `room` cookie, then redirects to `/rooms/<id>`. A database error is returned as `message`.

- [ ] **Step 1:** Implement the page with `room_preview`, inside `<Suspense>`:
  - It shows the name, owner, "{n} of {cap} members" (or "{n} members"), the starting cash and the end date.
  - States:
    - null preview: "This invite link is no longer valid. Ask the owner for a new one."
    - `ended`: "This room has ended."
    - full: "This room is full."
    - signed out: a "Sign in to join" link to `/login?next=/join/<code>`
    - already a member, meaning `getMyRooms()` contains the preview's `id`: "You're already in this room" plus a link
    - otherwise: a **Join** button
- [ ] **Step 2:** Run `npx tsc --noEmit && npm run lint && npm run build`. Expected: all pass.
- [ ] **Step 3:** Review Focus 5 smoke test, signed out:
  - `/join/<valid>` shows the preview and a sign-in link whose `href` is `/login?next=%2Fjoin%2F<code>` or the unencoded equivalent.
  - `/login?next=/join/<code>` renders the login page with that `next` in both hidden inputs.
  - `/join/garbage` shows the invalid-link message.
- [ ] **Step 4:** User check with a second account in a private window: open the invite link, sign in, join, trade, and confirm both accounts appear in the room standings.
- [ ] **Step 5:** Commit: "Add invite link join flow".

---

### Task 9: Final verification

- [ ] **Step 1:** Run `npm test && npx tsc --noEmit && npm run lint && npm run build`. Expected: all pass.
- [ ] **Step 2:** Run `npm run sync`. Expected: "Up to date" or applied nights with no errors, which confirms the nightly job works against the new `apply_real_game_night`.
- [ ] **Step 3:** Update `README.md` setup step 3 to list migrations `0001`–`0006`, and add `npm test`. Commit: "Document rooms migration and tests".
