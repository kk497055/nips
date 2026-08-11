-- NIPS Portal — IAC orientation journey (additive production update)
-- Run once in Supabase SQL Editor. No existing enrolments or records are altered.

alter table public.orientation_programs
  add column if not exists session_state text not null default 'registration_open'
    check (session_state in ('registration_open','scheduled','live','completed')),
  add column if not exists student_message text,
  add column if not exists session_announced_at timestamptz,
  add column if not exists session_completed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'orientation_programs' and policyname = 'orientation_programs_student'
  ) then
    create policy orientation_programs_student on public.orientation_programs for select using (
      exists (
        select 1 from public.orientation_applications a
        where a.program_id = orientation_programs.id and a.student_id = auth.uid()
      )
    );
  end if;
end $$;
