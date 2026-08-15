-- NIPS Portal — student-visible orientation notifications.
-- Additive only: no existing rows or workflows are modified.

create table if not exists public.portal_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  action_url text,
  delivery_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, delivery_key)
);

create index if not exists portal_notifications_recipient_idx
  on public.portal_notifications (recipient_id, created_at desc);

alter table public.portal_notifications enable row level security;

drop policy if exists portal_notifications_select_own on public.portal_notifications;
create policy portal_notifications_select_own on public.portal_notifications
  for select using (recipient_id = auth.uid() or public.is_admin());

drop policy if exists portal_notifications_update_own on public.portal_notifications;
create policy portal_notifications_update_own on public.portal_notifications
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

drop policy if exists portal_notifications_admin on public.portal_notifications;
create policy portal_notifications_admin on public.portal_notifications
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.portal_notifications to authenticated;
revoke update on public.portal_notifications from authenticated;
grant update (read_at) on public.portal_notifications to authenticated;

-- Allow delivery logs for orientation cohorts, while retaining the existing
-- uniqueness guard that prevents duplicate emails on retries.
alter table public.notification_logs
  drop constraint if exists notification_logs_notification_type_check;
