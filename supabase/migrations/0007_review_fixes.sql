-- Fixes from the rooms review.
-- 1. Usernames unique ignoring case in the database itself, so two people can't grab
--    "Bob" and "bob" at the same moment. (Fails loudly if a case-collision already exists.)
-- 2. Final standings can't be rewritten by removing members after a room has ended.

create unique index profiles_username_lower on public.profiles (lower(username));

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
exception when unique_violation then
  -- Lost a race with someone taking the same name.
  raise exception 'That username is taken.';
end $$;

create or replace function public.remove_member(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rooms := assert_room_owner(p_room);
begin
  if room_has_ended(r) then raise exception 'This room has ended.'; end if;
  if p_user = auth.uid() then raise exception 'You can''t remove yourself.'; end if;
  -- Cascades to that room's holdings, trades and net-worth history only.
  delete from room_members where room_id = p_room and user_id = p_user;
end $$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
