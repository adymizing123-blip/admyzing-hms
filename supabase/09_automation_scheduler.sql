-- =====================================================================
-- 09 (optional, recommended): run automations every 5 minutes from Supabase.
-- Works with any hosting plan (Vercel Hobby only allows one cron run per day).
--
-- 1. Replace YOUR-DOMAIN and YOUR_CRON_SECRET below (same value as CRON_SECRET in your env).
-- 2. Run this once in Supabase > SQL Editor.
-- To stop it:  select cron.unschedule('careplus-automations');
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('careplus-automations') where exists (select 1 from cron.job where jobname = 'careplus-automations');

select cron.schedule(
  'careplus-automations',
  '*/5 * * * *',
  $$ select net.http_get(
       url := 'https://YOUR-DOMAIN/api/cron/automations',
       headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
       timeout_milliseconds := 60000
     ) $$
);
