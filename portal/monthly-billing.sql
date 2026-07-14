-- NIPS Portal — recurring monthly batch billing (additive, non-destructive)
-- Monthly billing is opt-in per batch. Existing one-time enrollments and
-- payments are not changed.

alter table public.batches
  add column if not exists monthly_billing_enabled boolean not null default false;

create table if not exists public.monthly_invoices (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.batches(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,
  billing_month date not null,
  due_date     date not null,
  amount       numeric not null default 0,
  status       text not null default 'pending' check (status in ('pending','grace','delinquent','paid')),
  grace_until  date,
  grace_note   text,
  payment_id   uuid references public.payments(id) on delete set null,
  paid_on      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (batch_id, student_id, billing_month)
);
create index if not exists monthly_invoices_collection_idx
  on public.monthly_invoices (status, due_date, batch_id);
create index if not exists monthly_invoices_student_idx
  on public.monthly_invoices (student_id, billing_month desc);

alter table public.monthly_invoices enable row level security;
drop policy if exists monthly_invoices_admin on public.monthly_invoices;
create policy monthly_invoices_admin on public.monthly_invoices for all using (public.is_admin());
drop policy if exists monthly_invoices_student on public.monthly_invoices;
create policy monthly_invoices_student on public.monthly_invoices for select using (student_id = auth.uid());
