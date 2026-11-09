# Courtside Exchange

NBA player stock exchange: players are tickers, prices move on real box scores, and
everyone paper-trades with $10,000.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Supabase keys.
3. Run the SQL in `supabase/` (0001_init.sql, seed.sql, 0002_real_data.sql) in the Supabase SQL editor.
4. `npm run dev` → http://localhost:3000
