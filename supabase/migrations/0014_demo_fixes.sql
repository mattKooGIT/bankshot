-- Fixes from the "Try the demo" review.
--  1. "hidden" only keeps accounts off the Public room. Inside private rooms everyone sees
--     everyone they play against (standings, recap ranks, nightly results posts); otherwise a
--     guest's Demo League looked like a one-person league.
--  2. is_single_emoji accepts only emoji code point ranges: no invisible, spacing, bidi,
--     punctuation or private-use characters, at most 4 ZWJ parts and one skin tone per part.
--  3. seed_demo refuses new guests beyond 100 an hour, site-wide.

-- ───────────────────────── 1. Hidden accounts are visible in private rooms ─────────────────────────

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
    join profiles pr on pr.id = m.user_id and (not r.is_public or not pr.hidden or pr.id = auth.uid())
    left join holdings h on h.room_id = m.room_id and h.user_id = m.user_id
    left join players pl on pl.ticker = h.ticker
    group by m.user_id, pr.username, m.cash, m.final_net_worth, r.finalized_at
  )
  select rank() over (order by nw desc), username, round(nw, 2), coalesce(user_id = auth.uid(), false)
  from w order by nw desc limit least(p_limit, 200)
$$;

revoke all on function public.leaderboard(uuid, int) from public;
grant execute on function public.leaderboard(uuid, int) to anon, authenticated;

-- Private rooms only (as before); hidden members are now included in the standings.
create or replace function public.post_night_results(p_night int)
returns int language plpgsql security definer set search_path = public as $$
declare
  posted int;
  d date := (select game_date from game_nights where night = p_night);
begin
  with ranked as (
    select h.room_id, h.user_id, h.night, h.net_worth,
           rank() over (partition by h.room_id, h.night order by h.net_worth desc) as rk
    from net_worth_history h
    join rooms r on r.id = h.room_id and not r.is_public
    join profiles p on p.id = h.user_id
    where h.night in (p_night, p_night - 1)
  ), standings as (
    select c.room_id, c.rk,
      jsonb_build_object(
        'username', pr.username, 'net_worth', c.net_worth,
        'change_pct', round(c.net_worth / coalesce(pv.net_worth, r.starting_cash) - 1, 4),
        'rank', c.rk, 'prev_rank', pv.rk) as j
    from ranked c
    join profiles pr on pr.id = c.user_id
    join rooms r on r.id = c.room_id
    left join ranked pv on pv.room_id = c.room_id and pv.user_id = c.user_id and pv.night = p_night - 1
    where c.night = p_night
  )
  insert into room_events (room_id, kind, payload)
    select s.room_id, 'night',
           jsonb_build_object('night', p_night, 'date', d, 'standings', jsonb_agg(s.j order by s.rk, s.j->>'username'))
    from standings s
    where not exists (select 1 from room_events e
                      where e.room_id = s.room_id and e.kind = 'night' and (e.payload->>'night')::int = p_night)
    group by s.room_id;
  get diagnostics posted = row_count;
  return posted;
end $$;

