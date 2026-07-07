-- ============================================================
-- NIPS Portal - optional co-teachers / assistants per batch
-- Additive, backward-compatible patch. Existing batches.teacher_id remains
-- the primary teacher; this table grants extra teachers the same batch access.
-- ============================================================

create table if not exists public.batch_teachers (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.batches(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'co_teacher' check (role in ('co_teacher','assistant')),
  created_at timestamptz not null default now(),
  unique (batch_id, teacher_id)
);

create index if not exists batch_teachers_teacher_idx
  on public.batch_teachers (teacher_id, batch_id);

alter table public.batch_teachers enable row level security;

create or replace function public.teaches_batch(b uuid)
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.batches where id = b and teacher_id = auth.uid())
     or exists(select 1 from public.batch_teachers where batch_id = b and teacher_id = auth.uid());
$$;

drop policy if exists batches_teacher on public.batches;
create policy batches_teacher on public.batches
  for select using (public.teaches_batch(id));

drop policy if exists batch_teachers_admin on public.batch_teachers;
create policy batch_teachers_admin on public.batch_teachers
  for all using (public.is_admin());

drop policy if exists batch_teachers_select on public.batch_teachers;
create policy batch_teachers_select on public.batch_teachers
  for select using (public.teaches_batch(batch_id));

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.enrollments e
    join public.batches b on b.id = e.batch_id
    where b.teacher_id = auth.uid() and e.student_id = profiles.id
  )
  or exists (
    select 1 from public.enrollments e
    join public.batch_teachers bt on bt.batch_id = e.batch_id
    where bt.teacher_id = auth.uid() and e.student_id = profiles.id
  )
);
