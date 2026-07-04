-- ============================================================
-- NIPS Portal — quizzes + leaderboard (ADDITIVE, non-destructive)
-- Teachers create MCQ quizzes; students take them; grading happens server-side
-- so correct answers are NEVER exposed to students. Run once in SQL Editor.
-- ============================================================

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  title text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  prompt text not null,
  options jsonb not null,          -- array of option strings
  correct_index int not null,
  position int not null default 0
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  student_name text,
  score int not null,
  total int not null,
  submitted_at timestamptz not null default now(),
  unique (quiz_id, student_id)
);

create or replace function public.quiz_batch(q uuid)
returns uuid language sql security definer stable as $$
  select batch_id from public.quizzes where id = q;
$$;

alter table public.quizzes        enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts  enable row level security;

-- QUIZZES: admin all; teacher of batch all; enrolled student may see the list.
drop policy if exists quiz_admin on public.quizzes;
create policy quiz_admin on public.quizzes for all using (public.is_admin());
drop policy if exists quiz_teacher on public.quizzes;
create policy quiz_teacher on public.quizzes for all using (public.teaches_batch(batch_id));
drop policy if exists quiz_student on public.quizzes;
create policy quiz_student on public.quizzes for select using (public.enrolled_paid(batch_id));

-- QUESTIONS: teacher/admin only. Students NEVER read this table (they'd see the
-- correct answers). Students get sanitized questions via the 'quiz' Edge Function.
drop policy if exists qq_teacher on public.quiz_questions;
create policy qq_teacher on public.quiz_questions for all
  using (public.teaches_batch(public.quiz_batch(quiz_id)) or public.is_admin());

-- ATTEMPTS: enrolled students + teacher + admin can read (for the leaderboard).
-- No student INSERT/UPDATE policy — only the Edge Function (service role) writes
-- scores, so students cannot forge results.
drop policy if exists qa_attempts_read on public.quiz_attempts;
create policy qa_attempts_read on public.quiz_attempts for select using (
  public.enrolled_paid(batch_id) or public.teaches_batch(batch_id) or public.is_admin()
);
drop policy if exists qa_attempts_admin on public.quiz_attempts;
create policy qa_attempts_admin on public.quiz_attempts for all using (public.is_admin());
