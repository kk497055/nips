-- ============================================================
-- NIPS Portal — homework / assignments (ADDITIVE, non-destructive)
-- Teachers create assignments per batch; enrolled students submit a file;
-- teachers grade + leave feedback. Files in a PRIVATE bucket, RLS-gated.
-- Run once in Supabase → SQL Editor.
-- ============================================================

-- 1. Assignments (created by the batch teacher / admin).
create table if not exists public.assignments (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.batches(id) on delete cascade,
  title        text not null,
  instructions text,
  due_date     date,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

-- 2. One submission per student per assignment (resubmit = update).
create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  storage_path  text,
  file_type     text,
  size_bytes    bigint,
  submitted_at  timestamptz not null default now(),
  grade         text,
  feedback      text,
  graded_by     uuid references public.profiles(id),
  graded_at     timestamptz,
  unique (assignment_id, student_id)
);

-- Helper: which batch does an assignment belong to?
create or replace function public.assignment_batch(a uuid)
returns uuid language sql security definer stable as $$
  select batch_id from public.assignments where id = a;
$$;

alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

-- ASSIGNMENTS: admin all; teacher of batch all; enrolled student read.
drop policy if exists asg_admin on public.assignments;
create policy asg_admin on public.assignments for all using (public.is_admin());
drop policy if exists asg_teacher on public.assignments;
create policy asg_teacher on public.assignments for all using (public.teaches_batch(batch_id));
drop policy if exists asg_student on public.assignments;
create policy asg_student on public.assignments for select using (public.enrolled_paid(batch_id));

-- SUBMISSIONS: admin all; teacher of the batch all; student manages their own.
drop policy if exists sub_admin on public.submissions;
create policy sub_admin on public.submissions for all using (public.is_admin());
drop policy if exists sub_teacher on public.submissions;
create policy sub_teacher on public.submissions for all using (public.teaches_batch(public.assignment_batch(assignment_id)));
drop policy if exists sub_student_read on public.submissions;
create policy sub_student_read on public.submissions for select using (student_id = auth.uid());
drop policy if exists sub_student_write on public.submissions;
create policy sub_student_write on public.submissions for insert
  with check (student_id = auth.uid() and public.enrolled_paid(public.assignment_batch(assignment_id)));
drop policy if exists sub_student_update on public.submissions;
create policy sub_student_update on public.submissions for update
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- 3. Private bucket for submitted files, 50 MB cap. Path: "<assignment_id>/<student_id>/<file>".
insert into storage.buckets (id, name, public, file_size_limit)
values ('submissions', 'submissions', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists submissions_read on storage.objects;
create policy submissions_read on storage.objects for select using (
  bucket_id = 'submissions' and (
    public.is_admin()
    or public.teaches_batch(public.assignment_batch(((storage.foldername(name))[1])::uuid))
    or ((storage.foldername(name))[2])::uuid = auth.uid()
  )
);

drop policy if exists submissions_write on storage.objects;
create policy submissions_write on storage.objects for insert with check (
  bucket_id = 'submissions'
  and ((storage.foldername(name))[2])::uuid = auth.uid()
  and public.enrolled_paid(public.assignment_batch(((storage.foldername(name))[1])::uuid))
);

drop policy if exists submissions_delete on storage.objects;
create policy submissions_delete on storage.objects for delete using (
  bucket_id = 'submissions' and (
    public.is_admin()
    or public.teaches_batch(public.assignment_batch(((storage.foldername(name))[1])::uuid))
    or ((storage.foldername(name))[2])::uuid = auth.uid()
  )
);
