-- Readable tickers.
-- Old rule: first 6 letters of the last name, numbered on collision (GREEN1..GREEN5,
-- and Zion Williamson became WILLI1 because WILLIAMSON and WILLIAMS share 6 letters).
-- New rule (max 10 letters), first one that's unique wins:
--   1. last name                                  SENGUN, WILLIAMSON, HALIBURTON
--   2. first initial + last name                  DGREEN, JWILLIAMS, KMURRAY
--   3. first 3 letters of first name + last name  JALGREEN, JAVGREEN, DAVMITCHEL
--   4. numbered, as a last resort
-- Uniqueness is judged on full names across every listed player, so a later
-- arrival never takes a plain name that an existing player also has.
-- Hand-picked tickers (seed.sql) never change.

-- ───────────────── Let ticker renames cascade to referencing rows ─────────────────

alter table public.price_history drop constraint price_history_ticker_fkey,
  add constraint price_history_ticker_fkey foreign key (ticker)
    references public.players(ticker) on update cascade on delete cascade;
alter table public.holdings drop constraint holdings_ticker_fkey,
  add constraint holdings_ticker_fkey foreign key (ticker)
    references public.players(ticker) on update cascade;
alter table public.trades drop constraint trades_ticker_fkey,
  add constraint trades_ticker_fkey foreign key (ticker)
    references public.players(ticker) on update cascade;

-- ───────────────── Name helpers ─────────────────

-- "Derrick Jones Jr." → JONES, "Collin Murray-Boyles" → MURRAYBOYLES, "Nikola Jokić" → JOKIC
create or replace function public.ticker_last(p_name text)
returns text language sql immutable set search_path = public as $$
  select upper(regexp_replace(unaccent_basic(
           regexp_replace(
             regexp_replace(trim(p_name), '[\s,]+(jr\.?|sr\.?|ii|iii|iv|v)$', '', 'i'),
             '^.*\s', '')),
         '[^A-Za-z]', '', 'g'))
$$;

-- First p_len letters of the first name: ("Jalen Green", 3) → JAL
create or replace function public.ticker_first(p_name text, p_len int default 1)
returns text language sql immutable set search_path = public as $$
  select upper(left(regexp_replace(unaccent_basic(split_part(trim(p_name), ' ', 1)), '[^A-Za-z]', '', 'g'), p_len))
$$;

-- Pick a ticker for each row of `pool` with is_candidate = true. `pool` holds every
-- player whose name should count toward collisions; `taken` are tickers to avoid.
create or replace function public.pick_tickers(p_pool jsonb, p_taken text[])
returns table (key text, ticker text) language sql stable set search_path = public as $$
  with pool as (
    select e->>'key' as key, e->>'name' as name, (e->>'candidate')::boolean as candidate,
           ticker_last(e->>'name') as l,
           ticker_first(e->>'name', 1) || ticker_last(e->>'name') as f1l,
           ticker_first(e->>'name', 3) || ticker_last(e->>'name') as f3l
    from jsonb_array_elements(p_pool) e
  ), counted as (
    select *, count(*) over (partition by l) as n_l, count(*) over (partition by f1l) as n_f1,
              count(*) over (partition by f3l) as n_f3
    from pool
  ), chosen as (
    select key, f3l,
      case when n_l  = 1 and not (left(l,   10) = any(p_taken)) then left(l,   10)
           when n_f1 = 1 and not (left(f1l, 10) = any(p_taken)) then left(f1l, 10)
           when n_f3 = 1 and not (left(f3l, 10) = any(p_taken)) then left(f3l, 10)
      end as t
    from counted where candidate
  ), numbered as (
    select key, coalesce(t, left(f3l, 9) || row_number() over (partition by t is null, f3l order by key)) as t
    from chosen
  )
  -- truncation can still make two tickers equal; number those too
  select key, case when count(*) over (partition by t) > 1
                   then left(t, 9) || row_number() over (partition by t order by key) else t end
  from numbered
$$;

-- ───────────────── One-time rename of auto-listed tickers ─────────────────

do $$
declare
  seed text[] := array['SGA','JOKIC','GIA','LUKA','WEMBY','JT','ANT','JB','LBJ','STEPH','KD',
    'CADE','PAOLO','MITCH','BOOK','FLAGG','EMBIID','AD','JA','FOX','TRAE','KAT','KAWHI',
    'JDUB','MELO','BAM','SABO'];
begin
  create temp table ticker_map on commit drop as
  select t.key as old, t.ticker as new
  from pick_tickers(
    (select jsonb_agg(jsonb_build_object('key', ticker, 'name', name, 'candidate', not (ticker = any(seed))))
     from players),
    seed) t;

  -- two passes so no rename collides with a ticker that's about to be renamed
  update players p set ticker = '~' || p.ticker from ticker_map m where p.ticker = m.old and m.new <> m.old;
  update players p set ticker = m.new from ticker_map m where p.ticker = '~' || m.old;
end $$;

-- ───────────────── Same rule for players listed from now on ─────────────────

create or replace function public.list_rotation_players(p_min_games int default 3, p_min_minutes numeric default 18)
returns int language plpgsql security definer set search_path = public as $$
declare
  added int;
begin
  drop table if exists pg_temp.rotation_cand;
  create temp table rotation_cand on commit drop as
  with s as (
    select distinct on (espn_id) espn_id, name, team, position
    from player_game_stats order by espn_id, game_date desc
  ), a as (
    select espn_id, count(*) gp, avg(min) min,
           avg(pts) pts, avg(reb) reb, avg(ast) ast, avg(stl) stl, avg(blk) blk, avg(tov) tov
    from player_game_stats where min > 0 group by espn_id
  )
  select s.*, a.gp, a.min, a.pts, a.reb, a.ast, a.stl, a.blk, a.tov
  from s join a using (espn_id)
  where a.gp >= p_min_games and a.min >= p_min_minutes
    and not exists (select 1 from players p where p.espn_id = s.espn_id);

  insert into players (ticker, name, position, team, espn_id, games_played, avg_min,
                       avg_pts, avg_reb, avg_ast, avg_stl, avg_blk, avg_tov, price)
  select t.ticker, c.name, c.position, c.team, c.espn_id, c.gp, round(c.min,1),
    round(c.pts,1), round(c.reb,1), round(c.ast,1), round(c.stl,1), round(c.blk,1), round(c.tov,1),
    greatest(3, round(1.2 * (c.pts + 1.2*c.reb + 1.5*c.ast + 3*c.stl + 3*c.blk - c.tov), 2))
  from rotation_cand c
  join pick_tickers(
    (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
       select jsonb_build_object('key', espn_id, 'name', name, 'candidate', true) x from rotation_cand
       union all
       select jsonb_build_object('key', '~' || ticker, 'name', name, 'candidate', false) from players) u),
    (select coalesce(array_agg(ticker), '{}') from players)) t on t.key = c.espn_id;
  get diagnostics added = row_count;

  insert into price_history (ticker, night, price)
    select ticker, current_night(), price from players
    on conflict (ticker, night) do nothing;

  return added;
end $$;

revoke all on function public.list_rotation_players(int, numeric) from public, anon, authenticated;
revoke all on function public.pick_tickers(jsonb, text[]) from public, anon, authenticated;
