-- Players listed as Out can now be bought (and sold). Being out still costs price:
-- apply_real_game_night() applies -8% on a new injury and -1% per night out.
-- This is execute_trade() from 0001 with only the injured-buy check removed.

create or replace function public.execute_trade(p_ticker text, p_side text, p_shares int)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  pl    players;
  prof  profiles;
  h     holdings;
  total numeric;
begin
  if uid is null then raise exception 'Sign in to trade.'; end if;
  if p_shares is null or p_shares <= 0 then raise exception 'Enter a whole number of shares.'; end if;
  if p_side not in ('buy','sell') then raise exception 'Side must be buy or sell.'; end if;

  select * into pl from players where ticker = p_ticker and active for update;
  if not found then raise exception 'Unknown player %.', p_ticker; end if;
  select * into prof from profiles where id = uid for update;
  select * into h from holdings where user_id = uid and ticker = p_ticker for update;

  total := round(pl.price * p_shares, 2);

  if p_side = 'buy' then
    if total > prof.cash then
      raise exception 'Not enough cash. You can afford % shares.', floor(prof.cash / pl.price);
    end if;
    update profiles set cash = cash - total where id = uid;
    insert into holdings (user_id, ticker, shares, avg_cost)
      values (uid, p_ticker, p_shares, pl.price)
      on conflict (user_id, ticker) do update
        set avg_cost = round((holdings.avg_cost*holdings.shares + excluded.avg_cost*excluded.shares)
                             / (holdings.shares + excluded.shares), 2),
            shares   = holdings.shares + excluded.shares;
    update players set pending_demand = pending_demand + p_shares where ticker = p_ticker;
  else
    if h.user_id is null or h.shares < p_shares then
      raise exception 'You own % shares of %.', coalesce(h.shares, 0), p_ticker;
    end if;
    update profiles set cash = cash + total where id = uid;
    if h.shares = p_shares then
      delete from holdings where user_id = uid and ticker = p_ticker;
    else
      update holdings set shares = shares - p_shares where user_id = uid and ticker = p_ticker;
    end if;
    update players set pending_demand = pending_demand - p_shares where ticker = p_ticker;
  end if;

  insert into trades (user_id, ticker, side, shares, price, night)
    values (uid, p_ticker, p_side, p_shares, pl.price, current_night());

  return json_build_object('ticker', p_ticker, 'side', p_side, 'shares', p_shares,
                           'price', pl.price, 'total', total,
                           'cash', (select cash from profiles where id = uid));
end $$;

revoke all on function public.execute_trade(text,text,int) from public, anon;
grant execute on function public.execute_trade(text,text,int) to authenticated;
