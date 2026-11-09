-- Courtside Exchange: real NBA data
-- Players, games, and box scores come from ESPN's public JSON (synced by the app's
-- server-side job using the service-role key). Pricing logic is the same as
-- play_game_night(); only the box-score source changes from simulated to real.
--
-- One "game night" = one calendar date of NBA games (US Eastern).

-- ───────────────────────── Players: real-world identity ─────────────────────────

alter table public.players
  add column espn_id      text unique,
  add column team         text,
  add column headshot_url text,
  add column games_played int     not null default 0,
  add column avg_min      numeric not null default 0,
  add column injury_note  text;

-- ───────────────────────── Games & box scores ─────────────────────────

alter table public.game_nights add column game_date date unique;

create table public.games (
  espn_id     text primary key,
  game_date   date not null,
  start_time  timestamptz not null,
  status      text not null,            -- ESPN status, e.g. STATUS_SCHEDULED / STATUS_FINAL
  home_team   text not null,
  away_team   text not null,
  home_score  int,
  away_score  int
);
create index games_date_idx on public.games(game_date);

-- Every real stat line we've ingested for any player (listed or not), so season
-- averages can be computed here and new players can be listed with real history.
create table public.player_game_stats (
  game_id   text not null references public.games(espn_id) on delete cascade,
  espn_id   text not null,                -- ESPN athlete id
  name      text not null,
  team      text not null,
  position  text not null check (position in ('G','F','C')),
  game_date date not null,
  min int not null, pts int not null, reb int not null, ast int not null,
  stl int not null, blk int not null, tov int not null,
  fp numeric generated always as (pts + 1.2*reb + 1.5*ast + 3*stl + 3*blk - tov) stored,
  primary key (game_id, espn_id)
);
create index pgs_player_idx on public.player_game_stats(espn_id, game_date desc);

alter table public.games             enable row level security;
alter table public.player_game_stats enable row level security;
create policy "games are public"      on public.games             for select using (true);
create policy "box scores are public" on public.player_game_stats for select using (true);

-- ───────────────────────── Season averages ─────────────────────────
-- Recompute avg_* / games_played / avg_min for listed players from real box scores.

create or replace function public.refresh_player_averages()
returns void language sql security definer set search_path = public as $$
  update players p set
    avg_pts = s.pts, avg_reb = s.reb, avg_ast = s.ast,
    avg_stl = s.stl, avg_blk = s.blk, avg_tov = s.tov,
    avg_min = s.min, games_played = s.gp
  from (
    select espn_id, count(*) gp,
           round(avg(min),1) min, round(avg(pts),1) pts, round(avg(reb),1) reb,
           round(avg(ast),1) ast, round(avg(stl),1) stl, round(avg(blk),1) blk,
           round(avg(tov),1) tov
    from player_game_stats where min > 0 group by espn_id
  ) s
  where p.espn_id = s.espn_id;
$$;

-- ───────────────────────── Listing new players ─────────────────────────
-- Lists every unlisted player who meets the rotation bar, priced at 1.2 × expected FP.
-- Players are never auto-delisted: execute_trade requires `active`, so delisting
-- would trap holders.

create or replace function public.list_rotation_players(p_min_games int default 3, p_min_minutes numeric default 18)
returns int language plpgsql security definer set search_path = public as $$
declare
  added int;
