-- Courtside Exchange: rooms.
-- Every portfolio now belongs to a room. Today's game becomes the Public room, which
-- everyone is in; private rooms are joined by invite link and have their own cash,
-- holdings, trades and net-worth history. The market (players, prices) stays shared.
-- Spec: docs/superpowers/specs/2026-11-09-rooms-and-account-settings-design.md

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.public_room_id()
returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;

-- NBA dates are US Eastern. Tests replace this function to pin "today".
create or replace function public.eastern_today()
returns date language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;

-- ───────────────────────── Tables ─────────────────────────

create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 40),
  owner_id      uuid references public.profiles(id) on delete set null,
  invite_code   text unique,
  starting_cash numeric(12,2) not null check (starting_cash between 1000 and 1000000),
  member_cap    int check (member_cap between 2 and 50),
  ends_at       date,
  finalized_at  timestamptz,
  is_public     boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index rooms_one_public on public.rooms (is_public) where is_public;

-- A membership row IS the portfolio for that room.
create table public.room_members (
  room_id         uuid not null references public.rooms(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  cash            numeric(12,2) not null check (cash >= 0),
  joined_at       timestamptz not null default now(),
  final_net_worth numeric(12,2),
  primary key (room_id, user_id)
);

-- ───────────────────────── Move today's game into the Public room ─────────────────────────

insert into public.rooms (id, name, starting_cash, is_public)
  values (public_room_id(), 'Public', 10000, true);

insert into public.room_members (room_id, user_id, cash, joined_at)
  select public_room_id(), id, cash, created_at from public.profiles;

alter table public.holdings add column room_id uuid;
update public.holdings set room_id = public_room_id() where room_id is null;
alter table public.holdings alter column room_id set not null,
  drop constraint holdings_pkey,
  add primary key (room_id, user_id, ticker),
  add constraint holdings_member_fkey foreign key (room_id, user_id)
    references public.room_members (room_id, user_id) on delete cascade;

alter table public.trades add column room_id uuid;
update public.trades set room_id = public_room_id() where room_id is null;
alter table public.trades alter column room_id set not null,
  add constraint trades_member_fkey foreign key (room_id, user_id)
    references public.room_members (room_id, user_id) on delete cascade;
drop index public.trades_user_idx;
create index trades_room_user_idx on public.trades (room_id, user_id, created_at desc);

alter table public.net_worth_history add column room_id uuid;
update public.net_worth_history set room_id = public_room_id() where room_id is null;
alter table public.net_worth_history alter column room_id set not null,
  drop constraint net_worth_history_pkey,
  add primary key (room_id, user_id, night),
  add constraint net_worth_member_fkey foreign key (room_id, user_id)
    references public.room_members (room_id, user_id) on delete cascade;

-- Cash now lives on room_members. Old functions that read profiles.cash go too.
drop function public.execute_trade(text, text, int);
drop function public.play_game_night();
alter table public.profiles drop column cash;

-- ───────────────────────── Row Level Security ─────────────────────────

alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;

create policy "public or my rooms" on public.rooms for select
  using (is_public or exists (select 1 from public.room_members m
                              where m.room_id = rooms.id and m.user_id = auth.uid()));
-- Own memberships only: other members' cash is never readable (rosters come from room_roster()).
create policy "own memberships" on public.room_members for select using (user_id = auth.uid());

-- invite_code is owner-only (via room_invite()); every other column is readable under RLS.
revoke select on public.rooms from anon, authenticated;
grant select (id, name, owner_id, starting_cash, member_cap, ends_at, finalized_at, is_public, created_at)
  on public.rooms to anon, authenticated;

-- ───────────────────────── New users join Public ─────────────────────────

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
  insert into room_members (room_id, user_id, cash)
    select id, new.id, starting_cash from rooms where id = public_room_id();
  return new;
end $$;

-- ───────────────────────── Trading, per room ─────────────────────────
-- Same rules as before, against the membership's cash. Only Public trades count
-- toward pending_demand, so private (possibly huge-bankroll) rooms can't move prices.

create or replace function public.execute_trade(p_room uuid, p_ticker text, p_side text, p_shares int)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  r     rooms;
  m     room_members;
  pl    players;
  h     holdings;
  total numeric;
begin
  if uid is null then raise exception 'Sign in to trade.'; end if;
  if p_shares is null or p_shares <= 0 then raise exception 'Enter a whole number of shares.'; end if;
  if p_side not in ('buy','sell') then raise exception 'Side must be buy or sell.'; end if;

  select * into r from rooms where id = p_room;
  select * into m from room_members where room_id = p_room and user_id = uid for update;
  if r.id is null or m.user_id is null then raise exception 'You are not in this room.'; end if;
  if r.finalized_at is not null or (r.ends_at is not null and r.ends_at < eastern_today()) then
    raise exception 'This room has ended.';
  end if;

  select * into pl from players where ticker = p_ticker and active for update;
  if not found then raise exception 'Unknown player %.', p_ticker; end if;
  select * into h from holdings where room_id = p_room and user_id = uid and ticker = p_ticker for update;

  total := round(pl.price * p_shares, 2);

  if p_side = 'buy' then
    if total > m.cash then
      raise exception 'Not enough cash. You can afford % shares.', floor(m.cash / pl.price);
    end if;
    update room_members set cash = cash - total where room_id = p_room and user_id = uid;
    insert into holdings (room_id, user_id, ticker, shares, avg_cost)
      values (p_room, uid, p_ticker, p_shares, pl.price)
      on conflict (room_id, user_id, ticker) do update
        set avg_cost = round((holdings.avg_cost*holdings.shares + excluded.avg_cost*excluded.shares)
                             / (holdings.shares + excluded.shares), 2),
            shares   = holdings.shares + excluded.shares;
    if r.is_public then
      update players set pending_demand = pending_demand + p_shares where ticker = p_ticker;
    end if;
  else
    if h.user_id is null or h.shares < p_shares then
      raise exception 'You own % shares of %.', coalesce(h.shares, 0), p_ticker;
    end if;
    update room_members set cash = cash + total where room_id = p_room and user_id = uid;
    if h.shares = p_shares then
      delete from holdings where room_id = p_room and user_id = uid and ticker = p_ticker;
    else
      update holdings set shares = shares - p_shares
        where room_id = p_room and user_id = uid and ticker = p_ticker;
    end if;
    if r.is_public then
      update players set pending_demand = pending_demand - p_shares where ticker = p_ticker;
    end if;
  end if;

  insert into trades (room_id, user_id, ticker, side, shares, price, night)
    values (p_room, uid, p_ticker, p_side, p_shares, pl.price, current_night());

  return json_build_object('ticker', p_ticker, 'side', p_side, 'shares', p_shares,
                           'price', pl.price, 'total', total,
                           'cash', (select cash from room_members where room_id = p_room and user_id = uid));
end $$;

revoke all on function public.execute_trade(uuid, text, text, int) from public, anon;
grant execute on function public.execute_trade(uuid, text, text, int) to authenticated;


-- ───────────────────────── Nightly: per-room net worth and finalization ─────────────────────────
-- apply_real_game_night() from 0002; pricing is unchanged. pending_demand now only
-- accumulates from Public trades (see execute_trade above).

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

  -- One net-worth point per membership in every room still running.
  insert into net_worth_history (room_id, user_id, night, net_worth)
    select m.room_id, m.user_id, n, m.cash + coalesce(sum(h.shares * pl.price), 0)
    from room_members m
    join rooms r on r.id = m.room_id and r.finalized_at is null
    left join holdings h on h.room_id = m.room_id and h.user_id = m.user_id
    left join players pl on pl.ticker = h.ticker
    group by m.room_id, m.user_id, m.cash;

  -- Rooms whose end date has arrived freeze their standings at tonight's prices.
  update room_members m set final_net_worth = m.cash + coalesce((
      select sum(h.shares * pl.price) from holdings h join players pl on pl.ticker = h.ticker
      where h.room_id = m.room_id and h.user_id = m.user_id), 0)
    where m.room_id in (select id from rooms where ends_at <= p_date and finalized_at is null);
  update rooms set finalized_at = now() where ends_at <= p_date and finalized_at is null;

  return n;
end $$;

revoke all on function public.apply_real_game_night(date, text[]) from public, anon, authenticated;

-- ───────────────────────── Leaderboard, per room ─────────────────────────
-- Usernames and net worth only, never holdings. Private rooms: members only.
-- Finalized rooms rank by the frozen final_net_worth.

drop function public.leaderboard(int);

create or replace function public.leaderboard(p_room uuid, p_limit int default 50)
returns table (rank bigint, username text, net_worth numeric, is_me boolean)
language sql stable security definer set search_path = public as $$
  with r as (
    select * from rooms
    where id = p_room
      and (is_public or exists (select 1 from room_members where room_id = p_room and user_id = auth.uid()))
  ), w as (
    select m.user_id, pr.username,
           case when r.finalized_at is not null then m.final_net_worth
                else m.cash + coalesce(sum(h.shares * pl.price), 0) end as nw
    from r
    join room_members m on m.room_id = r.id
    join profiles pr on pr.id = m.user_id
    left join holdings h on h.room_id = m.room_id and h.user_id = m.user_id
    left join players pl on pl.ticker = h.ticker
    group by m.user_id, pr.username, m.cash, m.final_net_worth, r.finalized_at
  )
  select rank() over (order by nw desc), username, round(nw, 2), coalesce(user_id = auth.uid(), false)
  from w order by nw desc limit least(p_limit, 200)
$$;

revoke all on function public.leaderboard(uuid, int) from public;
grant execute on function public.leaderboard(uuid, int) to anon, authenticated;

-- ───────────────────────── Room management ─────────────────────────

-- 12 hex chars (48 bits) from a random UUID; pgcrypto isn't needed.
create or replace function public.new_invite_code()
returns text language sql volatile as $$ select left(replace(gen_random_uuid()::text, '-', ''), 12) $$;

create or replace function public.room_has_ended(r public.rooms)
returns boolean language sql stable as $$
  select r.finalized_at is not null or (r.ends_at is not null and r.ends_at < eastern_today())
$$;

create or replace function public.create_room(p_name text, p_starting_cash numeric, p_member_cap int, p_ends_at date)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rid uuid;
  code text := new_invite_code();
begin
  if uid is null then raise exception 'Sign in to create a room.'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 40 then
    raise exception 'Room name must be 1–40 characters.';
  end if;
  if p_starting_cash is null or p_starting_cash not between 1000 and 1000000 then
    raise exception 'Starting cash must be between $1,000 and $1,000,000.';
  end if;
  if p_member_cap is not null and p_member_cap not between 2 and 50 then
    raise exception 'Member cap must be between 2 and 50.';
  end if;
  if p_ends_at is not null and p_ends_at <= eastern_today() then
    raise exception 'End date must be in the future.';
  end if;

  insert into rooms (name, owner_id, invite_code, starting_cash, member_cap, ends_at)
    values (trim(p_name), uid, code, round(p_starting_cash, 2), p_member_cap, p_ends_at)
    returning id into rid;
  insert into room_members (room_id, user_id, cash) values (rid, uid, round(p_starting_cash, 2));
  return json_build_object('id', rid, 'invite_code', code);
end $$;

create or replace function public.join_room(p_invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r   rooms;
begin
  if uid is null then raise exception 'Sign in to join.'; end if;
  -- Lock the room so two people can't both take the last spot.
  select * into r from rooms where invite_code = p_invite_code and not is_public for update;
  if not found then raise exception 'This invite link is no longer valid.'; end if;
  if room_has_ended(r) then raise exception 'This room has ended.'; end if;
  if exists (select 1 from room_members where room_id = r.id and user_id = uid) then
    raise exception 'You''re already in this room.';
  end if;
  if r.member_cap is not null and (select count(*) from room_members where room_id = r.id) >= r.member_cap then
    raise exception 'This room is full.';
  end if;
  insert into room_members (room_id, user_id, cash) values (r.id, uid, r.starting_cash);
  return r.id;
end $$;

-- What an invite link shows before you join (works signed out). Null for a bad code.
create or replace function public.room_preview(p_invite_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', r.id, 'name', r.name, 'owner_username', o.username,
    'member_count', (select count(*) from room_members m where m.room_id = r.id),
    'member_cap', r.member_cap, 'starting_cash', r.starting_cash, 'ends_at', r.ends_at,
    'ended', room_has_ended(r))
  from rooms r left join profiles o on o.id = r.owner_id
  where r.invite_code = p_invite_code and not r.is_public
$$;

create or replace function public.room_invite(p_room uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  r rooms;
begin
  select * into r from rooms where id = p_room;
  if r.owner_id is distinct from auth.uid() or auth.uid() is null then
    raise exception 'Only the room owner can do that.';
  end if;
  return r.invite_code;
end $$;

-- Members only; never exposes cash.
create or replace function public.room_roster(p_room uuid)
returns table (user_id uuid, username text, joined_at timestamptz, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.username, m.joined_at, m.user_id = r.owner_id
  from room_members m
  join profiles p on p.id = m.user_id
  join rooms r on r.id = m.room_id
  where m.room_id = p_room
    and exists (select 1 from room_members me where me.room_id = p_room and me.user_id = auth.uid())
  order by m.joined_at
$$;

-- Shared owner check for remove_member / reset_invite.
create or replace function public.assert_room_owner(p_room uuid)
returns rooms language plpgsql stable security definer set search_path = public as $$
declare
  r rooms;
begin
  select * into r from rooms where id = p_room;
  if r.is_public then raise exception 'The Public room can''t be changed.'; end if;
  if r.id is null or auth.uid() is null or r.owner_id is distinct from auth.uid() then
    raise exception 'Only the room owner can do that.';
  end if;
  return r;
end $$;

create or replace function public.remove_member(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_room_owner(p_room);
  if p_user = auth.uid() then raise exception 'You can''t remove yourself.'; end if;
  -- Cascades to that room's holdings, trades and net-worth history only.
  delete from room_members where room_id = p_room and user_id = p_user;
end $$;

create or replace function public.reset_invite(p_room uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  code text := new_invite_code();
begin
  perform assert_room_owner(p_room);
  update rooms set invite_code = code where id = p_room;
  return code;
end $$;

-- ───────────────────────── Account settings ─────────────────────────

create or replace function public.set_username(p_username text)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in to change your username.'; end if;
  if p_username is null or p_username !~ '^[a-zA-Z0-9_]{3,20}$' then
    raise exception 'Usernames are 3–20 letters, numbers, or underscores.';
  end if;
  if exists (select 1 from profiles where lower(username) = lower(p_username) and id <> uid) then
    raise exception 'That username is taken.';
  end if;
  update profiles set username = p_username where id = uid;
  return p_username;
end $$;

-- ───────────────────────── Permissions ─────────────────────────

revoke all on function public.create_room(text, numeric, int, date) from public, anon;
revoke all on function public.join_room(text)                        from public, anon;
revoke all on function public.room_preview(text)                     from public;
revoke all on function public.room_invite(uuid)                      from public, anon;
revoke all on function public.room_roster(uuid)                      from public, anon;
revoke all on function public.assert_room_owner(uuid)                from public, anon, authenticated;
revoke all on function public.remove_member(uuid, uuid)              from public, anon;
revoke all on function public.reset_invite(uuid)                     from public, anon;
revoke all on function public.set_username(text)                     from public, anon;
grant execute on function public.create_room(text, numeric, int, date) to authenticated;
grant execute on function public.join_room(text)                        to authenticated;
grant execute on function public.room_preview(text)                     to anon, authenticated;
grant execute on function public.room_invite(uuid)                      to authenticated;
grant execute on function public.room_roster(uuid)                      to authenticated;
grant execute on function public.remove_member(uuid, uuid)              to authenticated;
grant execute on function public.reset_invite(uuid)                     to authenticated;
grant execute on function public.set_username(text)                     to authenticated;
