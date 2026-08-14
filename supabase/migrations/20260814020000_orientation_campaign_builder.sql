-- NIPS Portal — reusable orientation campaigns and configurable registration forms.
-- Additive only: the live IAC campaign, registrations, cohorts, and enrolments remain intact.

alter table public.orientation_programs
  add column if not exists public_slug text,
  add column if not exists project_name text,
  add column if not exists description text,
  add column if not exists campaign_status text not null default 'published'
    check (campaign_status in ('draft','published','closed','archived')),
  add column if not exists form_config jsonb not null default '{"fields":{}}'::jsonb,
  add column if not exists registration_opens_at timestamptz,
  add column if not exists registration_closes_at timestamptz,
  add column if not exists timezone text not null default 'Asia/Karachi',
  add column if not exists default_cohort_capacity integer not null default 90
    check (default_cohort_capacity between 1 and 90),
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create unique index if not exists orientation_programs_public_slug_unique
  on public.orientation_programs (lower(public_slug))
  where public_slug is not null;

alter table public.orientation_applications
  add column if not exists custom_answers jsonb not null default '{}'::jsonb;

alter table public.orientation_cohorts
  add column if not exists scheduled_at timestamptz,
  add column if not exists duration_minutes integer not null default 60
    check (duration_minutes between 15 and 480);

update public.orientation_programs
set public_slug = coalesce(public_slug, 'iac-orientation'),
    project_name = coalesce(project_name, 'Institute of Arts and Culture'),
    description = coalesce(description, 'Complete this form to create your NIPS Portal account and reserve your place in the Institute of Arts and Culture orientation session. Orientation is free; paid course selection happens later with the NIPS team.'),
    campaign_status = 'published',
    timezone = coalesce(timezone, 'Asia/Karachi'),
    default_cohort_capacity = 90,
    form_config = case
      when form_config = '{"fields":{}}'::jsonb then jsonb_build_object(
        'fields', jsonb_build_object(
          'date_of_birth', jsonb_build_object('enabled', true, 'required', false),
          'gender', jsonb_build_object('enabled', true, 'required', false),
          'city', jsonb_build_object('enabled', true, 'required', true),
          'country', jsonb_build_object('enabled', true, 'required', true),
          'address', jsonb_build_object('enabled', true, 'required', false),
          'guardian_name', jsonb_build_object('enabled', true, 'required', false),
          'guardian_phone', jsonb_build_object('enabled', true, 'required', false),
          'education_level', jsonb_build_object('enabled', true, 'required', true),
          'institution', jsonb_build_object('enabled', true, 'required', true),
          'field_of_study', jsonb_build_object('enabled', true, 'required', true),
          'completion_year', jsonb_build_object('enabled', true, 'required', false),
          'interests', jsonb_build_object('enabled', true, 'required', true),
          'career_goal', jsonb_build_object('enabled', true, 'required', false),
          'referral_source', jsonb_build_object('enabled', true, 'required', false),
          'notes', jsonb_build_object('enabled', true, 'required', false)
        ),
        'custom_questions', '[]'::jsonb,
        'consent_text', 'I confirm that the information I have provided is accurate and I agree that NIPS may use it to manage my orientation and course enrolment.'
      )
      else form_config
    end
where code = 'iac-orientation';

create or replace function public.get_public_orientation_campaign(p_slug text default null)
returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id,
    'code', p.code,
    'slug', p.public_slug,
    'name', p.name,
    'project_name', p.project_name,
    'description', p.description,
    'status', p.campaign_status,
    'timezone', p.timezone,
    'form_config', p.form_config,
    'registration_opens_at', p.registration_opens_at,
    'registration_closes_at', p.registration_closes_at,
    'accepting_registrations', (
      p.is_active
      and p.campaign_status = 'published'
      and (p.registration_opens_at is null or p.registration_opens_at <= now())
      and (p.registration_closes_at is null or p.registration_closes_at > now())
    )
  )
  from public.orientation_programs p
  where p.campaign_status in ('published','closed')
    and (
      (nullif(lower(trim(p_slug)), '') is not null and lower(p.public_slug) = lower(trim(p_slug)))
      or (nullif(trim(p_slug), '') is null and p.code = 'iac-orientation')
    )
  limit 1;
