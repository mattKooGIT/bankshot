-- Courtside Exchange: core schema
-- Players are tickers. Users trade with paper money. All money-moving logic runs
-- inside Postgres functions so the browser can never edit cash or prices directly.

-- ───────────────────────── Tables ─────────────────────────

create table public.players (
  ticker         text primary key,
  name           text not null,
  position       text not null check (position in ('G','F','C')),
  avg_pts        numeric not null,
  avg_reb        numeric not null,
  avg_ast        numeric not null,
  avg_stl        numeric not null,
  avg_blk        numeric not null,
  avg_tov        numeric not null,
  expected_fp    numeric generated always as
                   (avg_pts + 1.2*avg_reb + 1.5*avg_ast + 3*avg_stl + 3*avg_blk - avg_tov) stored,
  price          numeric(10,2) not null,
  out_nights     int not null default 0,
  last5          numeric[] not null default '{}',
  pending_demand numeric not null default 0,  -- net shares bought since last game night
  last_move      jsonb,                        -- breakdown shown in "why it moved"
  active         boolean not null default true
);

create table public.game_nights (
  night      int primary key,
  played_at  timestamptz not null default now()
);

create table public.price_history (
  ticker  text not null references public.players(ticker) on delete cascade,
  night   int  not null,
  price   numeric(10,2) not null,
  primary key (ticker, night)
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  cash        numeric(12,2) not null default 10000 check (cash >= 0),
  created_at  timestamptz not null default now()
);

create table public.holdings (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  ticker    text not null references public.players(ticker),
  shares    int  not null check (shares > 0),
  avg_cost  numeric(10,2) not null,
  primary key (user_id, ticker)
);

create table public.trades (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  ticker      text not null references public.players(ticker),
  side        text not null check (side in ('buy','sell')),
  shares      int  not null check (shares > 0),
  price       numeric(10,2) not null,
  night       int  not null,
  created_at  timestamptz not null default now()
);
create index trades_user_idx on public.trades(user_id, created_at desc);

create table public.net_worth_history (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  night      int  not null,
  net_worth  numeric(12,2) not null,
  primary key (user_id, night)
);

-- ───────────────────────── Row Level Security ─────────────────────────
-- Market data is public. Personal data is readable only by its owner.
-- No table allows direct writes from the browser; writes go through the functions below.

alter table public.players           enable row level security;
alter table public.game_nights       enable row level security;
alter table public.price_history     enable row level security;
alter table public.profiles          enable row level security;
alter table public.holdings          enable row level security;
alter table public.trades            enable row level security;
alter table public.net_worth_history enable row level security;

create policy "market is public"   on public.players       for select using (true);
create policy "nights are public"  on public.game_nights   for select using (true);
create policy "history is public"  on public.price_history for select using (true);

create policy "own profile"   on public.profiles          for select using (auth.uid() = id);
create policy "own holdings"  on public.holdings          for select using (auth.uid() = user_id);
create policy "own trades"    on public.trades            for select using (auth.uid() = user_id);
create policy "own net worth" on public.net_worth_history for select using (auth.uid() = user_id);

-- ───────────────────────── New user → profile ─────────────────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text := regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)), '[^a-zA-Z0-9_]', '', 'g');
  uname text;
begin
  base := left(case when length(base) < 3 then 'trader' else base end, 14);
  uname := base;
  while exists (select 1 from profiles where lower(username) = lower(uname)) loop
    uname := base || '_' || floor(random()*9000 + 1000)::int;
  end loop;
  insert into profiles (id, username) values (new.id, uname);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.current_night()
returns int language sql stable as $$
  select coalesce(max(night), 0) from public.game_nights
$$;

create or replace function public.fair_value(p public.players)
returns numeric language sql immutable as $$
  select round(1.2 * (0.6 * p.expected_fp +
         0.4 * coalesce((select avg(x) from unnest(p.last5) x), p.expected_fp)), 2)
$$;

-- standard normal random number (Box–Muller)
create or replace function public.randn()
returns double precision language sql volatile as $$
  select sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random())
$$;

-- ───────────────────────── Trading ─────────────────────────

create or replace function public.execute_trade(p_ticker text, p_side text, p_shares int)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  pl    players;
  prof  profiles;
  h     holdings;
  total numeric;
begin
  if uid is null then raise exception 'Sign in to trade.'; end if;
  if p_shares is null or p_shares <= 0 then raise exception 'Enter a whole number of shares.'; end if;
  if p_side not in ('buy','sell') then raise exception 'Side must be buy or sell.'; end if;

  select * into pl from players where ticker = p_ticker and active for update;
  if not found then raise exception 'Unknown player %.', p_ticker; end if;
  select * into prof from profiles where id = uid for update;
  select * into h from holdings where user_id = uid and ticker = p_ticker for update;

  total := round(pl.price * p_shares, 2);

  if p_side = 'buy' then
    if pl.out_nights > 0 then raise exception '% is injured. Buying opens when he returns.', pl.name; end if;
    if total > prof.cash then
      raise exception 'Not enough cash. You can afford % shares.', floor(prof.cash / pl.price);
    end if;
    update profiles set cash = cash - total where id = uid;
    insert into holdings (user_id, ticker, shares, avg_cost)
      values (uid, p_ticker, p_shares, pl.price)
      on conflict (user_id, ticker) do update
        set avg_cost = round((holdings.avg_cost*holdings.shares + excluded.avg_cost*excluded.shares)
                             / (holdings.shares + excluded.shares), 2),
            shares   = holdings.shares + excluded.shares;
    update players set pending_demand = pending_demand + p_shares where ticker = p_ticker;
  else
    if h.user_id is null or h.shares < p_shares then
      raise exception 'You own % shares of %.', coalesce(h.shares, 0), p_ticker;
    end if;
    update profiles set cash = cash + total where id = uid;
    if h.shares = p_shares then
      delete from holdings where user_id = uid and ticker = p_ticker;
    else
      update holdings set shares = shares - p_shares where user_id = uid and ticker = p_ticker;
    end if;
    update players set pending_demand = pending_demand - p_shares where ticker = p_ticker;
  end if;

  insert into trades (user_id, ticker, side, shares, price, night)
    values (uid, p_ticker, p_side, p_shares, pl.price, current_night());

  return json_build_object('ticker', p_ticker, 'side', p_side, 'shares', p_shares,
                           'price', pl.price, 'total', total,
                           'cash', (select cash from profiles where id = uid));
