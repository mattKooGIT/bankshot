-- Feed replies (one level) and any-emoji reactions.
-- Spec: docs/superpowers/specs/2026-11-12-feed-replies-and-emoji-design.md

-- ───────────────────────── Any single emoji ─────────────────────────
-- One emoji "grapheme": a keycap (#️⃣), a flag (two regional indicators), or ZWJ-joined
-- parts that are each one emoji code point plus optional modifiers (skin tone, variation
-- selector, tag characters). Letters, digits, spaces and punctuation are rejected.
create or replace function public.is_single_emoji(t text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  segs text[];
  seg  text;
  s    text;
  cp   int;
begin
  if t is null or char_length(t) not between 1 and 32 then return false; end if;
  if t ~ '^[#*0-9]️?⃣$' then return true; end if;
  segs := string_to_array(t, U&'\200D');
  foreach seg in array segs loop
    s := regexp_replace(seg, '[︎️⃣\U0001F3FB-\U0001F3FF\U000E0020-\U000E007F]', '', 'g');
    if char_length(s) = 2 and array_length(segs, 1) = 1
       and ascii(substr(s, 1, 1)) between x'1F1E6'::int and x'1F1FF'::int
       and ascii(substr(s, 2, 1)) between x'1F1E6'::int and x'1F1FF'::int then
      continue;  -- a flag
    end if;
    if char_length(s) <> 1 then return false; end if;
    cp := ascii(s);
    if not (cp in (x'A9'::int, x'AE'::int, x'3030'::int, x'303D'::int, x'3297'::int, x'3299'::int)
            or cp between x'2000'::int and x'2BFF'::int
            or cp >= x'1F000'::int) then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- ───────────────────────── Schema ─────────────────────────

alter table public.room_events add column parent_id bigint references public.room_events(id) on delete cascade;
create index room_events_parent_idx on public.room_events (parent_id, id);
alter table public.room_events drop constraint room_events_kind_check;
alter table public.room_events add constraint room_events_kind_check
  check (kind in ('trade','join','leave','night','comment','reply'));
alter table public.room_events add constraint room_events_reply_parent_check
  check ((kind = 'reply') = (parent_id is not null));

alter table public.room_event_reactions drop constraint room_event_reactions_emoji_check;
alter table public.room_event_reactions add constraint room_event_reactions_emoji_check
  check (public.is_single_emoji(emoji));

-- ───────────────────────── Reaction helpers (internal) ─────────────────────────

create or replace function public.event_reactions(p_event bigint)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(x.emoji, x.n), '{}')
  from (select emoji, count(*) n from room_event_reactions where event_id = p_event group by emoji) x
$$;

create or replace function public.my_reactions(p_event bigint)
returns text[] language sql stable set search_path = public as $$
  select coalesce(array_agg(emoji order by emoji), '{}')
  from room_event_reactions where event_id = p_event and user_id = auth.uid()
$$;

revoke all on function public.event_reactions(bigint) from public, anon, authenticated;
revoke all on function public.my_reactions(bigint)    from public, anon, authenticated;

-- ───────────────────────── Comments, replies, reactions ─────────────────────────

create or replace function public.post_comment(p_room uuid, p_text text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  t   text := trim(coalesce(p_text, ''));
  eid bigint;
begin
  perform assert_member(p_room);
  if char_length(t) not between 1 and 280 then raise exception 'Comments are 1–280 characters.'; end if;
  if (select count(*) from room_events where room_id = p_room and actor_id = auth.uid() and kind in ('comment','reply')
        and created_at > now() - interval '60 seconds') >= 5 then
    raise exception 'Slow down — try again in a minute.';
  end if;
  insert into room_events (room_id, actor_id, kind, payload)
    values (p_room, auth.uid(), 'comment', jsonb_build_object('text', t)) returning id into eid;
  return eid;
end $$;

create or replace function public.post_reply(p_event bigint, p_text text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  t   text := trim(coalesce(p_text, ''));
  ev  room_events;
  eid bigint;
begin
  select * into ev from room_events where id = p_event;
  perform assert_member(ev.room_id);
  if char_length(t) not between 1 and 280 then raise exception 'Replies are 1–280 characters.'; end if;
  if (select count(*) from room_events where room_id = ev.room_id and actor_id = auth.uid() and kind in ('comment','reply')
        and created_at > now() - interval '60 seconds') >= 5 then
    raise exception 'Slow down — try again in a minute.';
  end if;
  insert into room_events (room_id, actor_id, kind, parent_id, payload)
    values (ev.room_id, auth.uid(), 'reply', coalesce(ev.parent_id, ev.id), jsonb_build_object('text', t))
    returning id into eid;
  return eid;
end $$;

create or replace function public.toggle_reaction(p_event bigint, p_emoji text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  if not coalesce(is_single_emoji(p_emoji), false) then raise exception 'Not a supported emoji.'; end if;
  select room_id into rid from room_events where id = p_event;
  perform assert_member(rid);
  delete from room_event_reactions where event_id = p_event and user_id = auth.uid() and emoji = p_emoji;
  if found then return false; end if;
  if (select count(*) from room_event_reactions where event_id = p_event and user_id = auth.uid()) >= 50 then
    raise exception 'That''s enough reactions for one post.';
  end if;
  insert into room_event_reactions (event_id, user_id, emoji) values (p_event, auth.uid(), p_emoji);
  return true;
end $$;

-- ───────────────────────── Reading ─────────────────────────

drop function public.room_feed(uuid, bigint, int);
create function public.room_feed(p_room uuid, p_before bigint default null, p_limit int default 30)
returns table (id bigint, kind text, actor text, payload jsonb, created_at timestamptz, reactions jsonb, mine text[],
               reply_count int, replies jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.kind, p.username, e.payload, e.created_at, event_reactions(e.id), my_reactions(e.id),
    (select count(*)::int from room_events r where r.parent_id = e.id),
    coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'actor', x.username, 'text', x.payload->>'text',
                                                  'created_at', x.created_at, 'reactions', event_reactions(x.id),
                                                  'mine', to_jsonb(my_reactions(x.id))) order by x.id)
              from (select r.id, r.payload, r.created_at, rp.username
                    from room_events r left join profiles rp on rp.id = r.actor_id
                    where r.parent_id = e.id order by r.id desc limit 3) x), '[]')
  from room_events e
  left join profiles p on p.id = e.actor_id
  where e.room_id = p_room and e.parent_id is null
    and exists (select 1 from room_members m where m.room_id = p_room and m.user_id = auth.uid())
    and (p_before is null or e.id < p_before)
  order by e.id desc
  limit least(greatest(p_limit, 1), 100)
$$;

create or replace function public.event_replies(p_event bigint)
returns table (id bigint, actor text, text text, created_at timestamptz, reactions jsonb, mine text[])
language sql stable security definer set search_path = public as $$
  select r.id, p.username, r.payload->>'text', r.created_at, event_reactions(r.id), my_reactions(r.id)
  from room_events r
  left join profiles p on p.id = r.actor_id
  where r.parent_id = p_event
    and exists (select 1 from room_members m where m.room_id = r.room_id and m.user_id = auth.uid())
  order by r.id
$$;

revoke all on function public.post_reply(bigint, text)          from public, anon;
revoke all on function public.room_feed(uuid, bigint, int)      from public, anon;
revoke all on function public.event_replies(bigint)             from public, anon;
grant execute on function public.post_reply(bigint, text)       to authenticated;
grant execute on function public.room_feed(uuid, bigint, int)   to authenticated;
grant execute on function public.event_replies(bigint)          to authenticated;
