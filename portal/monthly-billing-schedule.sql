-- Run the recurring billing dunning service at 05:05 Pakistan time daily
-- (00:05 UTC). Requires the `billing_schedule_secret` Vault secret and the
-- BILLING_SCHEDULE_SECRET Edge Function secret to have the same value.

select cron.unschedule(jobid)
from cron.job
where jobname = 'monthly-dunning-daily';

select cron.schedule(
  'monthly-dunning-daily',
  '5 0 * * *',
  $$
  select net.http_post(
    url := 'https://qajupsfbmbmbrjlqpstx.supabase.co/functions/v1/monthly-dunning',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-schedule-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'billing_schedule_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