end $$;

-- ───────────────────────── Game night simulation ─────────────────────────
-- v1 simulates box scores from season averages. Later: replace the box-score block
-- with real results loaded from an NBA stats feed; the pricing logic stays the same.

create or replace function public.play_game_night()
returns int language plpgsql security definer set search_path = public as $$
declare
  n      int := current_night() + 1;
  p      players;
  r      double precision;
  hot    double precision;
  status text;
  line   jsonb;
  fp     numeric;
  perf   numeric;
  gap    numeric;
  dem    numeric;
  noise  numeric;
  total  numeric;
  new_last5 numeric[];
  new_out   int;
begin
  insert into game_nights (night) values (n);

  for p in select * from players where active for update loop
    perf := 0; line := null; fp := null; new_last5 := p.last5; new_out := p.out_nights;
    if p.out_nights > 0 then
      status := 'injured'; new_out := p.out_nights - 1; perf := -0.01;
    else
      r := random();
      if r < 0.025 then
        status := 'injured'; new_out := 1 + floor(random()*3)::int; perf := -(0.06 + random()*0.06);
      elsif r < 0.08 then
        status := 'rest';
      else
        status := 'played';
        hot := 1 + randn()*0.22;
        line := jsonb_build_object(
          'pts', greatest(0, round(p.avg_pts*hot + randn()*p.avg_pts*0.2)),
          'reb', greatest(0, round(p.avg_reb*hot + randn()*p.avg_reb*0.3)),
          'ast', greatest(0, round(p.avg_ast*hot + randn()*p.avg_ast*0.3)),
          'stl', greatest(0, round(p.avg_stl*hot + randn()*0.9)),
          'blk', greatest(0, round(p.avg_blk*hot + randn()*0.9)),
          'tov', greatest(0, round(p.avg_tov*hot + randn()*1.2)));
        fp := (line->>'pts')::numeric + 1.2*(line->>'reb')::numeric + 1.5*(line->>'ast')::numeric
            + 3*(line->>'stl')::numeric + 3*(line->>'blk')::numeric - (line->>'tov')::numeric;
        perf := greatest(-0.14, least(0.14, 0.22 * (fp - p.expected_fp) / p.expected_fp));
        new_last5 := (p.last5 || fp)[greatest(1, cardinality(p.last5 || fp) - 4):];
      end if;
    end if;

    gap   := 0.08 * (fair_value(p) - p.price) / p.price;
    dem   := greatest(-0.06, least(0.06, p.pending_demand * 0.0004));
    noise := randn() * 0.008;
    total := greatest(-0.2, least(0.2, perf + gap + dem + noise));

    update players set
      price = greatest(3, round(p.price * (1 + total), 2)),
      out_nights = new_out,
      last5 = new_last5,
      pending_demand = 0,
      last_move = jsonb_build_object(
        'night', n, 'status', status, 'line', line, 'fp', fp, 'expected', round(p.expected_fp,1),
        'perf', round(perf,4), 'gap', round(gap,4), 'demand', round(dem,4),
        'demand_shares', p.pending_demand, 'noise', round(noise,4), 'total', round(total,4))
    where ticker = p.ticker;

    insert into price_history (ticker, night, price)
      select ticker, n, price from players where ticker = p.ticker;
  end loop;

  insert into net_worth_history (user_id, night, net_worth)
    select pr.id, n, pr.cash + coalesce(sum(h.shares * pl.price), 0)
    from profiles pr
    left join holdings h on h.user_id = pr.id
    left join players pl on pl.ticker = h.ticker
    group by pr.id, pr.cash;

  return n;
end $$;

-- ───────────────────────── Leaderboard ─────────────────────────
-- Exposes only username + net worth, never anyone's holdings.

create or replace function public.leaderboard(p_limit int default 50)
returns table (rank bigint, username text, net_worth numeric, is_me boolean)
language sql stable security definer set search_path = public as $$
  with w as (
    select pr.id, pr.username, pr.cash + coalesce(sum(h.shares * pl.price), 0) as net_worth
    from profiles pr
    left join holdings h on h.user_id = pr.id
    left join players pl on pl.ticker = h.ticker
    group by pr.id
  )
  select rank() over (order by net_worth desc), username, round(net_worth, 2), id = auth.uid()
  from w order by net_worth desc limit least(p_limit, 200)
$$;

-- ───────────────────────── Permissions ─────────────────────────

revoke all on function public.play_game_night() from public, anon, authenticated;
revoke all on function public.execute_trade(text,text,int) from public, anon;
grant execute on function public.execute_trade(text,text,int) to authenticated;
grant execute on function public.leaderboard(int) to anon, authenticated;
