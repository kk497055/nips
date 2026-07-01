-- ============================================================
-- NIPS Portal — demo enrolment support (ADDITIVE, non-destructive)
-- Adds a 'demo' enrolment status that grants class access like 'paid'
-- but is NOT counted as revenue. Existing 'pending'/'paid' rows unaffected.
-- Run once in Supabase → SQL Editor.
-- ============================================================

-- 1. Allow 'demo' in the payment_status check (drops the old check by whatever
--    name it has, then re-adds an inclusive one).
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.enrollments'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%payment_status%';
  if c is not null then
    execute format('alter table public.enrollments drop constraint %I', c);
  end if;
end $$;

alter table public.enrollments
  add constraint enrollments_payment_status_check
  check (payment_status in ('pending','paid','demo'));

-- 2. Grant class access to demo students too (paid OR demo).
create or replace function public.enrolled_paid(b uuid)
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from public.enrollments
    where batch_id = b and student_id = auth.uid()
      and payment_status in ('paid','demo')
  );
$$;
