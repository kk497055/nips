-- ============================================================
-- NIPS Portal — Database Schema + Row Level Security
-- Run this in Supabase → SQL Editor → New Query → Run
-- ============================================================

-- ---------- TABLES ----------

-- Profiles: one row per auth user. Holds ONLY display name + role.
-- No contact info here, so it is safe to expose to teachers.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default 'New User',
  role        text not null default 'student' check (role in ('student','teacher','admin')),
  welcome_sent_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Private contact info — ADMIN ONLY. Teachers can never read this.
create table if not exists public.student_contacts (
  student_id     uuid primary key references public.profiles(id) on delete cascade,
  phone          text,
  email          text,
  guardian_phone text,
  notes          text
);

-- Batches (a class group). Assigned to one teacher.
create table if not exists public.batches (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text,                 -- e.g. 'Academy', 'Courses'
  teacher_id   uuid references public.profiles(id) on delete set null,
  schedule     text,                 -- free text e.g. "Mon/Wed 6pm"
  jitsi_room   text not null,        -- unique room slug
  fee          numeric default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Enrollments: which student is in which batch + payment gate.
create table if not exists public.enrollments (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.batches(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','demo')),
  amount         numeric default 0,
  enrolled_at    timestamptz not null default now(),
  unique (batch_id, student_id)
);

-- Attendance per session.
create table if not exists public.attendance (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.batches(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,
  session_date date not null default current_date,
  status       text not null default 'present' check (status in ('present','absent','late')),
  marked_by    uuid references public.profiles(id),
  unique (batch_id, student_id, session_date)
);

-- Session log + recording links.
create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.batches(id) on delete cascade,
  title         text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  recording_url text,
  created_by    uuid references public.profiles(id)
);

-- Delivery guard for scheduled emails.
create table if not exists public.notification_logs (
  id                uuid primary key default gen_random_uuid(),
  notification_type text not null,
  batch_id          uuid references public.batches(id) on delete cascade,
  student_id        uuid references public.profiles(id) on delete cascade,
  delivery_key      text not null,
  sent_at           timestamptz not null default now(),
  unique (notification_type, batch_id, student_id, delivery_key)
);

-- ---------- HELPER FUNCTIONS ----------

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Is the current user the teacher of this batch?
create or replace function public.teaches_batch(b uuid)
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.batches where id = b and teacher_id = auth.uid());
$$;

-- Is the current user a PAID student of this batch?
create or replace function public.enrolled_paid(b uuid)
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from public.enrollments
    where batch_id = b and student_id = auth.uid() and payment_status in ('paid','demo')
  );
$$;

-- Auto-create a profile whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name','New User'), 'student');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Prevent privilege escalation: a user may edit their own name, but only an
-- admin may change anyone's role (including their own row).
create or replace function public.protect_role()
returns trigger language plpgsql security definer as $$
begin
  -- auth.uid() is null in the SQL editor / service role (trusted); only guard app users.
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_role on public.profiles;
create trigger trg_protect_role
  before update on public.profiles
  for each row execute function public.protect_role();

-- ---------- ENABLE RLS ----------
alter table public.profiles         enable row level security;
alter table public.student_contacts enable row level security;
alter table public.batches          enable row level security;
alter table public.enrollments      enable row level security;
alter table public.attendance       enable row level security;
alter table public.sessions         enable row level security;
alter table public.notification_logs enable row level security;

-- ---------- POLICIES ----------

-- PROFILES: read own; admin reads all; teacher reads students in own batches.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.enrollments e
    join public.batches b on b.id = e.batch_id
    where b.teacher_id = auth.uid() and e.student_id = profiles.id
  )
);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (id = auth.uid());
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all using (public.is_admin());

-- STUDENT_CONTACTS: ADMIN ONLY (teachers get nothing).
drop policy if exists contacts_admin on public.student_contacts;
create policy contacts_admin on public.student_contacts for all using (public.is_admin());
-- Students may insert/update their own contact info.
drop policy if exists contacts_self on public.student_contacts;
create policy contacts_self on public.student_contacts for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- BATCHES: admin all; teacher sees own; paid student sees enrolled batches.
drop policy if exists batches_admin on public.batches;
create policy batches_admin on public.batches for all using (public.is_admin());
drop policy if exists batches_teacher on public.batches;
create policy batches_teacher on public.batches for select using (teacher_id = auth.uid());
drop policy if exists batches_student on public.batches;
create policy batches_student on public.batches for select using (public.enrolled_paid(id));

-- ENROLLMENTS: admin all; teacher reads own batch rosters; student reads own.
drop policy if exists enroll_admin on public.enrollments;
create policy enroll_admin on public.enrollments for all using (public.is_admin());
drop policy if exists enroll_teacher on public.enrollments;
create policy enroll_teacher on public.enrollments for select using (public.teaches_batch(batch_id));
drop policy if exists enroll_student on public.enrollments;
create policy enroll_student on public.enrollments for select using (student_id = auth.uid());

-- ATTENDANCE: admin all; teacher manages own batches; student reads own.
drop policy if exists att_admin on public.attendance;
create policy att_admin on public.attendance for all using (public.is_admin());
drop policy if exists att_teacher on public.attendance;
create policy att_teacher on public.attendance for all using (public.teaches_batch(batch_id));
drop policy if exists att_student on public.attendance;
create policy att_student on public.attendance for select using (student_id = auth.uid());

-- SESSIONS: admin all; teacher manages own; paid student reads enrolled.
drop policy if exists sess_admin on public.sessions;
create policy sess_admin on public.sessions for all using (public.is_admin());
drop policy if exists sess_teacher on public.sessions;
create policy sess_teacher on public.sessions for all using (public.teaches_batch(batch_id));
drop policy if exists sess_student on public.sessions;
create policy sess_student on public.sessions for select using (public.enrolled_paid(batch_id));

-- NOTIFICATION_LOGS: service role writes through Edge Functions; admins may inspect.
drop policy if exists notify_logs_admin on public.notification_logs;
create policy notify_logs_admin on public.notification_logs for select using (public.is_admin());

-- ============================================================
-- AFTER RUNNING THIS:
-- 1. Sign up once through the portal login page.
-- 2. Come back here and run (replace with your email):
--    update public.profiles set role='admin'
--    where id = (select id from auth.users where email='you@nips.com.pk');
-- 3. You are now admin. Everyone else defaults to 'student'.
-- ============================================================
