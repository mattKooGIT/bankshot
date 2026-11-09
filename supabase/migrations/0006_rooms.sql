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
