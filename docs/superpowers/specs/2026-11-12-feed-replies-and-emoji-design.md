# Feed replies and any-emoji reactions — Design

**Date:** 2026-11-12
**Status:** Draft for review
**Builds on:** `2026-11-09-activity-feed-and-recap-design.md` (migration `0011`)

## Goal

Make the room feed more conversational:
- **Any emoji:** react with any emoji, from one emoji button that opens a full menu.
- **Replies:** reply to any feed item in text.

## Decisions

| Topic | Decision |
|---|---|
| Quick reactions | **Removed.** Posts show only the emojis people have used, plus one ☺+ button. |
| Emoji menu | The ☺+ button opens the Frimousse picker (`frimousse@0.4.0`), with search and categories. A "Popular" row above it holds 🔥 😂 💀 📉. The menu stays open, so you can pick several emojis in a row. |
| Repeat taps | One per person per emoji: tapping an emoji you already used removes it, the same as now. |
| What counts as one emoji | Any single emoji grapheme, including ZWJ sequences and skin tones. Rejected: letters, digits, whitespace, more than 32 characters. Validated in the database. |
| Reaction cap | At most 50 distinct emojis per user per event. This is an anti-spam backstop that real use never reaches. |
| Thread depth | One level. Replying to a reply attaches to the top-level item and prefills "@username ". |
| Reply rules | Same as comments: 1–280 characters. Comments and replies share the 5-per-60-seconds budget. Replies are permanent. |
| Reactions on replies | Allowed. |

## 1. Data: migration `0012_feed_replies_emoji.sql`

### Schema
- `room_events.parent_id bigint references room_events(id) on delete cascade` (nullable).
- A new index on `(parent_id, id)`.
- `kind` gains the value `'reply'`. Replies are `kind = 'reply'` with a non-null `parent_id`.
- A check that `parent_id` is null for every kind except `reply`, and not null for `reply`.
- Drop the four-emoji check on `room_event_reactions.emoji` and replace it with `is_single_emoji(emoji)`.

### `is_single_emoji(t text) returns boolean`
An immutable function. It returns true only when all of these hold:
- `char_length(t)` is between 1 and 32
- `t !~ '[[:alnum:][:space:][:punct:]]'`
- `t` contains at least one character at code point U+00A9 or higher
- `t` is exactly one grapheme

**Approximating "one grapheme":** with ZWJ (U+200D), variation selectors (U+FE0E–FE0F) and skin tones (U+1F3FB–1F3FF) removed, and keycap or tag characters ignored, at most 2 code points remain. Two remain only when both are regional indicators, i.e. a flag.

Tests pin which inputs pass and fail; the exact SQL is the implementer's choice.

### `toggle_reaction(p_event, p_emoji)`
- The emoji check becomes `is_single_emoji(p_emoji)`. The error stays "Not a supported emoji."
- Adding a reaction when the caller already has 50 distinct emojis on that event raises "That's enough reactions for one post."

### `post_reply(p_event bigint, p_text text) returns bigint`
- Security definer.
- If the target is a reply, the new reply attaches to the target's `parent_id` instead.
- Caller must be a member of the target's room ("You are not in this room.").
- Text is 1–280 characters ("Replies are 1–280 characters.").
- The shared rate limit counts `kind in ('comment','reply')` ("Slow down — try again in a minute.").
- Inserts `kind = 'reply'` with payload `{ text }` and returns the new ID.
- Granted to `authenticated` only.

### `post_comment`
Its rate-limit count also includes replies.

### `room_feed`
- Returns only top-level events (`parent_id is null`).
- Each row gains:
  - `reply_count int`
  - `replies jsonb`: the latest 3 replies, oldest first. Each reply is `{ id, actor, text, created_at, reactions, mine }`.

### `event_replies(p_event bigint) returns table (...)`
- Returns all replies to a top-level event, oldest first, with each reply's reactions and the caller's own.
- Members only; non-members get 0 rows.
- Used by "View all N replies".

## 2. UI (`Activity.tsx`)

Each event row shows:
- a chip for each emoji anyone has used, with its count. The viewer's own reactions are highlighted, and tapping a chip toggles the viewer's reaction.
- a ☺+ button. It's present even when nobody has reacted yet.

**☺+ button:** opens a popover with the "Popular" row (🔥 😂 💀 📉) above a Frimousse picker with search. Picking an emoji toggles it and leaves the popover open; emojis the viewer has already used are highlighted in the Popular row. The popover closes on Escape or an outside click, and the chip is keyboard-reachable.

**"Reply" link:** on every top-level event and every reply. It opens an inline text box under the thread. When replying to a reply, the box is prefilled with "@username ".

**Replies:**
- Shown indented under the event, each with the author, text, relative time, and reaction chips. Reply rows get the same chips and ☺+ button.
- "View all N replies" appears when there are more than 3, and loads `event_replies`.
- Errors show under the reply box, in the same style as comment errors.
- After posting, the thread refreshes. The 30-second polling still applies.

**Server actions** in `feed-actions.ts`: `postReply(eventId, text)` and `loadReplies(eventId)`.

**Formatting:** `feed.ts` gains `sortReactions(reactions)`. It orders emojis by count, highest first, with ties broken by emoji. It's unit-tested.

## 3. Demo (with `2026-11-12-demo-guest-design.md`)

`seed_demo` also adds:
- a reply from `sixth_man` to the "fade_master you're cooked" comment: "@fade_master check the standings first"
- reactions spread across events, including 🐐 and 🧊

## 4. Testing

### Database (PGlite), written first
- **`is_single_emoji` accepts:** 🔥, 🐐, 👍🏽, 👨‍👩‍👧, 🇺🇸, ❤️, #️⃣
- **`is_single_emoji` rejects:** '', 'lol', 'a', '🔥🔥', '🔥a', ' 🔥', '😂😂😂', '!'
- **Reaction cap:** the 51st distinct emoji raises the cap error.
- **Replies attach to the top-level event:** a reply to a reply has the top-level event as its `parent_id`.
- **Rate limit:** 3 comments then 2 replies within 60 seconds is fine; the 6th raises the limit error.
- **Non-members** can't reply, and get 0 rows from `event_replies`.
- **`room_feed`** excludes replies from the top level, returns `reply_count` and the latest 3 in order.
- **Deletion:** deleting a room, or a parent event, removes its replies and their reactions.

### Unit and smoke tests
- **Unit:** `sortReactions`.
- **Smoke (the demo's Playwright run):**
  - add 🐐 via the picker
  - reply to a comment
  - the reply appears under it
  - take a screenshot

## 5. Out of scope

- nested threads deeper than one level
- @mention notifications
- editing or deleting replies
- custom or uploaded emojis