$$;

create or replace function public.create_orientation_campaign(
  p_name text,
  p_project_name text,
  p_slug text,
  p_description text,
  p_form_config jsonb,
  p_registration_opens_at timestamptz,
  p_registration_closes_at timestamptz,
  p_timezone text,
  p_capacity integer,
  p_publish boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_name text := left(trim(coalesce(p_name, '')), 200);
  v_project text := left(trim(coalesce(p_project_name, '')), 160);
  v_timezone text := left(trim(coalesce(p_timezone, 'Asia/Karachi')), 80);
  v_batch_id uuid;
  v_program_id uuid;
begin
  if not public.is_admin() then raise exception 'Forbidden'; end if;
  if v_name = '' or v_project = '' then raise exception 'Campaign and project names are required'; end if;
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Use lowercase letters, numbers, and hyphens for the public link'; end if;
  if p_capacity not between 1 and 90 then raise exception 'Cohort capacity must be between 1 and 90'; end if;
  if p_registration_closes_at is not null and p_registration_opens_at is not null
     and p_registration_closes_at <= p_registration_opens_at then
    raise exception 'Registration closing time must be after its opening time';
  end if;
  if coalesce(jsonb_typeof(p_form_config->'fields'), '') <> 'object'
     or coalesce(jsonb_typeof(p_form_config->'custom_questions'), '') <> 'array' then
    raise exception 'Invalid form configuration';
  end if;
  if exists (select 1 from public.orientation_programs where lower(public_slug) = v_slug or lower(code) = v_slug) then
    raise exception 'That campaign link is already in use';
  end if;

  insert into public.batches (
    name, category, schedule, jitsi_room, fee, is_active, monthly_billing_enabled
  ) values (
    v_name || ' — Cohort A', v_project,
    'Orientation session — schedule to be announced',
    'orientation-' || v_slug || '-a', 0, true, false
  ) returning id into v_batch_id;

  insert into public.orientation_programs (
    code, public_slug, name, project_name, description, batch_id, is_active,
    campaign_status, form_config, registration_opens_at, registration_closes_at,
    timezone, default_cohort_capacity, created_by
  ) values (
    v_slug, v_slug, v_name, v_project, nullif(left(trim(p_description), 1200), ''),
    v_batch_id, true, case when p_publish then 'published' else 'draft' end,
    p_form_config, p_registration_opens_at, p_registration_closes_at,
    v_timezone, p_capacity, auth.uid()
  ) returning id into v_program_id;

  insert into public.orientation_cohorts (
    program_id, code, name, batch_id, capacity, position, session_state
  ) values (
    v_program_id, 'cohort-a', v_name || ' — Cohort A', v_batch_id,
    p_capacity, 1, 'registration_open'
  );
  return v_program_id;
end;
$$;

create or replace function public.update_orientation_campaign_status(
  p_program_id uuid,
  p_status text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Forbidden'; end if;
  if p_status not in ('draft','published','closed','archived') then raise exception 'Invalid campaign status'; end if;
  update public.orientation_programs
  set campaign_status = p_status,
      is_active = p_status in ('draft','published','closed')
  where id = p_program_id;
  if not found then raise exception 'Orientation campaign not found'; end if;
end;
$$;

create or replace function public.create_next_orientation_cohort(p_program_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_program public.orientation_programs%rowtype;
  v_position integer;
  v_suffix text;
  v_batch_id uuid;
  v_cohort_id uuid;
begin
  select * into v_program
  from public.orientation_programs
  where id = p_program_id and is_active = true
  for update;
  if v_program.id is null then raise exception 'Active orientation campaign not found'; end if;
  select coalesce(max(position), 0) + 1 into v_position
  from public.orientation_cohorts where program_id = p_program_id;
  v_suffix := public.orientation_cohort_suffix(v_position);

  insert into public.batches (
    name, category, schedule, jitsi_room, fee, is_active, monthly_billing_enabled
  ) values (
    v_program.name || ' — Cohort ' || v_suffix,
    coalesce(v_program.project_name, v_program.name),
    'Orientation session — schedule to be announced',
    'orientation-' || coalesce(v_program.public_slug, v_program.code) || '-' || lower(v_suffix),
    0, true, false
  ) returning id into v_batch_id;
  insert into public.orientation_cohorts (
    program_id, code, name, batch_id, capacity, position, session_state
  ) values (
    p_program_id, 'cohort-' || lower(v_suffix),
    v_program.name || ' — Cohort ' || v_suffix,
    v_batch_id, v_program.default_cohort_capacity, v_position, 'registration_open'
  ) returning id into v_cohort_id;
  return v_cohort_id;
end;
$$;

create or replace function public.update_orientation_cohort_settings_v2(
  p_cohort_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_teacher_id uuid,
  p_meet_url text,
  p_calendar_event_url text,
  p_session_state text,
  p_student_message text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cohort public.orientation_cohorts%rowtype;
  v_timezone text;
  v_schedule text;
begin
  if not public.is_admin() then raise exception 'Forbidden'; end if;
  select c.* into v_cohort
  from public.orientation_cohorts c
  where c.id = p_cohort_id
  for update;
  if v_cohort.id is null then raise exception 'Cohort not found'; end if;
  select timezone into v_timezone
  from public.orientation_programs
  where id = v_cohort.program_id;
  if p_session_state not in ('registration_open','scheduled','live','completed') then raise exception 'Invalid session stage'; end if;
  if p_duration_minutes not between 15 and 480 then raise exception 'Duration must be between 15 and 480 minutes'; end if;
  if p_session_state in ('scheduled','live') and (p_scheduled_at is null or p_teacher_id is null) then
    raise exception 'Set the teacher and session date/time before announcing this cohort';
  end if;
  if p_session_state = 'live' and coalesce(trim(p_meet_url), '') !~* '^https://meet\.google\.com/[a-z0-9-]+([/?].*)?$' then
    raise exception 'A valid Google Meet link is required before going live';
  end if;
  v_schedule := case when p_scheduled_at is null then 'Orientation session — schedule to be announced'
    else to_char(p_scheduled_at at time zone v_timezone, 'FMDay, FMMonth DD, YYYY · HH12:MI AM') || ' ' || v_timezone end;

  update public.batches
  set schedule = v_schedule, teacher_id = p_teacher_id
  where id = v_cohort.batch_id;
  update public.orientation_cohorts
  set scheduled_at = p_scheduled_at,
      duration_minutes = p_duration_minutes,
      meet_url = nullif(trim(p_meet_url), ''),
      calendar_event_url = nullif(trim(p_calendar_event_url), ''),
      session_state = p_session_state,
      student_message = nullif(left(trim(p_student_message), 500), ''),
      session_announced_at = case when p_session_state in ('scheduled','live') then coalesce(session_announced_at, now()) else session_announced_at end,
      session_completed_at = case when p_session_state = 'completed' then coalesce(session_completed_at, now()) else session_completed_at end,
      updated_at = now()
  where id = p_cohort_id;
end;
$$;

create or replace function public.submit_orientation_application(
  p_student_id uuid,
  p_email text,
  p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_program_id uuid;
  v_application_id uuid;
  v_cohort_id uuid;
  v_batch_id uuid;
  v_campaign text := lower(left(trim(coalesce(p_payload->>'orientation_program', '')), 120));
  v_name text := left(trim(coalesce(p_payload->>'full_name', '')), 160);
  v_phone text := left(trim(coalesce(p_payload->>'phone', '')), 50);
  v_email text := lower(left(trim(coalesce(p_email, '')), 254));
  v_form_config jsonb;
  v_field record;
  v_question jsonb;
begin
  if v_campaign = '' then raise exception 'Unknown orientation campaign'; end if;
  if v_name = '' or v_phone = '' or v_email = '' then raise exception 'Name, email, and phone are required'; end if;
  select id, form_config into v_program_id, v_form_config
  from public.orientation_programs
  where (lower(code) = v_campaign or lower(public_slug) = v_campaign)
    and is_active = true and campaign_status = 'published'
    and (registration_opens_at is null or registration_opens_at <= now())
    and (registration_closes_at is null or registration_closes_at > now())
  limit 1;
  if v_program_id is null then raise exception 'Orientation registration is not available'; end if;
  for v_field in select key, value from jsonb_each(coalesce(v_form_config->'fields', '{}'::jsonb))
  loop
    if coalesce((v_field.value->>'enabled')::boolean, false)
       and coalesce((v_field.value->>'required')::boolean, false)
       and nullif(trim(coalesce(p_payload->>v_field.key, '')), '') is null then
      raise exception 'Please complete the required field: %', replace(v_field.key, '_', ' ');
    end if;
  end loop;
  for v_question in select value from jsonb_array_elements(coalesce(v_form_config->'custom_questions', '[]'::jsonb))
  loop
    if coalesce((v_question->>'required')::boolean, false)
       and nullif(trim(coalesce(p_payload->'custom_answers'->>(v_question->>'id'), '')), '') is null then
      raise exception 'Please answer the required question: %', left(v_question->>'label', 160);
    end if;
  end loop;

  update public.profiles set full_name = v_name where id = p_student_id;
  insert into public.student_contacts (student_id, phone, email, guardian_phone)
  values (p_student_id, v_phone, v_email, nullif(left(trim(coalesce(p_payload->>'guardian_phone', '')), 50), ''))
  on conflict (student_id) do update set phone = excluded.phone, email = excluded.email, guardian_phone = excluded.guardian_phone;

  insert into public.orientation_applications (
    program_id, student_id, full_name, email, phone, date_of_birth, gender, city, country, address,
    guardian_name, guardian_phone, education_level, institution, field_of_study, completion_year,
    interests, career_goal, referral_source, notes, custom_answers, status, submitted_at, updated_at
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
    case when jsonb_typeof(p_payload->'custom_answers') = 'object' then p_payload->'custom_answers' else '{}'::jsonb end,
    'submitted', now(), now()
  ) on conflict (program_id, student_id) do update set
    full_name = excluded.full_name, email = excluded.email, phone = excluded.phone,
    date_of_birth = excluded.date_of_birth, gender = excluded.gender, city = excluded.city,
    country = excluded.country, address = excluded.address, guardian_name = excluded.guardian_name,
    guardian_phone = excluded.guardian_phone, education_level = excluded.education_level,
    institution = excluded.institution, field_of_study = excluded.field_of_study,
    completion_year = excluded.completion_year, interests = excluded.interests,
    career_goal = excluded.career_goal, referral_source = excluded.referral_source,
    notes = excluded.notes, custom_answers = excluded.custom_answers, updated_at = now()
  returning id, cohort_id into v_application_id, v_cohort_id;

  if v_cohort_id is null then v_cohort_id := public.assign_orientation_application(v_application_id); end if;
  select batch_id into v_batch_id from public.orientation_cohorts where id = v_cohort_id;
  if v_batch_id is null then raise exception 'Orientation cohort assignment failed'; end if;
  insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
  values (v_batch_id, p_student_id, 'demo', 0, 'Orientation session — no fee')
  on conflict (batch_id, student_id) do nothing;
  return v_application_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_campaign text := lower(trim(coalesce(new.raw_user_meta_data->>'orientation_program', '')));
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name','New User'), 'student');
  if v_campaign <> '' and exists (
    select 1 from public.orientation_programs
    where (lower(code) = v_campaign or lower(public_slug) = v_campaign)
      and is_active = true and campaign_status = 'published'
  ) then
    perform public.submit_orientation_application(new.id, new.email, new.raw_user_meta_data);
  end if;
  return new;
end;
$$;

revoke all on function public.get_public_orientation_campaign(text) from public, anon, authenticated;
revoke all on function public.create_orientation_campaign(text, text, text, text, jsonb, timestamptz, timestamptz, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.update_orientation_campaign_status(uuid, text) from public, anon, authenticated;
revoke all on function public.update_orientation_cohort_settings_v2(uuid, timestamptz, integer, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.submit_orientation_application(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.get_public_orientation_campaign(text) to anon, authenticated;
grant execute on function public.create_orientation_campaign(text, text, text, text, jsonb, timestamptz, timestamptz, text, integer, boolean) to authenticated;
grant execute on function public.update_orientation_campaign_status(uuid, text) to authenticated;
grant execute on function public.update_orientation_cohort_settings_v2(uuid, timestamptz, integer, uuid, text, text, text, text) to authenticated;
grant execute on function public.submit_orientation_application(uuid, text, jsonb) to service_role;
