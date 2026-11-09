# Rooms and Account Settings — Design

**Date:** 2026-11-09
**Status:** Draft for review

## Goal

Let people play Courtside Exchange with just their friends: private **rooms** joined through an invite link, each with its own fresh portfolio. Also let people change their **username** and **email**.

Success: a friend clicks your invite link, signs in, joins, and trades in your room with a separate bankroll. Standings rank only that room's members, and the room ends on a set date with frozen final standings.

## Decisions

| Topic | Decision |
|---|---|
| Room model | Each room membership is a **separate portfolio** with its own cash, holdings, trades and net-worth history. |
| Global game | Today's game becomes the **Public room**. Every user is in it automatically. |
| Market | **Shared.** One set of players and prices for all rooms. |
| Trader demand | Only **Public room** trades count toward the nightly demand price effect. This stops big-bankroll private rooms from pumping prices. |
| Room settings | Name, starting cash, member cap, end date. The owner can remove members and reset the invite link. |
| Leaving a room | Not included in this version. |
| Account settings | Change username and change email. **No passwords**: sign-in stays email link or Google. |

## 1. Data model (migration `0006_rooms.sql`)

### New tables

**`rooms`**
- `id uuid pk default gen_random_uuid()`
- `name text not null`, 1–40 characters
- `owner_id uuid null references profiles(id) on delete set null`. Null for Public.
- `invite_code text unique`. Null for Public. Random URL-safe code of at least 10 characters.
- `starting_cash numeric(12,2) not null`, from 1,000 to 1,000,000
- `member_cap int null`, from 2 to 50, null meaning no cap
- `ends_at date null` (a US-Eastern calendar date)
- `finalized_at timestamptz null`
- `is_public boolean not null default false`. At most one public room, enforced by a partial unique index.
- `created_at timestamptz not null default now()`

The Public room has a fixed, well-known UUID so the app can refer to it as a constant.

**`room_members`** (this row *is* the portfolio)
- `room_id uuid references rooms(id) on delete cascade`
- `user_id uuid references profiles(id) on delete cascade`
- `cash numeric(12,2) not null check (cash >= 0)`
- `joined_at timestamptz not null default now()`
- `final_net_worth numeric(12,2) null`
- primary key `(room_id, user_id)`

### Changed tables
- **`holdings`**: add `room_id`. The primary key becomes `(room_id, user_id, ticker)`, with a foreign key `(room_id, user_id) → room_members on delete cascade`.
- **`trades`**: add `room_id`, with the same foreign key. The index becomes `(room_id, user_id, created_at desc)`.
- **`net_worth_history`**: add `room_id`. The primary key becomes `(room_id, user_id, night)`, with the same foreign key.
- **`profiles`**: drop `cash`, since cash lives on `room_members`.

### Migrating existing data
1. Create the Public room with $10,000 starting cash.
2. Insert a `room_members` row in Public for every profile, carrying over its current `cash`.
3. Set `room_id` to Public on every existing `holdings`, `trades` and `net_worth_history` row, then make the column `not null`.
4. Drop `profiles.cash`.

### New users
`handle_new_user()` also inserts a Public membership with $10,000.

## 2. Database functions

All money and membership changes happen in `security definer` functions. The browser never writes these tables directly.

| Function | Who can call it | Behaviour |
|---|---|---|
| `execute_trade(p_room, p_ticker, p_side, p_shares)` | authenticated | Requires membership. Rejects if the room is finalized, or if `ends_at` is before today in US Eastern. Uses and updates `room_members.cash`. Changes `players.pending_demand` **only when `p_room` is Public**. The old three-argument version is dropped. |
| `create_room(p_name, p_starting_cash, p_member_cap, p_ends_at)` | authenticated | Validates the limits, and requires `ends_at` to be in the future in US Eastern. Generates the invite code and adds the creator as owner and first member. Returns `{id, invite_code}`. |
| `join_room(p_invite_code)` | authenticated | Rejects an invalid code, a finalized or past-end room, a full room, or an existing member. Inserts a membership with the room's starting cash. Returns the room id. |
| `room_preview(p_invite_code)` | anon, authenticated | Returns the name, owner's username, member count, cap, starting cash and end date, so the join page can show them before sign-in. Returns nothing for an invalid code. |
| `remove_member(p_room, p_user)` | authenticated | Owner only. Not allowed on yourself or in Public. Deletes the membership, which cascades to that room's holdings, trades and history. |
| `reset_invite(p_room)` | authenticated | Owner only, never Public. Sets a new invite code. |
| `leaderboard(p_room, p_limit)` | anon for Public; members for private rooms | Returns rank, username, net worth and `is_me`. For a finalized room, ranks by `final_net_worth`. It still never exposes holdings. |
| `room_invite(p_room)` | authenticated | Owner only. Returns the current invite code. |
| `room_roster(p_room)` | authenticated | Members only. Returns username, joined date and `is_owner` for each member, never cash. |
| `set_username(p_username)` | authenticated | Applies the existing regex (`^[a-zA-Z0-9_]{3,20}$`) and a case-insensitive uniqueness check, with friendly error messages. |

