-- Members can leave a room; owners can delete one.
-- Leaving removes only your data in that room. If the owner leaves, ownership passes to
-- the member who joined earliest; if nobody is left, the room is deleted.
-- Ended rooms can't be left (final standings stay intact) but the owner can still delete them.

create or replace function public.leave_room(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r   rooms;
  heir uuid;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  -- Lock the room so two simultaneous leaves can't leave it ownerless.
  select * into r from rooms where id = p_room for update;
  if r.is_public then raise exception 'You can''t leave the Public room.'; end if;
  if r.id is null or not exists (select 1 from room_members where room_id = p_room and user_id = uid) then
    raise exception 'You are not in this room.';
  end if;
  if room_has_ended(r) then raise exception 'This room has ended.'; end if;

  -- Cascades to this room's holdings, trades and net-worth history for you only.
  delete from room_members where room_id = p_room and user_id = uid;

  if r.owner_id = uid then
    select user_id into heir from room_members where room_id = p_room order by joined_at, user_id limit 1;
    if heir is null then
      delete from rooms where id = p_room;
    else
      update rooms set owner_id = heir where id = p_room;
    end if;
  end if;
end $$;

create or replace function public.delete_room(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_room_owner(p_room); -- owner only; never Public
  -- Cascades to every member's data in this room.
  delete from rooms where id = p_room;
end $$;

revoke all on function public.leave_room(uuid)  from public, anon;
revoke all on function public.delete_room(uuid) from public, anon;
grant execute on function public.leave_room(uuid)  to authenticated;
grant execute on function public.delete_room(uuid) to authenticated;
