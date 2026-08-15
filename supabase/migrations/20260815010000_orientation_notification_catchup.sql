-- NIPS Portal — remember which exact orientation schedule was announced.
-- A changed schedule remains silent until an admin explicitly notifies again.

alter table public.orientation_cohorts
  add column if not exists notifications_enabled_for_scheduled_at timestamptz;

create index if not exists orientation_cohorts_notification_catchup_idx
  on public.orientation_cohorts (session_state, notifications_enabled_for_scheduled_at)
  where notifications_enabled_for_scheduled_at is not null;
