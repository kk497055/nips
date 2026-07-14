-- ============================================================
-- NIPS Portal — new-activity marker + fee history (ADDITIVE, non-destructive)
-- Run once in Supabase → SQL Editor.
-- ============================================================

-- 1. Per-student "last seen the dashboard" timestamp (drives "new" badges).
alter table public.profiles add column if not exists dashboard_seen_at timestamptz;

-- 2. Payments log for fee history + receipts.
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles(id) on delete cascade,
  batch_id    uuid references public.batches(id) on delete set null,
  amount      numeric not null default 0,
  note        text,
  paid_on     timestamptz not null default now(),
  recorded_by uuid references public.profiles(id)
);
alter table public.payments add column if not exists receipt_number text;
alter table public.payments add column if not exists receipt_sent_at timestamptz;
create unique index if not exists payments_receipt_number_unique
  on public.payments (receipt_number) where receipt_number is not null;
alter table public.payments enable row level security;

-- Admin manages all payments; a student may read their own history.
drop policy if exists pay_admin on public.payments;
create policy pay_admin on public.payments for all using (public.is_admin());
drop policy if exists pay_student on public.payments;
create policy pay_student on public.payments for select using (student_id = auth.uid());
