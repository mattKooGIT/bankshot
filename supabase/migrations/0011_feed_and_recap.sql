-- Room activity feed (private rooms only) and nightly recap.
-- Spec: docs/superpowers/specs/2026-11-09-activity-feed-and-recap-design.md

-- ───────────────────────── Tables ─────────────────────────

create table public.room_events (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  kind       text not null check (kind in ('trade','join','leave','night','comment')),
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index room_events_room_idx on public.room_events (room_id, id desc);

create table public.room_event_reactions (
  event_id bigint not null references public.room_events(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  emoji    text not null check (emoji in ('🔥','😂','💀','📉')),
  primary key (event_id, user_id, emoji)
);

-- No direct access: everything goes through the functions below.
alter table public.room_events          enable row level security;
alter table public.room_event_reactions enable row level security;

-- ───────────────────────── Triggers ─────────────────────────

create or replace function public.feed_on_trade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from rooms where id = new.room_id and not is_public) then
    insert into room_events (room_id, actor_id, kind, payload)
      values (new.room_id, new.user_id, 'trade',
              jsonb_build_object('side', new.side, 'ticker', new.ticker, 'shares', new.shares, 'price', new.price));
  end if;
  return new;
end $$;
create trigger feed_trade after insert on public.trades for each row execute function public.feed_on_trade();

create or replace function public.feed_on_join()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Skip the Public room and the creator's own first membership.
  if exists (select 1 from rooms where id = new.room_id and not is_public and owner_id is distinct from new.user_id) then
    insert into room_events (room_id, actor_id, kind) values (new.room_id, new.user_id, 'join');
  end if;
  return new;
end $$;
create trigger feed_join after insert on public.room_members for each row execute function public.feed_on_join();

create or replace function public.feed_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- When the whole room is being deleted, the room row is already gone: post nothing.
  if exists (select 1 from rooms where id = old.room_id and not is_public) then
    insert into room_events (room_id, actor_id, kind) values (old.room_id, old.user_id, 'leave');
  end if;
  return old;
end $$;
create trigger feed_leave after delete on public.room_members for each row execute function public.feed_on_leave();

-- ───────────────────────── Comments and reactions ─────────────────────────

create or replace function public.assert_member(p_room uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from room_members where room_id = p_room and user_id = auth.uid()) then
    raise exception 'You are not in this room.';
  end if;
end $$;

create or replace function public.post_comment(p_room uuid, p_text text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  t   text := trim(coalesce(p_text, ''));
  eid bigint;
begin
  perform assert_member(p_room);
  if char_length(t) not between 1 and 280 then raise exception 'Comments are 1–280 characters.'; end if;
  if (select count(*) from room_events where room_id = p_room and actor_id = auth.uid() and kind = 'comment'
        and created_at > now() - interval '60 seconds') >= 5 then
    raise exception 'Slow down — try again in a minute.';
  end if;
  insert into room_events (room_id, actor_id, kind, payload)
    values (p_room, auth.uid(), 'comment', jsonb_build_object('text', t)) returning id into eid;
  return eid;
end $$;

create or replace function public.toggle_reaction(p_event bigint, p_emoji text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  if p_emoji not in ('🔥','😂','💀','📉') then raise exception 'Not a supported emoji.'; end if;
  select room_id into rid from room_events where id = p_event;
  perform assert_member(rid);
  delete from room_event_reactions where event_id = p_event and user_id = auth.uid() and emoji = p_emoji;
  if found then return false; end if;
  insert into room_event_reactions (event_id, user_id, emoji) values (p_event, auth.uid(), p_emoji);
  return true;
end $$;

-- Newest first; page with p_before (an event id). Members only.
create or replace function public.room_feed(p_room uuid, p_before bigint default null, p_limit int default 30)
returns table (id bigint, kind text, actor text, payload jsonb, created_at timestamptz, reactions jsonb, mine text[])
language sql stable security definer set search_path = public as $$
  select e.id, e.kind, p.username, e.payload, e.created_at,
    coalesce((select jsonb_object_agg(x.emoji, x.n) from
               (select emoji, count(*) n from room_event_reactions where event_id = e.id group by emoji) x), '{}'),
    coalesce((select array_agg(emoji order by emoji) from room_event_reactions
               where event_id = e.id and user_id = auth.uid()), '{}')
  from room_events e
  left join profiles p on p.id = e.actor_id
  where e.room_id = p_room
    and exists (select 1 from room_members m where m.room_id = p_room and m.user_id = auth.uid())
    and (p_before is null or e.id < p_before)
  order by e.id desc
  limit least(greatest(p_limit, 1), 100)
$$;

revoke all on function public.assert_member(uuid)                   from public, anon, authenticated;
revoke all on function public.post_comment(uuid, text)              from public, anon;
revoke all on function public.toggle_reaction(bigint, text)         from public, anon;
revoke all on function public.room_feed(uuid, bigint, int)          from public, anon;
grant execute on function public.post_comment(uuid, text)           to authenticated;
grant execute on function public.toggle_reaction(bigint, text)      to authenticated;
grant execute on function public.room_feed(uuid, bigint, int)       to authenticated;
