-- NIPS Portal — Institute of Arts and Culture orientation registration
-- Additive only. The orientation is a separate, zero-fee demo batch and does
-- not modify any existing course, payment, or enrolment record.

insert into public.batches (name, category, schedule, jitsi_room, fee, is_active, monthly_billing_enabled)
select 'Institute of Arts and Culture Orientation', 'Institute of Arts and Culture',
       'Orientation session — schedule to be announced', 'iac-orientation', 0, true, false
where not exists (
  select 1 from public.batches
  where name = 'Institute of Arts and Culture Orientation'
);

create table if not exists public.orientation_programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  batch_id uuid not null unique references public.batches(id) on delete restrict,
  is_active boolean not null default true,
  session_state text not null default 'registration_open' check (session_state in ('registration_open','scheduled','live','completed')),
  student_message text,
  session_announced_at timestamptz,
  session_completed_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.orientation_programs (code, name, batch_id)
select 'iac-orientation', 'Institute of Arts and Culture Orientation', b.id
from public.batches b
where b.name = 'Institute of Arts and Culture Orientation'
  and not exists (select 1 from public.orientation_programs where code = 'iac-orientation');

create table if not exists public.orientation_applications (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.orientation_programs(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text not null,
  date_of_birth date,
  gender text,
  city text,
  country text,
  address text,
  guardian_name text,
  guardian_phone text,
  education_level text,
  institution text,
  field_of_study text,
  completion_year integer,
  interests text,
  career_goal text,
  referral_source text,
  notes text,
  status text not null default 'submitted' check (status in ('submitted','reviewed','attended','withdrawn')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, student_id)
);
create index if not exists orientation_applications_program_idx
  on public.orientation_applications (program_id, status, submitted_at desc);

alter table public.orientation_programs enable row level security;
alter table public.orientation_applications enable row level security;
create policy orientation_programs_admin on public.orientation_programs for all using (public.is_admin());
create policy orientation_applications_admin on public.orientation_applications for all using (public.is_admin());
create policy orientation_applications_student on public.orientation_applications for select using (student_id = auth.uid());
create policy orientation_programs_student on public.orientation_programs for select using (
  exists (select 1 from public.orientation_applications a where a.program_id = orientation_programs.id and a.student_id = auth.uid())
);

-- Used only by the signup trigger and the authenticated orientation edge function.
create or replace function public.submit_orientation_application(
  p_student_id uuid,
  p_email text,
  p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_program_id uuid;
  v_batch_id uuid;
  v_application_id uuid;
  v_name text := left(trim(coalesce(p_payload->>'full_name', '')), 160);
  v_phone text := left(trim(coalesce(p_payload->>'phone', '')), 50);
  v_email text := lower(left(trim(coalesce(p_email, '')), 254));
begin
  if coalesce(p_payload->>'orientation_program', '') <> 'iac-orientation' then
    raise exception 'Unknown orientation program';
  end if;
  if v_name = '' or v_phone = '' or v_email = '' then
    raise exception 'Name, email, and phone are required';
  end if;

  select id, batch_id into v_program_id, v_batch_id
  from public.orientation_programs where code = 'iac-orientation' and is_active = true;
  if v_program_id is null then raise exception 'Orientation registration is not available'; end if;

  update public.profiles set full_name = v_name where id = p_student_id;
  insert into public.student_contacts (student_id, phone, email, guardian_phone)
  values (p_student_id, v_phone, v_email, nullif(left(trim(coalesce(p_payload->>'guardian_phone', '')), 50), ''))
  on conflict (student_id) do update set phone = excluded.phone, email = excluded.email,
    guardian_phone = excluded.guardian_phone;

  insert into public.orientation_applications (
    program_id, student_id, full_name, email, phone, date_of_birth, gender, city, country, address,
    guardian_name, guardian_phone, education_level, institution, field_of_study, completion_year,
    interests, career_goal, referral_source, notes, status, submitted_at, updated_at
  ) values (
    v_program_id, p_student_id, v_name, v_email, v_phone,
    nullif(p_payload->>'date_of_birth', '')::date,
    nullif(left(trim(coalesce(p_payload->>'gender', '')), 60), ''),
    nullif(left(trim(coalesce(p_payload->>'city', '')), 100), ''),
    nullif(left(trim(coalesce(p_payload->>'country', '')), 100), ''),
    nullif(left(trim(coalesce(p_payload->>'address', '')), 500), ''),
    nullif(left(trim(coalesce(p_payload->>'guardian_name', '')), 160), ''),
    nullif(left(trim(coalesce(p_payload->>'guardian_phone', '')), 50), ''),
    nullif(left(trim(coalesce(p_payload->>'education_level', '')), 100), ''),
    nullif(left(trim(coalesce(p_payload->>'institution', '')), 200), ''),
    nullif(left(trim(coalesce(p_payload->>'field_of_study', '')), 160), ''),
    nullif(p_payload->>'completion_year', '')::integer,
    nullif(left(trim(coalesce(p_payload->>'interests', '')), 1000), ''),
    nullif(left(trim(coalesce(p_payload->>'career_goal', '')), 1000), ''),
    nullif(left(trim(coalesce(p_payload->>'referral_source', '')), 160), ''),
    nullif(left(trim(coalesce(p_payload->>'notes', '')), 1000), ''),
    'submitted', now(), now()
  ) on conflict (program_id, student_id) do update set
    full_name = excluded.full_name, email = excluded.email, phone = excluded.phone,
    date_of_birth = excluded.date_of_birth, gender = excluded.gender, city = excluded.city,
    country = excluded.country, address = excluded.address, guardian_name = excluded.guardian_name,
    guardian_phone = excluded.guardian_phone, education_level = excluded.education_level,
    institution = excluded.institution, field_of_study = excluded.field_of_study,
    completion_year = excluded.completion_year, interests = excluded.interests,
    career_goal = excluded.career_goal, referral_source = excluded.referral_source,
    notes = excluded.notes, updated_at = now()
  returning id into v_application_id;

  insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
  values (v_batch_id, p_student_id, 'demo', 0, 'Orientation session — no fee')
  on conflict (batch_id, student_id) do nothing;
  return v_application_id;
end;
$$;
revoke all on function public.submit_orientation_application(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_orientation_application(uuid, text, jsonb) to service_role;

-- Existing signup behaviour is unchanged unless the explicit orientation marker
-- is present in the submitted user metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name','New User'), 'student');
  if coalesce(new.raw_user_meta_data->>'orientation_program', '') = 'iac-orientation' then
    perform public.submit_orientation_application(new.id, new.email, new.raw_user_meta_data);
  end if;
  return new;
end;
$$;
