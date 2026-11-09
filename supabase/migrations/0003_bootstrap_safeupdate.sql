-- Supabase loads the pg-safeupdate extension for API requests, which rejects
-- UPDATE/DELETE statements without a WHERE clause. bootstrap_market() intentionally
-- touches every row, so say so explicitly with `where true`.

create or replace function public.bootstrap_market()
returns int language plpgsql security definer set search_path = public as $$
declare
  listed int;
begin
  if exists (select 1 from trades) then
    raise exception 'Market already has trades; bootstrap is only for an empty market.';
  end if;

  update players p set espn_id = s.espn_id, team = s.team
  from (select distinct on (espn_id) espn_id, name, team from player_game_stats
        order by espn_id, game_date desc) s
  where p.espn_id is null
    and lower(unaccent_basic(p.name)) = lower(unaccent_basic(s.name));

  -- seed tickers that don't match a real player in the data are retired
  update players set active = false where espn_id is null;

  perform refresh_player_averages();
  listed := list_rotation_players();

  update players set price = greatest(3, round(1.2 * expected_fp, 2)), last5 = '{}',
                     pending_demand = 0, last_move = null
  where true;
  delete from price_history where true;
  delete from game_nights where true;
  insert into price_history (ticker, night, price) select ticker, 0, price from players;
  return listed;
end $$;

revoke all on function public.bootstrap_market() from public, anon, authenticated;
