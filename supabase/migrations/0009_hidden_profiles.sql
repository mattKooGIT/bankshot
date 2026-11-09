-- Hidden profiles (e.g. the account that records the product demo) trade normally but
-- never appear on leaderboards. Ranks are computed after the filter, so no gaps.

alter table public.profiles add column hidden boolean not null default false;

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
    join profiles pr on pr.id = m.user_id and not pr.hidden
    left join holdings h on h.room_id = m.room_id and h.user_id = m.user_id
    left join players pl on pl.ticker = h.ticker
    group by m.user_id, pr.username, m.cash, m.final_net_worth, r.finalized_at
  )
  select rank() over (order by nw desc), username, round(nw, 2), coalesce(user_id = auth.uid(), false)
  from w order by nw desc limit least(p_limit, 200)
$$;

revoke all on function public.leaderboard(uuid, int) from public;
grant execute on function public.leaderboard(uuid, int) to anon, authenticated;
