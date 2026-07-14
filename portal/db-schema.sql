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

-- Batches (a class group). Assigned to one primary teacher.
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

-- Optional co-teachers / assistants for a batch. The legacy batches.teacher_id
-- remains the primary teacher so existing screens and data keep working.
create table if not exists public.batch_teachers (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.batches(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'co_teacher' check (role in ('co_teacher','assistant')),
  created_at timestamptz not null default now(),
  unique (batch_id, teacher_id)
);
create index if not exists batch_teachers_teacher_idx on public.batch_teachers (teacher_id, batch_id);

-- Enrollments: which student is in which batch + payment gate.
create table if not exists public.enrollments (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.batches(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','demo')),
  amount         numeric default 0,
  discount_note  text,
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
  select exists(select 1 from public.batches where id = b and teacher_id = auth.uid())
     or exists(select 1 from public.batch_teachers where batch_id = b and teacher_id = auth.uid());
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
alter table public.batch_teachers   enable row level security;
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
  or exists (
    select 1 from public.enrollments e
    join public.batch_teachers bt on bt.batch_id = e.batch_id
    where bt.teacher_id = auth.uid() and e.student_id = profiles.id
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
create policy batches_teacher on public.batches for select using (public.teaches_batch(id));
drop policy if exists batches_student on public.batches;
create policy batches_student on public.batches for select using (public.enrolled_paid(id));

-- BATCH_TEACHERS: admin manages; assigned teachers can see who else is attached.
drop policy if exists batch_teachers_admin on public.batch_teachers;
create policy batch_teachers_admin on public.batch_teachers for all using (public.is_admin());
drop policy if exists batch_teachers_select on public.batch_teachers;
create policy batch_teachers_select on public.batch_teachers for select using (public.teaches_batch(batch_id));

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

-- MATERIALS: teachers/admin upload per batch; enrolled students read. See materials.sql.
create table if not exists public.materials (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.batches(id) on delete cascade,
  title        text not null,
  storage_path text not null,
  file_type    text,
  size_bytes   bigint,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
alter table public.materials enable row level security;
drop policy if exists mat_admin on public.materials;
create policy mat_admin on public.materials for all using (public.is_admin());
drop policy if exists mat_teacher on public.materials;
create policy mat_teacher on public.materials for all using (public.teaches_batch(batch_id));
drop policy if exists mat_student on public.materials;
create policy mat_student on public.materials for select using (public.enrolled_paid(batch_id));

-- ASSIGNMENTS + SUBMISSIONS (homework). Full policies + storage in homework.sql.
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  title text not null, instructions text, due_date date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text, file_type text, size_bytes bigint,
  submitted_at timestamptz not null default now(),
  grade text, feedback text, graded_by uuid references public.profiles(id), graded_at timestamptz,
  unique (assignment_id, student_id)
);
create or replace function public.assignment_batch(a uuid)
returns uuid language sql security definer stable as $$
  select batch_id from public.assignments where id = a; $$;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
drop policy if exists asg_admin on public.assignments;
create policy asg_admin on public.assignments for all using (public.is_admin());
drop policy if exists asg_teacher on public.assignments;
create policy asg_teacher on public.assignments for all using (public.teaches_batch(batch_id));
drop policy if exists asg_student on public.assignments;
create policy asg_student on public.assignments for select using (public.enrolled_paid(batch_id));
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
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- POSTS (batch Q&A). Full definition + trigger in qa.sql.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  author_id uuid references public.profiles(id), author_name text,
  body text not null, parent_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists posts_batch_idx on public.posts (batch_id, created_at);
create or replace function public.qa_stamp()
returns trigger language plpgsql security definer as $$
begin
  new.author_id := auth.uid();
  new.author_name := (select full_name from public.profiles where id = auth.uid());
  return new;
end; $$;
drop trigger if exists trg_qa_stamp on public.posts;
create trigger trg_qa_stamp before insert on public.posts for each row execute function public.qa_stamp();
alter table public.posts enable row level security;
drop policy if exists qa_select on public.posts;
create policy qa_select on public.posts for select using (
  public.enrolled_paid(batch_id) or public.teaches_batch(batch_id) or public.is_admin());
drop policy if exists qa_insert on public.posts;
create policy qa_insert on public.posts for insert with check (
  author_id = auth.uid() and (public.enrolled_paid(batch_id) or public.teaches_batch(batch_id) or public.is_admin()));
drop policy if exists qa_delete on public.posts;
create policy qa_delete on public.posts for delete using (
  author_id = auth.uid() or public.teaches_batch(batch_id) or public.is_admin());

-- QUIZZES / QUESTIONS / ATTEMPTS. Full definition in quiz.sql.
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  title text not null, created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  prompt text not null, options jsonb not null, correct_index int not null, position int not null default 0
);
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  student_name text, score int not null, total int not null,
  submitted_at timestamptz not null default now(), unique (quiz_id, student_id)
);
create or replace function public.quiz_batch(q uuid)
returns uuid language sql security definer stable as $$ select batch_id from public.quizzes where id = q; $$;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
drop policy if exists quiz_admin on public.quizzes;
create policy quiz_admin on public.quizzes for all using (public.is_admin());
drop policy if exists quiz_teacher on public.quizzes;
create policy quiz_teacher on public.quizzes for all using (public.teaches_batch(batch_id));
drop policy if exists quiz_student on public.quizzes;
create policy quiz_student on public.quizzes for select using (public.enrolled_paid(batch_id));
drop policy if exists qq_teacher on public.quiz_questions;
create policy qq_teacher on public.quiz_questions for all
  using (public.teaches_batch(public.quiz_batch(quiz_id)) or public.is_admin());
drop policy if exists qa_attempts_read on public.quiz_attempts;
create policy qa_attempts_read on public.quiz_attempts for select using (
  public.enrolled_paid(batch_id) or public.teaches_batch(batch_id) or public.is_admin());
drop policy if exists qa_attempts_admin on public.quiz_attempts;
create policy qa_attempts_admin on public.quiz_attempts for all using (public.is_admin());

-- ENGAGEMENT: dashboard "seen" marker + payments log. See engagement.sql.
alter table public.profiles add column if not exists dashboard_seen_at timestamptz;
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  batch_id uuid references public.batches(id) on delete set null,
  amount numeric not null default 0, note text,
  paid_on timestamptz not null default now(), recorded_by uuid references public.profiles(id),
  receipt_number text, receipt_sent_at timestamptz
);
create unique index if not exists payments_receipt_number_unique
  on public.payments (receipt_number) where receipt_number is not null;
alter table public.payments enable row level security;
drop policy if exists pay_admin on public.payments;
create policy pay_admin on public.payments for all using (public.is_admin());
drop policy if exists pay_student on public.payments;
create policy pay_student on public.payments for select using (student_id = auth.uid());

-- REUSABLE CURRICULUM TEMPLATES. Teachers can create these before being
-- attached to a batch; applying one copies topics into curriculum_topics.
create table if not exists public.curriculum_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.curriculum_template_topics (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.curriculum_templates(id) on delete cascade,
  title text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists curriculum_templates_owner_idx on public.curriculum_templates (owner_id, is_archived, created_at);
create index if not exists curriculum_template_topics_template_idx on public.curriculum_template_topics (template_id, position);
alter table public.curriculum_templates enable row level security;
alter table public.curriculum_template_topics enable row level security;
create or replace function public.is_teacher()
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('teacher','admin'));
$$;
create or replace function public.owns_curriculum_template(t uuid)
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from public.curriculum_templates
    where id = t and (owner_id = auth.uid() or public.is_admin())
  );
