# "Try the demo" guest sign-in — Design

**Date:** 2026-11-12
**Status:** Draft for review

## Goal

Bankshot is a portfolio piece. A visitor (often a recruiter) should go from the link to the full experience in about 10 seconds, with no email and no Google:
- a portfolio with holdings
- a private league with rivals
- an activity feed with trades, comments and a nightly-results card
- a recap

## Decisions

| Topic | Decision |
|---|---|
| Account type | **Each visitor gets their own sandbox**: a Supabase anonymous user, marked `hidden`. |
| Rivals | 3 permanent bot accounts, `bucket_getter`, `fade_master` and `sixth_man`, all hidden. They're reused in every guest's room. |
| Building the sandbox | One service-role SQL function, `seed_demo(p_guest uuid)`. It's atomic and covered by PGlite tests. |
| Price safety | Trades by hidden accounts never add to `pending_demand`. This applies in every room, including Public. |
| Lifetime | Guests are deleted 24 hours after they sign up, by the nightly sync. Bots and real users are never deleted. |
| Upgrading a guest to a real account | Out of scope. |

## 1. Data: migration `0013_demo_guest.sql`

### Demand guard
- Redefine the trade function from `0006`, changing only the two `pending_demand` updates. They now apply only when the trader's profile is not `hidden`.
- Everything else stays exactly as it is.

### `seed_demo(p_guest uuid) returns uuid`
Returns the new room's ID. It's service-role only: revoked from `public`, `anon` and `authenticated`.

**Checks:**
- Raises `'Not a guest.'` unless `p_guest` is an anonymous user (`auth.users.is_anonymous`).
- Raises `'Demo bots are missing.'` if any of the 3 bot profiles doesn't exist.
- Idempotent: if the guest already owns a room named `Demo League`, it returns that room's ID and changes nothing.

**What it creates:**
- **The guest's profile** becomes `hidden = true`, with username `guest_` plus 4 random digits (still unique).
- **The room:** a private room named `Demo League`, owned by the guest, with $10,000 starting cash and no end date.
- **Members:** the guest and the 3 bots.
- **History nights:** let N be `current_night()`, and use up to the last 3 nights that have prices (N−2 to N).
- **Holdings:** each member buys 4 players at the price from `price_history` on the first history night.
  - Each member spends between $8,000 and $9,500, and the rest stays as cash.
  - The players come from the current top 30 active players by price, chosen by a fixed rule per member, so tests are deterministic:
    - **guest:** ranks 1, 5, 9 and 13
    - **bucket_getter** (stars): ranks 2, 3, 4 and 6
    - **fade_master** (value): ranks 21 to 24
    - **sixth_man** (balanced): ranks 7, 12, 17 and 22
  - Shares are rounded down to whole shares. A member's cash is $10,000 minus what they spent.
- **Trades:** one buy per holding, timestamped at that night's date. The feed's trade trigger posts these events. Their `created_at` is set to match the trade's timestamp, not the time of seeding.
- **`net_worth_history`:** for every member, on each history night: cash plus shares × that night's price.
- **Comments:** 3 `comment` events from the bots, timestamped across the last day:
  - "welcome to the league 👋"
  - "fade_master you're cooked"
  - "buy low, cry later"
- **A `night` event** for night N. It's produced by the same logic as `post_night_results`, but only for this room. Bots and the guest are included in the standings, even though they're hidden.

**Edge case:** if no night has prices yet (`current_night() = 0`), skip the history, the night event and the back-dated trades. Holdings are then bought at the current `players.price`.

### `delete_stale_guests() returns int`
- Service-role only.
- Deletes rooms owned by anonymous users created more than 24 hours ago, then deletes those `auth.users` rows. The rest cascades.
- Never touches non-anonymous users. Bots are not anonymous.
- Returns how many guests were deleted.

## 2. Server

**`ensureDemoBots()`** in `src/lib/demo.ts`, using the service-role client:
- Creates the 3 bot users if they're missing, with emails like `bucket_getter@bankshot.invalid` and the email marked as confirmed.
- Sets their username and `hidden = true`.
- It's idempotent and cached per server process once it succeeds.

**Server action `startDemo()`** in `src/app/demo/actions.ts`:
1. Calls `signInAnonymously()` with the cookie-based server client.
2. Calls `ensureDemoBots()`.
3. Calls `seed_demo(user.id)` through the service-role client.
4. Sets the `room` cookie to the new room and redirects to `/rooms/<id>`.

**On failure:**
- The visitor is sent to `/login?error=demo` with the message "The demo couldn't start. Try again in a minute."
- If the sign-in worked but the seeding failed, they're signed out first.

**Sync:** `syncNights()` calls `delete_stale_guests()` once per run, after the nights. A failure there is a warning only and never blocks prices.

## 3. UI

**Demo button:** labelled "Try the demo — no sign-up", in two places:
- **Landing hero:** a secondary button next to the existing actions.
- **`/login`:** a full-width button under the sign-in options.

It's a form that posts to `startDemo`. While the sandbox is building, it shows "Setting up your demo…".

**Guest bar:** for anonymous users only, a slim bar under the header reading "You're in a demo account. It resets in 24 hours." It has a **Sign up** link, which signs the guest out and goes to `/login`.

**Settings:** for an anonymous user, the email section reads "Demo accounts have no email." and changing the username is allowed.

**Manual step (owner):** in Supabase, open **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**.

## 4. Testing

### Database (PGlite), written first
The harness stub gets an `auth.users.is_anonymous` column.
- **`seed_demo`:**
  - the room exists, its owner is the guest, and it has 4 members
  - each member has 4 holdings and the right cash
  - history exists for each history night
  - one night event and 3 comments
  - every trade event has a back-dated `created_at`
- **Seeding twice** returns the same room and adds nothing.
- **A non-anonymous user** is rejected with `'Not a guest.'`.
- **Missing bots** raise `'Demo bots are missing.'`.
- **With no nights** the seed still works.
- **Demand:** a hidden user's Public buy leaves `pending_demand` unchanged, while a normal user's buy still changes it.
- **`delete_stale_guests`:**
  - deletes a 25-hour-old guest along with their room
  - keeps a 1-hour-old guest, the bots and real users

### Unit and smoke tests
- **Unit:** the guest-bar visibility helper.
- **Smoke, against the 3001 preview:** a Playwright run clicks "Try the demo" and lands on the Demo League. Checks:
  - the feed shows the night card and comments
  - the portfolio shows 4 holdings
  - screenshots are taken

## 5. Out of scope

- turning a guest into a real account
- CAPTCHA (Supabase's built-in limit on anonymous sign-ins per IP is enough)
- a separate demo for the Public room
