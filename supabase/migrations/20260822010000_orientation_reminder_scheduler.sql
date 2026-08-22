-- Invoke the duplicate-protected reminder service every five minutes.
-- The publishable key is intentionally public and is already shipped in portal/config.js.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'nips-class-reminders-five-minutes';

select cron.schedule(
  'nips-class-reminders-five-minutes',
  '*/5 * * * *',
  $schedule$
  select net.http_post(
    url := 'https://qajupsfbmbmbrjlqpstx.supabase.co/functions/v1/class-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_qPM05rVcSDylY3K_viaksw_D-31dW90',
      'Authorization', 'Bearer sb_publishable_qPM05rVcSDylY3K_viaksw_D-31dW90'
    ),
    body := '{}'::jsonb
  );
  $schedule$
);
