-- ============================================================
-- NIPS Portal — batch curriculum topics (ADDITIVE, non-destructive)
-- Teacher/admin maintain a topic checklist per batch; enrolled students
-- see syllabus coverage progress. Run once in Supabase → SQL Editor.
-- ============================================================

create table if not exists public.curriculum_topics (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.batches(id) on delete cascade,
  title      text not null,
  position   int not null default 0,
  covered_at timestamptz,          -- null = not covered yet
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists curriculum_batch_idx on public.curriculum_topics (batch_id, position);

alter table public.curriculum_topics enable row level security;

drop policy if exists cur_admin on public.curriculum_topics;
create policy cur_admin on public.curriculum_topics for all using (public.is_admin());
drop policy if exists cur_teacher on public.curriculum_topics;
create policy cur_teacher on public.curriculum_topics for all using (public.teaches_batch(batch_id));
drop policy if exists cur_student on public.curriculum_topics;
create policy cur_student on public.curriculum_topics for select using (public.enrolled_paid(batch_id));
