# Analyst notes on player pages — Design

**Date:** 2026-11-19
**Status:** Draft for review

## Goal

Explain *why* a player's production is changing, like a short analyst note.

> "Isaiah Hartenstein is producing more because Chet Holmgren is out, so he could be a good stream."

The note is built from real box scores. It suggests; it doesn't tell anyone to buy or sell.

## Decisions

| Topic | Decision |
|---|---|
| Where | Player page only: an "Analyst note" box under the injury report. It appears only when a signal fires. |
| Writing | Sentence templates filled with real numbers. No AI. |
| Tone | A descriptive tag plus suggestive wording ("could", "may", "worth watching"). Never "buy", "sell", "hold", or any rating. |
| Footer | "Based on box scores. Not a recommendation." |
| Data | Read-only. There are no schema changes. The page loads this season's box scores for the player's current team. The loaders use `"use cache"` with tag `market`, so notes refresh with the nightly sync. |

## 1. Inputs

**`getTeamGames(team: string)`** in `src/lib/analyst.ts` (server):
- It reads every `player_game_stats` row for that team this season (regular season and playoffs, as stored).
- It returns `{ game_id, game_date, espn_id, min, fp }[]`.
- `fp` is `pts + 1.2·reb + 1.5·ast + 3·stl + 3·blk − tov`. This is the same formula as `expected_fp`.

**Teammates** are players with `team` equal to this player's team and `active`, taken from the existing `getMarket()` data:
- `espn_id`, `name`, `avg_min`, `out_nights`, `injury_note`

**This player:**
- `espn_id`, `name`, `out_nights`, `injury_note`
- the last 6 prices from `getPriceHistory` (for the 5-night change)

A game counts as a team game if any row exists for that team and `game_id`. A player "played" a team game if he has a row with `min > 0`. Only games with his *current* team count, so a mid-season trade starts fresh.

## 2. Signals (pure: `analystNote(input) → Note | null`)

Each signal yields `{ tag, text, strength }`. The note shows the **strongest two**, strongest first, under the first signal's tag. If no signal fires, `null` is returned and no box is shown.

**Key teammate:** another player on the team with `avg_min ≥ 24`.

**With/without split for a key teammate T:** the player's average FP in team games he played where T did not play, against team games where both played. The split is valid only when there are at least 3 "without" games, at least 2 "with" games, and the difference is at least +15% and at least +3.0 FP.

1. **Bigger role** (strength = the split's % gain). Fires when T is out now (`out_nights > 0`) and the split is valid. If several key teammates qualify, the largest split wins.
   > "{Player} is averaging {without} FP in the {n} games {T} has missed, vs {with} with him ({+x%}). With {T} out, that larger role could stick around."
2. **Role may shrink** (strength = the split's % gain × 0.9). Fires when T is *not* out now, played the team's most recent game, missed at least 3 of the 5 team games before that, and the split is valid.
   > "{T} is back as of {Mon D}. {Player}'s numbers ran {x%} higher without him, so they may cool off from here."
3. **Sidelined** (strength = 1000, always first). Fires when the player is out now (`out_nights > 0`).
   > "{Player} is out: {note text after "Out: ", trimmed to 160 characters with "…"}. Worth watching for a return date."
4. **Heating up / Cooling off** (strength = the size of the % change). The player has at least 8 games played. The last-5 FP average differs from the season average by at least 20%, and the last-5 minutes differ from the season minutes average by at least 10% in the same direction.
   > Heating up: "Playing {m5} minutes a night over his last 5 games (up from {mSeason}), averaging {f5} FP vs {fSeason} on the season. Worth watching."
   > Cooling off: the same, with "down from" and "May be worth keeping an eye on." in place of "Worth watching."

**Market line** (appended when signal 1 or 4-up fires): if the price rose by at least 15% over the last 5 nights, add "The market has partly noticed: price up {x%} in 5 nights." If it fell by at least 15% after signal 2 or 4-down, add "Price already down {x%} in 5 nights."

**Numbers:** FP to one decimal place, percentages as whole numbers with a sign, minutes to one decimal place.

## 3. UI

`AnalystNote` (a server component) on `/players/[ticker]`, after `InjuryReport`. It's a bordered box containing:
- the heading "Analyst note"
- the tag as a small chip
- one or two paragraphs
- the footer line

Tag colours:
- **Bigger role** and **Heating up:** emerald
- **Role may shrink** and **Cooling off:** amber
- **Sidelined:** red

## 4. Testing

### Unit (`src/lib/analyst.test.ts`), with fixture box scores
Each signal fires with the exact text. The fixture for signal 1 uses Hartenstein/Holmgren-like numbers.

Each signal stays silent:
- when the sample is too small (2 "without" games)
- when the gain is too small (+10% or +2 FP)
- when the teammate isn't a key player (`avg_min` 20)

Also covered:
- **Trade:** a player traded mid-season only counts games with his current team.
- **Ordering:** Sidelined comes before a split.
- **Limit:** at most 2 signals.
- **Market line:** it appears at +15% and is absent at +14%.
- **No signal:** returns `null`.
- **Wording:** no output text contains "buy", "sell" or "hold", in any case.

### Smoke
`/players/HARTENSTEI` on the 3001 preview renders the box. A screenshot is taken.

## 5. Out of scope

- a Pickups list page
- AI-written text
- opponent or schedule-based notes
- storing notes in the database