begin
  with s as (
    select distinct on (espn_id) espn_id, name, team, position
    from player_game_stats order by espn_id, game_date desc
  ), a as (
    select espn_id, count(*) gp, avg(min) min,
           avg(pts) pts, avg(reb) reb, avg(ast) ast, avg(stl) stl, avg(blk) blk, avg(tov) tov
    from player_game_stats where min > 0 group by espn_id
  ), cand as (
    select s.*, a.gp, a.min, a.pts, a.reb, a.ast, a.stl, a.blk, a.tov,
           -- ticker: last name, letters only, uppercased, max 6 chars
           left(upper(regexp_replace(
             regexp_replace(s.name, '\s+(Jr\.?|Sr\.?|II|III|IV)$', '', 'i'),
             '^.*\s', '')), 6) as base
    from s join a using (espn_id)
    where a.gp >= p_min_games and a.min >= p_min_minutes
      and not exists (select 1 from players p where p.espn_id = s.espn_id)
  )
  insert into players (ticker, name, position, team, espn_id, games_played, avg_min,
                       avg_pts, avg_reb, avg_ast, avg_stl, avg_blk, avg_tov, price)
  select
    -- disambiguate ticker collisions with a numeric suffix
    case when exists (select 1 from players p where p.ticker = c.tk)
           or count(*) over (partition by c.tk) > 1
         then left(c.tk, 5) || (row_number() over (partition by c.tk order by c.min desc)
              + (select count(*) from players p where p.ticker like left(c.tk, 5) || '%'))
         else c.tk end,
    c.name, c.position, c.team, c.espn_id, c.gp, round(c.min,1),
    round(c.pts,1), round(c.reb,1), round(c.ast,1), round(c.stl,1), round(c.blk,1), round(c.tov,1),
    greatest(3, round(1.2 * (c.pts + 1.2*c.reb + 1.5*c.ast + 3*c.stl + 3*c.blk - c.tov), 2))
  from (select cand.*, regexp_replace(translate(base,
          'ÁÀÂÄÃÅĆČÇĐÉÈÊËĚÍÌÎÏŁŃŇÑÓÒÔÖÕØŘŠŚŤÚÙÛÜŮÝŽŹŻ',
          'AAAAAACCCDEEEEEIIIILNNNOOOOOORSSTUUUUUYZZZ'), '[^A-Z]', '', 'g') as tk
        from cand) c;
  get diagnostics added = row_count;

  insert into price_history (ticker, night, price)
    select ticker, current_night(), price from players
    on conflict (ticker, night) do nothing;

  return added;
end $$;

-- ───────────────────────── Real game night ─────────────────────────
-- p_date:  the calendar date whose games are all final
-- p_out:   ESPN athlete ids currently listed as "Out" on the injury report
-- Box scores for p_date must already be in player_game_stats.
--
-- Status per listed player:
--   played  – has a line with min > 0 → perf from real FP vs. pre-game expectation
--   injured – on the Out list (new injury: -8%, continuing: -1%; buying blocked)
--   rest    – team played but he didn't (DNP)
--   idle    – his team had no game; only gap/demand/noise apply

create or replace function public.apply_real_game_night(p_date date, p_out text[] default '{}')
returns int language plpgsql security definer set search_path = public as $$
declare
  n      int;
  p      players;
  st     player_game_stats;
  night_status text;
  line   jsonb;
  fp     numeric;
  perf   numeric;
  gap    numeric;
  dem    numeric;
  noise  numeric;
  total  numeric;
  new_last5 numeric[];
  new_out   int;
  team_played boolean;