create or replace function public.my_recap(p_room uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  n     int;
  target uuid;
  rooms_json json;
  best  json;
  worst json;
begin
  if uid is null then return null; end if;
  select max(night) into n from net_worth_history where user_id = uid;
  if n is null then return null; end if;

  with ranked as (
    select h.room_id, h.user_id, h.night, h.net_worth,
           rank() over (partition by h.room_id, h.night order by h.net_worth desc) as rk,
           count(*) over (partition by h.room_id, h.night) as sz
    from net_worth_history h
    join profiles p on p.id = h.user_id and (h.room_id <> public_room_id() or not p.hidden or p.id = uid)
    where h.night in (n, n - 1)
      and h.room_id in (select room_id from room_members where user_id = uid)
  )
  select json_agg(json_build_object(
           'room_id', m.room_id, 'room_name', r.name, 'is_public', r.is_public, 'net_worth', m.net_worth,
           'change_pct', round(m.net_worth / coalesce(pv.net_worth, r.starting_cash) - 1, 4),
           'rank', m.rk, 'prev_rank', pv.rk, 'size', m.sz)
         order by r.is_public desc, r.name)
    into rooms_json
  from ranked m
  join rooms r on r.id = m.room_id
  left join ranked pv on pv.room_id = m.room_id and pv.user_id = uid and pv.night = n - 1
  where m.user_id = uid and m.night = n;

  target := case when exists (select 1 from room_members where room_id = p_room and user_id = uid)
                 then p_room else public_room_id() end;

  select json_build_object('ticker', pl.ticker, 'name', pl.name, 'total', (pl.last_move->>'total')::numeric,
                           'status', pl.last_move->>'status', 'line', pl.last_move->'line')
    into best
  from holdings h join players pl on pl.ticker = h.ticker
  where h.user_id = uid and h.room_id = target and pl.last_move is not null
  order by (pl.last_move->>'total')::numeric desc limit 1;

  select json_build_object('ticker', pl.ticker, 'name', pl.name, 'total', (pl.last_move->>'total')::numeric,
                           'status', pl.last_move->>'status', 'line', pl.last_move->'line')
    into worst
  from holdings h join players pl on pl.ticker = h.ticker
  where h.user_id = uid and h.room_id = target and pl.last_move is not null
  order by (pl.last_move->>'total')::numeric asc limit 1;

  return json_build_object('night', n, 'date', (select game_date from game_nights where night = n),
                           'rooms', coalesce(rooms_json, '[]'::json), 'best', best, 'worst', worst);
end $$;


-- ───────────────────────── 2. Stricter single-emoji check ─────────────────────────

create or replace function public.is_emoji_cp(cp int)
returns boolean language sql immutable as $$
  select cp in (x'A9'::int, x'AE'::int, x'203C'::int, x'2049'::int, x'2122'::int, x'2139'::int, x'2328'::int,
                x'23CF'::int, x'24C2'::int, x'25B6'::int, x'25C0'::int, x'2B50'::int, x'2B55'::int,
                x'3030'::int, x'303D'::int, x'3297'::int, x'3299'::int)
      or cp between x'2194'::int and x'2199'::int or cp between x'21A9'::int and x'21AA'::int
      or cp between x'231A'::int and x'231B'::int or cp between x'23E9'::int and x'23F3'::int
      or cp between x'23F8'::int and x'23FA'::int or cp between x'25AA'::int and x'25AB'::int
      or cp between x'25FB'::int and x'25FE'::int or cp between x'2600'::int and x'27BF'::int
      or cp between x'2934'::int and x'2935'::int or cp between x'2B05'::int and x'2B07'::int
      or cp between x'2B1B'::int and x'2B1C'::int or cp between x'1F000'::int and x'1FAFF'::int
$$;

create or replace function public.is_single_emoji(t text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  segs text[];
  seg  text;
  s    text;
begin
  if t is null or char_length(t) not between 1 and 32 then return false; end if;
  if t ~ '^[#*0-9]️?⃣$' then return true; end if;
  segs := string_to_array(t, U&'\200D');
  if array_length(segs, 1) > 4 then return false; end if;
  foreach seg in array segs loop
    -- At most one skin tone per part.
    if char_length(seg) - char_length(regexp_replace(seg, '[\U0001F3FB-\U0001F3FF]', '', 'g')) > 1 then return false; end if;
    s := regexp_replace(seg, '[︎️⃣\U0001F3FB-\U0001F3FF\U000E0020-\U000E007F]', '', 'g');
    if char_length(s) = 2 and array_length(segs, 1) = 1
       and ascii(substr(s, 1, 1)) between x'1F1E6'::int and x'1F1FF'::int
       and ascii(substr(s, 2, 1)) between x'1F1E6'::int and x'1F1FF'::int then
      continue;  -- a flag
    end if;
    if char_length(s) <> 1 or not is_emoji_cp(ascii(s)) then return false; end if;
  end loop;
  return true;
end $$;

-- ───────────────────────── 3. A site-wide cap on new guests ─────────────────────────

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
  -- Backstop against scripted abuse: at most 100 new guests an hour, site-wide.
  if (select count(*) from auth.users where is_anonymous and created_at > now() - interval '1 hour') > 100 then
    raise exception 'The demo is busy right now. Try again in a few minutes.';
  end if;
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

revoke all on function public.seed_demo(uuid) from public, anon, authenticated;
