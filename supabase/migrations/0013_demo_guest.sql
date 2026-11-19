-- "Try the demo": per-visitor guest sandboxes, a demand guard for hidden accounts, and cleanup.
-- Spec: docs/superpowers/specs/2026-11-12-demo-guest-design.md

-- ───────────────────────── Guests have no email ─────────────────────────
-- Anonymous users have neither an email nor a username; fall back to 'trader' instead of null.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)), '[^a-zA-Z0-9_]', '', 'g'), '');
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

-- ───────────────────────── Demand guard ─────────────────────────
-- Same as 0006, except hidden accounts (guests, bots, the demo recorder) never move prices.

create or replace function public.execute_trade(p_room uuid, p_ticker text, p_side text, p_shares int)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  r     rooms;
  m     room_members;
  pl    players;
  h     holdings;
  total numeric;
  counts boolean;
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
  counts := r.is_public and not coalesce((select hidden from profiles where id = uid), false);

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
    if counts then
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
    if counts then
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

-- ───────────────────────── Demo seed ─────────────────────────

create or replace function public.demo_bot(p_name text)
returns uuid language sql stable set search_path = public as $$
  select p.id from profiles p join auth.users u on u.id = p.id where u.email = p_name || '@bankshot.invalid'
$$;
revoke all on function public.demo_bot(text) from public, anon, authenticated;