### Row-level security
- **`rooms`**: rows are readable when `is_public` or the user is a member. `select` on the `invite_code` column is revoked from `anon` and `authenticated`. The owner gets the link through `room_invite(p_room)`, an owner-only function, so members can't see or leak it.
- **`room_members`**: RLS allows **own rows only**, so other members' `cash` is never readable. Member lists come from `room_roster(p_room)`, a members-only function returning username, joined date and an `is_owner` flag. The leaderboard stays the only view of how others are doing.
- **`holdings`, `trades`, `net_worth_history`**: own rows only, as today.

## 3. Nightly sync and end dates

`apply_real_game_night(p_date, p_out)` changes in three ways:
1. **Demand** uses `pending_demand`, which now comes from Public trades only. The pricing formula is otherwise unchanged.
2. **Net-worth history** gets one row per membership, for rooms where `finalized_at is null`.
3. **Finalization:** for each room with `ends_at <= p_date` and `finalized_at is null`, it sets each member's `final_net_worth` to cash plus shares at the new prices, then sets `finalized_at = now()`.

All three happen in the same transaction as the price move. A room's last night is the first game night on or after its end date.

Trading locks when the US-Eastern date passes `ends_at`, even before the sync finalizes the room.

The sync code (`src/lib/sync.ts`, the CLI and the cron route) needs no changes.

## 4. Pages and flows

### Current room
- A room switcher in the header lists your rooms, with Public first.
- The selection is stored in a `room` cookie. The server checks membership on every read and falls back to Public.
- Switching is a Server Function that sets the cookie and refreshes the page.

### Changed pages
- **Market**: unchanged, since prices are shared.
- **Player page trade panel**: labeled "Trading in: {room}". Shows that room's cash and your shares there. In a finalized or past-end room it shows "This room has ended" with no form.
- **Portfolio**: shows the current room's cash, holdings, net-worth chart and trades.
- **Leaderboard**: shows the current room, with the room name in the heading.
- **Header cash**: shows cash in the current room.

### New pages
- **`/rooms`**: your rooms (name, your rank, net worth, end date or "Final"), plus a **Create room** form with name, starting cash, member cap and end date. Creating a room switches you into it and opens its page.
- **`/rooms/[id]`**: for members only, with others getting a not-found page. Shows standings, the member list, a **Copy invite link** button for the owner, and the end date or a "Final" badge with the winner. The owner also gets **Remove** buttons next to members, with a confirmation, and **Reset invite link**.
- **`/join/[code]`**: shows the room preview and a **Join** button.
  - Signed out: Join goes to `/login?next=/join/[code]` and comes back here.
  - Joining switches you into the room and opens `/rooms/[id]`.
  - Each failure has a clear message: invalid or reset link, full room, ended room, or "You're already in this room" with a link to it.

### Account settings: `/settings`
- **Username** uses `set_username`. On success the header and every leaderboard show the new name.
- **Email** uses `supabase.auth.updateUser({ email }, { emailRedirectTo: /auth/callback?next=/settings })`. Supabase's secure email change sends confirmation links to both the old and new addresses, and the page explains that. The address changes only after both are confirmed.
- **Sign-in methods** is read-only and shows "Email link" plus "Google" when linked.
- The header gets a **Settings** link next to Sign out.

## 5. Error handling
- All rule checks live in the database functions and raise friendly messages. Server Functions pass them through, as `trade()` does today.
- Joining checks the member cap and duplicate membership inside a transaction that locks the room row (`for update`), so two people can't both take the last spot.
- A stale `room` cookie (removed member, deleted room) silently falls back to Public.

## 6. Testing
- **PGlite suite** with Supabase stubs, extended for:
  - migrating existing users, holdings and trades into Public
  - per-room cash isolation
  - demand counting only Public trades
  - member cap under two concurrent joins
  - an invalid or reset invite code
  - owner-only actions
  - removal cascading only that room's data
  - trading locked after the end date
  - finalization on the first game night on or after `ends_at`
  - frozen final leaderboard
  - `set_username` validation
- **Supabase safeupdate:** every `UPDATE` and `DELETE` has a `WHERE` clause. This is checked by grepping the migration before you run it.
- **Build checks:** typecheck, lint and production build at each step.
- **Smoke tests** on a production server for each page: signed out, member, non-member and owner.
- **Manual checks by you:** create a room, open the invite link in a private window with a second account, join, trade in both rooms, and confirm the cash is separate.

## 7. Out of scope
- Leaving a room as a member, and transferring room ownership.
- Passwords.
- Per-room prices or per-room demand.
- Live scoreboard and the Vercel cron schedule (saved for later).
- Room chat or notifications.

## 8. Rollout
1. Migration `0006_rooms.sql` (you run it in the SQL Editor), with the tested functions.
2. The app changes ship in small commits: settings, then the room switcher and room-aware trading, portfolio and leaderboard, then the rooms pages, then the join flow.
3. **Prerequisite:** migration `0005_allow_buying_injured.sql` must be run first. `0006` replaces `execute_trade` and builds on it.