begin
  if exists (select 1 from game_nights where game_date = p_date) then
    raise exception 'Game night for % was already applied.', p_date;
  end if;
  if exists (select 1 from games where game_date = p_date and games.status <> 'STATUS_FINAL'
             and games.status not in ('STATUS_POSTPONED','STATUS_CANCELED')) then
    raise exception 'Not every game on % is final yet.', p_date;
  end if;

  n := current_night() + 1;
  insert into game_nights (night, game_date) values (n, p_date);

  for p in select * from players where active for update loop
    perf := 0; line := null; fp := null; new_last5 := p.last5;
    select * into st from player_game_stats s
      where s.espn_id = p.espn_id and s.game_date = p_date and s.min > 0 limit 1;
    team_played := exists (select 1 from games g where g.game_date = p_date
                           and g.status = 'STATUS_FINAL' and p.team in (g.home_team, g.away_team));

    if p.espn_id = any(p_out) then
      night_status := 'injured';
      new_out := 1;
      perf := case when p.out_nights > 0 then -0.01 else -0.08 end;
    elsif st.espn_id is not null then
      night_status := 'played';
      new_out := 0;
      line := jsonb_build_object('pts', st.pts, 'reb', st.reb, 'ast', st.ast,
                                 'stl', st.stl, 'blk', st.blk, 'tov', st.tov, 'min', st.min);
      fp := st.fp;
      perf := greatest(-0.14, least(0.14, 0.22 * (fp - p.expected_fp) / greatest(p.expected_fp, 5)));
      new_last5 := (p.last5 || fp)[greatest(1, cardinality(p.last5 || fp) - 4):];
    else
      night_status := case when team_played then 'rest' else 'idle' end;
      new_out := 0;
    end if;

    gap   := 0.08 * (fair_value(p) - p.price) / p.price;
    dem   := greatest(-0.06, least(0.06, p.pending_demand * 0.0004));
    noise := case when night_status = 'idle' then randn() * 0.003 else randn() * 0.008 end;
    total := greatest(-0.2, least(0.2, perf + gap + dem + noise));

    update players set
      price = greatest(3, round(p.price * (1 + total), 2)),
      out_nights = new_out,
      last5 = new_last5,
      pending_demand = 0,
      last_move = jsonb_build_object(
        'night', n, 'date', p_date, 'status', night_status, 'line', line, 'fp', fp,
        'expected', round(p.expected_fp,1),
        'perf', round(perf,4), 'gap', round(gap,4), 'demand', round(dem,4),
        'demand_shares', p.pending_demand, 'noise', round(noise,4), 'total', round(total,4))
    where ticker = p.ticker;

    insert into price_history (ticker, night, price)
      select ticker, n, price from players where ticker = p.ticker;
  end loop;

  -- Averages update *after* pricing so tonight's line is judged against the prior expectation.
  perform refresh_player_averages();

  insert into net_worth_history (user_id, night, net_worth)
    select pr.id, n, pr.cash + coalesce(sum(h.shares * pl.price), 0)
    from profiles pr
    left join holdings h on h.user_id = pr.id
    left join players pl on pl.ticker = h.ticker
    group by pr.id, pr.cash;

  return n;
end $$;

-- ───────────────────────── Bootstrap ─────────────────────────
-- One-time, before any users trade: after back-filling this season's box scores,
-- link the hand-picked seed tickers to ESPN ids (by name), list the rotation, and
-- reset every opening price to 1.2 × real expected FP at night 0.

create or replace function public.bootstrap_market()
returns int language plpgsql security definer set search_path = public as $$
declare
  listed int;
begin
  if exists (select 1 from trades) then
    raise exception 'Market already has trades; bootstrap is only for an empty market.';
  end if;

  update players p set espn_id = s.espn_id, team = s.team
  from (select distinct on (espn_id) espn_id, name, team from player_game_stats
        order by espn_id, game_date desc) s
  where p.espn_id is null
    and lower(unaccent_basic(p.name)) = lower(unaccent_basic(s.name));

  -- seed tickers that don't match a real player in the data are retired
  update players set active = false where espn_id is null;

  perform refresh_player_averages();
  listed := list_rotation_players();

  update players set price = greatest(3, round(1.2 * expected_fp, 2)), last5 = '{}',
                     pending_demand = 0, last_move = null;
  delete from price_history;
  delete from game_nights;
  insert into price_history (ticker, night, price) select ticker, 0, price from players;
  return listed;
end $$;

create or replace function public.unaccent_basic(t text)
returns text language sql immutable as $$
  select translate(t,
    'áàâäãåćčçđéèêëěíìîïłńňñóòôöõøřšśťúùûüůýžźżÁÀÂÄÃÅĆČÇĐÉÈÊËĚÍÌÎÏŁŃŇÑÓÒÔÖÕØŘŠŚŤÚÙÛÜŮÝŽŹŻ',
    'aaaaaacccdeeeeeiiiilnnnoooooorsstuuuuuyzzzAAAAAACCCDEEEEEIIIILNNNOOOOOORSSTUUUUUYZZZ')
$$;

-- ───────────────────────── Permissions ─────────────────────────
-- Only the server-side sync job (service role) may run these.

revoke all on function public.refresh_player_averages()            from public, anon, authenticated;
revoke all on function public.list_rotation_players(int, numeric)  from public, anon, authenticated;
revoke all on function public.apply_real_game_night(date, text[])  from public, anon, authenticated;
revoke all on function public.bootstrap_market()                   from public, anon, authenticated;
