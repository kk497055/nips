-- Duplicate protection for explicitly approved messages to event attendees
-- whose Meet email does not match a portal account.
create table if not exists public.external_notification_logs (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  delivery_key text not null,
  sent_at timestamptz not null default now(),
  unique (email, delivery_key)
);
alter table public.external_notification_logs enable row level security;
create policy external_notification_logs_admin_select on public.external_notification_logs
  for select using (public.is_admin());
grant select on public.external_notification_logs to authenticated;
