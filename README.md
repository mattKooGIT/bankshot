# Courtside Exchange

NBA player stock exchange: players are tickers, prices move on real box scores, and
everyone paper-trades with $10,000.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Supabase keys.
3. In the Supabase SQL editor, run `supabase/migrations/0001_init.sql`, then `supabase/seed.sql`,
   then migrations `0002` through `0006` in order.
4. `npm run sync -- bootstrap` once to load this season's real players and box scores.
5. `npm run dev` → http://localhost:3000

## Daily
- `npm run sync` after the night's games are final: moves prices, records net worth, finalizes rooms
  whose end date has arrived. (`/api/cron/sync` does the same when deployed; needs `CRON_SECRET`.)

## Tests
- `npm test` runs the database tests (PGlite with Supabase stubs, `supabase/tests/`) and unit tests.
