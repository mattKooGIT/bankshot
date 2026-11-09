# Room Activity Feed and Nightly Recap — Design

**Date:** 2026-11-09
**Status:** Draft for review

## Goal

Make rooms feel social and bring people back every day:
- **Activity feed:** a per-room feed of trades, joins and leaves, and nightly results, with reactions and comments.
- **Nightly recap:** a short in-app summary of how you did last night.

## Decisions

| Topic | Decision |
|---|---|
| Feed scope | **Private rooms only.** Nothing is posted for the Public room. |
| Event source | A `room_events` table, filled by database triggers (trades, joins, leaves), by `post_comment()`, and by `post_night_results(n)`, which the nightly sync calls after each night. |
| Reactions | 🔥 😂 💀 📉, toggled per user per event. |
| Comments | 1–280 characters, at most 5 per minute per user per room. |
| Recap delivery | In-app only for now: a dismissible banner, plus a `/recap` page. Email is out of scope. |
| Privacy | Room members see each other's trades (shares and price). The room page says so. |
| Preview | The feed can be tried live. The recap and night posts get a **development-only** page, `/dev/recap-preview`, with made-up data, because a real night can't be faked without moving real prices. |

## 1. Data: migration `0011_feed_and_recap.sql`

**Tables:**
- **`room_events`:**
  - `id bigint identity primary key`
  - `room_id uuid not null references rooms on delete cascade`
  - `actor_id uuid references profiles on delete set null`
  - `kind text check (kind in ('trade','join','leave','night','comment'))`
  - `payload jsonb not null`
  - `created_at timestamptz default now()`
  - index `(room_id, id desc)`
- **`room_event_reactions`:** `event_id bigint references room_events on delete cascade`, `user_id uuid references profiles on delete cascade`, `emoji text check (emoji in ('🔥','😂','💀','📉'))`, primary key `(event_id, user_id, emoji)`.
- **RLS** is on, with **no** select policies. All reads go through the functions below.

**Triggers** (security definer; skip the Public room; skip when the room no longer exists, e.g. during a room-delete cascade):
- **After insert on `trades`:** kind `trade`, payload `{ side, ticker, shares, price }`.
- **After insert on `room_members`:** kind `join`. Not posted for the room creator's own membership row.
- **After delete on `room_members`:** kind `leave`. Not posted if the room is being deleted.

**Functions** (security definer, `search_path = public`):
- `post_comment(p_room uuid, p_text text) returns bigint`:
  - members only
  - text trimmed to 1–280 characters
  - at most 5 comments per user per room in the trailing 60 seconds
  - errors: "Comments are 1–280 characters.", "Slow down — try again in a minute.", "You are not in this room."
- `toggle_reaction(p_event bigint, p_emoji text) returns boolean`: members of the event's room only. Returns true when the reaction is now on.
- `room_feed(p_room uuid, p_before bigint default null, p_limit int default 30) returns table (id, kind, actor, payload, created_at, reactions jsonb, mine text[])`:
  - members only
  - newest first; `p_before` is used for paging; limit capped at 100
  - `actor` is the username; hidden users' names are still shown inside rooms they belong to
  - `reactions` is a map from emoji to count; `mine` lists the emojis the caller has reacted with
- `post_night_results(p_night int) returns int`:
  - for each private room not yet finalized that has `net_worth_history` for `p_night`, inserts one `night` event, unless one already exists for that night (safe to re-run)
  - payload: `{ night, date, standings: [{ username, net_worth, change_pct, rank, prev_rank }] }` for all members, sorted by rank
  - `change_pct` compares with the previous night's history; when there isn't one, it compares with `starting_cash`
  - returns the number of events posted
  - service-role only
- `my_recap() returns json`:
  - for the caller's **latest night that has history**, one entry per membership (Public included): `{ room_id, room_name, is_public, net_worth, change_pct, rank, prev_rank, size }`
  - also `best` and `worst`: the caller's holdings in their current room, ranked by `players.last_move.total` with that night's line
  - `null` if the caller has no history yet
  - ranks are computed among the room's non-hidden members, plus the caller

**Sync:** after each successful `apply_real_game_night` and `list_rotation_players`, `syncNights()` calls `post_night_results(night)`. A failure there is logged as a warning and never blocks prices.

## 2. UI

**Room page** (`/rooms/[id]`), new **Activity** section above Members:
- **Comment box:** a textarea with a Post button and the error message under it.
- **Event rows:**
  - **Trade:** "**matt** bought 40 SGA at $55.24"
  - **Join / leave:** "**jalen** joined" or "**jalen** left"
  - **Night:** a results card ("Night 3 · Nov 10"), showing the top 3 with change and ▲/▼ rank movement plus your own row
  - **Comment:** the username and the text
- **Each row** shows a relative time ("5m ago") and reaction chips with counts. Your own reactions are highlighted.
- **Refresh:** every 30 s while the tab is visible, plus right after you post or react.
- **Older items:** a "Show older" button.
- **Note** under the heading: "Room members can see each other's trades."

**Recap banner** (in the site header area, signed in only):
- Shown when `my_recap()` has a night you haven't dismissed. Dismissed nights are remembered per browser.
- Text: "Last night: {+4.2%} · #2 in {room} ({▲1}) · Best: {SGA +9.1%}", using your current room, plus a "See recap" link and a dismiss ×.

**`/recap` page:**
- One block per room: change, rank, rank movement, size.
- Your best and worst players with their stat lines.
- Each private room's top 3 from its night event.
- Empty state: "Your first recap appears after the next game night."

**Development preview:** `/dev/recap-preview` renders the banner, a recap page and a night-results card from fixed fixture data. It **returns 404 unless `NODE_ENV !== "production"` or `ENABLE_DEV_PREVIEW=1`**.

## 3. Testing

- **Database (PGlite), written first:**
  - each trigger posts the right event
  - nothing is posted for the Public room
  - deleting a room leaves no events or errors
  - `room_feed` is members-only and paged; reactions toggle and are counted
  - comment length and rate limit
  - `post_night_results` is idempotent, handles change and rank with and without a previous night, and skips finalized rooms
  - `my_recap` is null before any night and correct after two nights
- **Unit tests:** `relativeTime`, `formatEvent` (the text for each kind), and `rankMove` (▲/▼/–).
- **Smoke tests:** the feed renders on a room page; the dev preview returns 200 locally and 404 without the flag in production.
- **Screenshots** of the feed and the preview.

## 4. Out of scope

Email or push notifications, Public-room feed, @mentions, editing or deleting comments (comments are permanent), and moderation tools.