-- Builds a guest's "Demo League": the guest and 3 bots, each holding 4 players bought on the
-- first of the last 3 game nights, with net-worth history, a nightly results post, comments,
-- a reply and reactions. Idempotent per guest. Returns the room id.
create or replace function public.seed_demo(p_guest uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid     uuid;
  bucket  uuid := demo_bot('bucket_getter');
  fade    uuid := demo_bot('fade_master');
  sixth   uuid := demo_bot('sixth_man');
  nights  int[];
  n_first int;
  n_last  int;
  hist    boolean;
  t       timestamptz;
  uname   text;
  mem     record;
  pick    record;
  first_trade bigint;
  ev_night    bigint;
  ev_cooked   bigint;
  ev_buylow   bigint;
begin
  if not exists (select 1 from auth.users where id = p_guest and is_anonymous) then
    raise exception 'Not a guest.';
  end if;
  select id into rid from rooms where owner_id = p_guest and name = 'Demo League' and not is_public limit 1;
  if rid is not null then return rid; end if;
  if bucket is null or fade is null or sixth is null then raise exception 'Demo bots are missing.'; end if;

  -- The guest: hidden, with a friendly name.
  loop
    uname := 'guest_' || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when not exists (select 1 from profiles where lower(username) = uname);
  end loop;
  update profiles set username = uname, hidden = true where id = p_guest;

  select array_agg(night order by night) into nights
    from (select night from game_nights where night between 1 and current_night() order by night desc limit 3) x;
  hist    := nights is not null;
  n_first := nights[1];
  n_last  := nights[array_length(nights, 1)];
  -- Back-dated story: bought on the first history night, well before last night's results.
  t := case when hist
            then least((select game_date from game_nights where night = n_first)::timestamp + interval '23 hours',
                       now() - interval '30 hours')
            else now() end;

  insert into rooms (name, owner_id, invite_code, starting_cash)
    values ('Demo League', p_guest, new_invite_code(), 10000) returning id into rid;
  insert into room_members (room_id, user_id, cash) values (rid, p_guest, 10000);
  insert into room_members (room_id, user_id, cash) values (rid, bucket, 10000), (rid, fade, 10000), (rid, sixth, 10000);
  if hist then
    update room_events set created_at = t - interval '1 hour' where room_id = rid and kind = 'join';
  end if;

  -- Holdings and trades: 4 players each, by rank among the 30 priciest active players.
  for mem in
    select * from (values (1, p_guest, array[1,5,9,13]), (2, bucket, array[2,3,4,6]),
                          (3, fade, array[21,22,23,24]), (4, sixth, array[7,12,17,22])) v(ord, uid, ranks)
    order by ord
  loop
    for pick in
      with top as (
        select p.ticker, coalesce(ph.price, p.price) as px,
               row_number() over (order by p.price desc, p.ticker) as rk
        from players p left join price_history ph on ph.ticker = p.ticker and ph.night = n_first
        where p.active
        order by p.price desc, p.ticker limit 30)
      select ticker, px, floor(2175 / px)::int as sh from top where rk = any(mem.ranks) order by rk
    loop
      continue when pick.sh < 1;
      insert into holdings (room_id, user_id, ticker, shares, avg_cost) values (rid, mem.uid, pick.ticker, pick.sh, pick.px);
      insert into trades (room_id, user_id, ticker, side, shares, price, night)
        values (rid, mem.uid, pick.ticker, 'buy', pick.sh, pick.px, coalesce(n_first, current_night()));
      if hist then
        t := t + interval '7 minutes';
        update trades set created_at = t
          where id = (select max(id) from trades where room_id = rid);
        update room_events set created_at = t
          where id = (select max(id) from room_events where room_id = rid and kind = 'trade');
      end if;
      if first_trade is null then
        select max(id) into first_trade from room_events where room_id = rid and kind = 'trade';
      end if;
    end loop;
    update room_members set cash = 10000 - coalesce((select sum(shares * avg_cost) from holdings
                                                     where room_id = rid and user_id = mem.uid), 0)
      where room_id = rid and user_id = mem.uid;
  end loop;

  if hist then
    -- Net worth on each history night, at that night's prices.
    insert into net_worth_history (room_id, user_id, night, net_worth)
      select rid, m.user_id, n.night,
             m.cash + coalesce((select sum(h.shares * coalesce(ph.price, pl.price))
                                from holdings h join players pl on pl.ticker = h.ticker
                                left join price_history ph on ph.ticker = h.ticker and ph.night = n.night
                                where h.room_id = rid and h.user_id = m.user_id), 0)
      from room_members m cross join unnest(nights) n(night)
      where m.room_id = rid;

    -- Last night's results post (hidden members included: everyone here is a guest or a bot).
    with ranked as (
      select h.user_id, h.night, h.net_worth,
             rank() over (partition by h.night order by h.net_worth desc) as rk
      from net_worth_history h where h.room_id = rid and h.night in (n_last, n_last - 1)
    ), standings as (
      select c.rk, jsonb_build_object('username', p.username, 'net_worth', c.net_worth,
               'change_pct', round(c.net_worth / coalesce(pv.net_worth, 10000) - 1, 4),
               'rank', c.rk, 'prev_rank', pv.rk) as j
      from ranked c join profiles p on p.id = c.user_id
      left join ranked pv on pv.user_id = c.user_id and pv.night = n_last - 1
      where c.night = n_last
    )
    insert into room_events (room_id, kind, payload, created_at)
      select rid, 'night',
             jsonb_build_object('night', n_last, 'date', (select game_date from game_nights where night = n_last),
                                'standings', jsonb_agg(j order by rk, j->>'username')),
             now() - interval '22 hours'
      from standings
      returning id into ev_night;
  end if;

  -- Some trash talk.
  insert into room_events (room_id, actor_id, kind, payload, created_at)
    values (rid, bucket, 'comment', jsonb_build_object('text', 'welcome to the league 👋'),
            case when hist then now() - interval '20 hours' else now() end);
  insert into room_events (room_id, actor_id, kind, payload, created_at)
    values (rid, bucket, 'comment', jsonb_build_object('text', 'fade_master you''re cooked'),
            case when hist then now() - interval '6 hours' else now() end)
    returning id into ev_cooked;
  insert into room_events (room_id, actor_id, kind, payload, created_at)
    values (rid, fade, 'comment', jsonb_build_object('text', 'buy low, cry later'),
            case when hist then now() - interval '2 hours' else now() end)
    returning id into ev_buylow;
  insert into room_events (room_id, actor_id, kind, parent_id, payload, created_at)
    values (rid, sixth, 'reply', ev_cooked, jsonb_build_object('text', '@fade_master check the standings first'),
            case when hist then now() - interval '1 hour' else now() end);

  insert into room_event_reactions (event_id, user_id, emoji)
    select e, u, x from (values (ev_cooked, fade, '💀'), (ev_cooked, sixth, '😂'), (ev_buylow, bucket, '🧊'),
                                (first_trade, bucket, '🔥'), (ev_night, sixth, '🐐'), (ev_night, bucket, '🔥')) v(e, u, x)
    where e is not null;

  return rid;
end $$;

-- ───────────────────────── Cleanup ─────────────────────────
-- Guests last 24 hours. Their own rooms go first (rooms.owner_id is "set null"), then the
-- users; memberships, holdings and trades elsewhere cascade from the profile.

create or replace function public.delete_stale_guests()
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  delete from rooms
    where not is_public
      and owner_id in (select id from auth.users where is_anonymous and created_at < now() - interval '24 hours');
  delete from auth.users where is_anonymous and created_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.seed_demo(uuid)        from public, anon, authenticated;
revoke all on function public.delete_stale_guests()  from public, anon, authenticated;

-- ───────────────────────── Leaving because the account is gone ─────────────────────────
-- When a user is deleted, their memberships cascade away; there is no one left to name in a
-- "left" post (and the actor foreign key would fail), so post nothing.

create or replace function public.feed_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from rooms where id = old.room_id and not is_public)
     and exists (select 1 from profiles where id = old.user_id) then
    insert into room_events (room_id, actor_id, kind) values (old.room_id, old.user_id, 'leave');
  end if;
  return old;
end $$;
