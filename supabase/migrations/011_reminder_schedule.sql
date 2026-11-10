-- Scheduled staff reminders: pg_cron calls the app, which sends the web pushes.
-- The bearer secret lives in Supabase Vault as 'spans_cron_secret' (same value as CRON_SECRET in Vercel); it is not in git.
--   select vault.create_secret('<CRON_SECRET>', 'spans_cron_secret', 'Bearer secret for /api/cron/reminders');
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 10:00 AM IST (04:30 UTC): reminder to everyone who hasn't started work today
select cron.schedule('staff-checkin-reminder-10am-ist', '30 4 * * *', $$
  select net.http_post(
    url := 'https://spans-payroll.vercel.app/api/cron/reminders?kind=checkin',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'spans_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000)
$$);

-- every 15 minutes: check-out reminder for shifts open 10+ hours (once per shift)
select cron.schedule('staff-checkout-reminder-every-15min', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://spans-payroll.vercel.app/api/cron/reminders?kind=checkout',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'spans_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000)
$$);