$$;
drop policy if exists ct_select on public.curriculum_templates;
create policy ct_select on public.curriculum_templates for select using (owner_id = auth.uid() or public.is_admin());
drop policy if exists ct_insert on public.curriculum_templates;
create policy ct_insert on public.curriculum_templates for insert with check (owner_id = auth.uid() and public.is_teacher());
drop policy if exists ct_update on public.curriculum_templates;
create policy ct_update on public.curriculum_templates for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists ct_delete on public.curriculum_templates;
create policy ct_delete on public.curriculum_templates for delete using (owner_id = auth.uid() or public.is_admin());
drop policy if exists ctt_select on public.curriculum_template_topics;
create policy ctt_select on public.curriculum_template_topics for select using (public.owns_curriculum_template(template_id));
drop policy if exists ctt_insert on public.curriculum_template_topics;
create policy ctt_insert on public.curriculum_template_topics for insert with check (public.owns_curriculum_template(template_id));
drop policy if exists ctt_update on public.curriculum_template_topics;
create policy ctt_update on public.curriculum_template_topics for update using (public.owns_curriculum_template(template_id)) with check (public.owns_curriculum_template(template_id));
drop policy if exists ctt_delete on public.curriculum_template_topics;
create policy ctt_delete on public.curriculum_template_topics for delete using (public.owns_curriculum_template(template_id));

-- CURRICULUM TOPICS (syllabus checklist per batch). See curriculum.sql.
create table if not exists public.curriculum_topics (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  title text not null, position int not null default 0, covered_at timestamptz,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index if not exists curriculum_batch_idx on public.curriculum_topics (batch_id, position);
alter table public.curriculum_topics enable row level security;
drop policy if exists cur_admin on public.curriculum_topics;
create policy cur_admin on public.curriculum_topics for all using (public.is_admin());
drop policy if exists cur_teacher on public.curriculum_topics;
create policy cur_teacher on public.curriculum_topics for all using (public.teaches_batch(batch_id));
drop policy if exists cur_student on public.curriculum_topics;
create policy cur_student on public.curriculum_topics for select using (public.enrolled_paid(batch_id));

-- ============================================================
-- AFTER RUNNING THIS:
-- 1. Sign up once through the portal login page.
-- 2. Come back here and run (replace with your email):
--    update public.profiles set role='admin'
--    where id = (select id from auth.users where email='you@nips.com.pk');
-- 3. You are now admin. Everyone else defaults to 'student'.
-- ============================================================
