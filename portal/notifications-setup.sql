-- ============================================================
-- NIPS Portal - notification setup patch
-- Run this once in Supabase SQL Editor if db-schema.sql was already applied.
-- ============================================================

alter table public.profiles
  add column if not exists welcome_sent_at timestamptz;

create table if not exists public.notification_logs (
  id                uuid primary key default gen_random_uuid(),
  notification_type text not null,
  batch_id          uuid references public.batches(id) on delete cascade,
  student_id        uuid references public.profiles(id) on delete cascade,
  delivery_key      text not null,
  sent_at           timestamptz not null default now(),
  unique (notification_type, batch_id, student_id, delivery_key)
);

alter table public.notification_logs enable row level security;

drop policy if exists notify_logs_admin on public.notification_logs;
create policy notify_logs_admin on public.notification_logs
  for select using (public.is_admin());
