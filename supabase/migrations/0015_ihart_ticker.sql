-- Rename Isaiah Hartenstein's ticker: HARTENSTEI (11 letters truncated to 10) → IHART.
-- price_history, holdings and trades follow via ON UPDATE CASCADE (0004).
-- Feed trade posts keep the ticker in their JSON payload, so patch those too.
-- Idempotent: a no-op where the player isn't listed or was already renamed.

update public.players set ticker = 'IHART'
  where ticker = 'HARTENSTEI'
    and not exists (select 1 from public.players where ticker = 'IHART');

update public.room_events set payload = jsonb_set(payload, '{ticker}', '"IHART"')
  where payload->>'ticker' = 'HARTENSTEI';
