-- Isolated, auditable Jitsi interviews for faculty applicants.
create table if not exists public.faculty_interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.teacher_applications(id) on delete restrict,
  interviewer_id uuid not null references public.profiles(id) on delete restrict,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 15 and 180),
  timezone text not null default 'Asia/Karachi',
  room_name text not null unique,
  guest_token text not null unique,
  status text not null default 'scheduled' check (status in ('scheduled','live','completed','cancelled','no_show')),
  applicant_joined_at timestamptz,
  interviewer_joined_at timestamptz,
  ended_at timestamptz,
  interview_notes text,
  outcome text check (outcome is null or outcome in ('advance','reschedule','approve','reject')),
  reminder_24h_sent_at timestamptz,
  reminder_1h_sent_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faculty_interviews_application_idx on public.faculty_interviews(application_id, scheduled_at desc);
create index if not exists faculty_interviews_upcoming_idx on public.faculty_interviews(status, scheduled_at);
alter table public.faculty_interviews enable row level security;
drop policy if exists faculty_interviews_admin on public.faculty_interviews;
create policy faculty_interviews_admin on public.faculty_interviews for all
  using (public.is_admin()) with check (public.is_admin());
revoke all on table public.faculty_interviews from anon;
grant select, insert, update on table public.faculty_interviews to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'nips-faculty-interview-reminders';
select cron.schedule(
  'nips-faculty-interview-reminders', '*/5 * * * *',
  $schedule$
  select net.http_post(
    url := 'https://qajupsfbmbmbrjlqpstx.supabase.co/functions/v1/faculty-interview-reminders',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_qPM05rVcSDylY3K_viaksw_D-31dW90',
      'Authorization','Bearer sb_publishable_qPM05rVcSDylY3K_viaksw_D-31dW90'
    ), body := '{}'::jsonb
  );
  $schedule$
);
