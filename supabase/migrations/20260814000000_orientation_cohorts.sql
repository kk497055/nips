-- NIPS Portal — split IAC orientation into capacity-controlled cohorts.
-- Additive only: existing registrations and enrolment rows are reassigned, not deleted.

create table if not exists public.orientation_cohorts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.orientation_programs(id) on delete restrict,
  code text not null,
  name text not null,
  batch_id uuid not null unique references public.batches(id) on delete restrict,
  capacity integer not null default 50 check (capacity between 1 and 100),
  position integer not null default 0,
  session_state text not null default 'registration_open'
    check (session_state in ('registration_open','scheduled','live','completed')),
  student_message text,
  meet_url text,
  calendar_event_url text,
  session_announced_at timestamptz,
  session_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, code)
);

alter table public.orientation_applications
  add column if not exists cohort_id uuid references public.orientation_cohorts(id) on delete restrict;
create index if not exists orientation_applications_cohort_idx
  on public.orientation_applications (cohort_id, submitted_at);

create table if not exists public.orientation_cohort_audit (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.orientation_applications(id) on delete cascade,
  from_cohort_id uuid references public.orientation_cohorts(id) on delete restrict,
  to_cohort_id uuid not null references public.orientation_cohorts(id) on delete restrict,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

do $$
declare
  v_program_id uuid;
  v_batch_a uuid;
  v_batch_b uuid;
begin
  select id, batch_id into v_program_id, v_batch_a
  from public.orientation_programs where code = 'iac-orientation';
  if v_program_id is null then raise exception 'IAC orientation program is missing'; end if;

  update public.batches
  set name = 'IAC Orientation — Cohort A'
  where id = v_batch_a and name = 'Institute of Arts and Culture Orientation';

  insert into public.batches (name, category, schedule, jitsi_room, fee, is_active, monthly_billing_enabled)
  select 'IAC Orientation — Cohort B', 'Institute of Arts and Culture',
         'Orientation session — schedule to be announced', 'iac-orientation-b', 0, true, false
  where not exists (
    select 1 from public.batches where jitsi_room = 'iac-orientation-b'
  );
  select id into v_batch_b from public.batches where jitsi_room = 'iac-orientation-b' order by created_at limit 1;

  insert into public.orientation_cohorts (
    program_id, code, name, batch_id, capacity, position, session_state,
    student_message, session_announced_at, session_completed_at
  )
  select p.id, 'cohort-a', 'IAC Orientation — Cohort A', p.batch_id, 50, 1,
         p.session_state, p.student_message, p.session_announced_at, p.session_completed_at
  from public.orientation_programs p
  where p.id = v_program_id
  on conflict (program_id, code) do nothing;

  insert into public.orientation_cohorts (program_id, code, name, batch_id, capacity, position)
  values (v_program_id, 'cohort-b', 'IAC Orientation — Cohort B', v_batch_b, 50, 2)
  on conflict (program_id, code) do nothing;
end $$;

-- Existing applicants are split evenly by registration time, up to 100 total.
with ranked as (
  select a.id,
         row_number() over (order by a.submitted_at, a.id) as rn,
         least(count(*) over (), 100)::integer as assignable
  from public.orientation_applications a
  join public.orientation_programs p on p.id = a.program_id
  where p.code = 'iac-orientation' and a.cohort_id is null
), targets as (
  select r.id,
         case
           when r.rn <= ceil(r.assignable / 2.0) then ca.id
           when r.rn <= r.assignable then cb.id
           else null
         end as cohort_id
  from ranked r
  cross join public.orientation_cohorts ca
  cross join public.orientation_cohorts cb
  join public.orientation_programs p on p.id = ca.program_id and p.id = cb.program_id
  where p.code = 'iac-orientation' and ca.code = 'cohort-a' and cb.code = 'cohort-b'
)
update public.orientation_applications a
set cohort_id = t.cohort_id, updated_at = now()
from targets t where a.id = t.id and t.cohort_id is not null;

-- Move the existing demo enrolment row to the assigned cohort batch. No row is deleted.
update public.enrollments e
set batch_id = c.batch_id
from public.orientation_applications a
join public.orientation_cohorts c on c.id = a.cohort_id
join public.orientation_programs p on p.id = a.program_id
where e.student_id = a.student_id
  and e.batch_id = p.batch_id
  and e.batch_id <> c.batch_id
  and not exists (
    select 1 from public.enrollments target
    where target.student_id = a.student_id and target.batch_id = c.batch_id
  );

insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
select c.batch_id, a.student_id, 'demo', 0, 'Orientation session — no fee'
from public.orientation_applications a
join public.orientation_cohorts c on c.id = a.cohort_id
where not exists (
  select 1 from public.enrollments e where e.batch_id = c.batch_id and e.student_id = a.student_id
)
on conflict (batch_id, student_id) do nothing;

alter table public.orientation_cohorts enable row level security;
alter table public.orientation_cohort_audit enable row level security;

create policy orientation_cohorts_admin on public.orientation_cohorts
  for all using (public.is_admin()) with check (public.is_admin());
create policy orientation_cohorts_teacher on public.orientation_cohorts
  for select using (public.teaches_batch(batch_id));
create policy orientation_cohort_audit_admin on public.orientation_cohort_audit
  for select using (public.is_admin());

create or replace function public.bulk_assign_orientation_cohort(
  p_application_ids uuid[], p_cohort_id uuid
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_target public.orientation_cohorts%rowtype;
  v_current_count integer;
  v_move_count integer;
  v_moved integer := 0;
  v_old_cohort_id uuid;
  v_old_batch_id uuid;
  v_row record;
begin
  if not public.is_admin() then raise exception 'Forbidden'; end if;
  if coalesce(array_length(p_application_ids, 1), 0) = 0 then return 0; end if;
  select * into v_target from public.orientation_cohorts where id = p_cohort_id for update;
  if v_target.id is null then raise exception 'Cohort not found'; end if;

  select count(*) into v_current_count
  from public.orientation_applications
  where cohort_id = p_cohort_id and not (id = any(p_application_ids));
  select count(*) into v_move_count
  from public.orientation_applications
  where id = any(p_application_ids) and program_id = v_target.program_id;
  if v_current_count + v_move_count > v_target.capacity then
    raise exception 'Cohort capacity exceeded (% of % places would be used)', v_current_count + v_move_count, v_target.capacity;
  end if;

  for v_row in
    select a.*, p.batch_id as legacy_batch_id
    from public.orientation_applications a
    join public.orientation_programs p on p.id = a.program_id
    where a.id = any(p_application_ids) and a.program_id = v_target.program_id
    for update of a
  loop
    v_old_cohort_id := v_row.cohort_id;
    select batch_id into v_old_batch_id from public.orientation_cohorts where id = v_old_cohort_id;
    v_old_batch_id := coalesce(v_old_batch_id, v_row.legacy_batch_id);

    if v_old_batch_id <> v_target.batch_id then
      if exists (
        select 1 from public.enrollments
        where student_id = v_row.student_id and batch_id = v_target.batch_id
      ) then
        raise exception 'A selected student is already enrolled in the target cohort';
      end if;
      update public.enrollments
      set batch_id = v_target.batch_id
      where student_id = v_row.student_id and batch_id = v_old_batch_id;
      if not found then
        insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
        values (v_target.batch_id, v_row.student_id, 'demo', 0, 'Orientation session — no fee');
      end if;
    end if;

    update public.orientation_applications
    set cohort_id = v_target.id, updated_at = now()
    where id = v_row.id;
    if v_old_cohort_id is distinct from v_target.id then
      insert into public.orientation_cohort_audit (application_id, from_cohort_id, to_cohort_id, changed_by)
      values (v_row.id, v_old_cohort_id, v_target.id, auth.uid());
      v_moved := v_moved + 1;
    end if;
  end loop;
  return v_moved;
end;
$$;

create or replace function public.auto_assign_orientation_cohorts(p_program_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_app record;
  v_target_id uuid;
  v_total integer := 0;
begin
  if not public.is_admin() then raise exception 'Forbidden'; end if;
  for v_app in
    select id from public.orientation_applications
    where program_id = p_program_id and cohort_id is null
    order by submitted_at, id
  loop
    select c.id into v_target_id
    from public.orientation_cohorts c
    where c.program_id = p_program_id
      and (select count(*) from public.orientation_applications a where a.cohort_id = c.id) < c.capacity
    order by (select count(*) from public.orientation_applications a where a.cohort_id = c.id), c.position, c.created_at
    limit 1;
    exit when v_target_id is null;
    perform public.bulk_assign_orientation_cohort(array[v_app.id], v_target_id);
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;

create or replace function public.update_orientation_cohort_settings(
  p_cohort_id uuid,
  p_schedule text,
  p_teacher_id uuid,
  p_meet_url text,
  p_calendar_event_url text,
  p_session_state text,
  p_student_message text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cohort public.orientation_cohorts%rowtype;
begin
  if not public.is_admin() then raise exception 'Forbidden'; end if;
  select * into v_cohort from public.orientation_cohorts where id = p_cohort_id for update;
  if v_cohort.id is null then raise exception 'Cohort not found'; end if;
  if p_session_state not in ('registration_open','scheduled','live','completed') then raise exception 'Invalid session stage'; end if;
  if p_session_state in ('scheduled','live') and (nullif(trim(p_schedule), '') is null or p_teacher_id is null) then
    raise exception 'Set the teacher and session date/time before announcing this cohort';
  end if;
  if p_session_state = 'live' and coalesce(trim(p_meet_url), '') !~* '^https://meet\.google\.com/[a-z0-9-]+([/?].*)?$' then
    raise exception 'A valid Google Meet link is required before going live';
  end if;

  update public.batches
  set schedule = nullif(trim(p_schedule), ''), teacher_id = p_teacher_id
  where id = v_cohort.batch_id;
  update public.orientation_cohorts
  set meet_url = nullif(trim(p_meet_url), ''),
      calendar_event_url = nullif(trim(p_calendar_event_url), ''),
      session_state = p_session_state,
      student_message = nullif(trim(p_student_message), ''),
      session_announced_at = case when p_session_state in ('scheduled','live') then coalesce(session_announced_at, now()) else session_announced_at end,
      session_completed_at = case when p_session_state = 'completed' then coalesce(session_completed_at, now()) else session_completed_at end,
      updated_at = now()
  where id = p_cohort_id;
end;
$$;

create or replace function public.get_my_orientation_cohorts()
returns table (
  batch_id uuid,
  name text,
  session_state text,
  student_message text,
  schedule text,
  join_url text
)
language sql security definer stable set search_path = public as $$
  select c.batch_id, c.name, c.session_state, c.student_message, b.schedule,
         case when c.session_state = 'live' then c.meet_url else null end as join_url
  from public.orientation_applications a
  join public.orientation_cohorts c on c.id = a.cohort_id
  join public.batches b on b.id = c.batch_id
  where a.student_id = auth.uid();
$$;

revoke all on function public.bulk_assign_orientation_cohort(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.auto_assign_orientation_cohorts(uuid) from public, anon, authenticated;
revoke all on function public.update_orientation_cohort_settings(uuid, text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_my_orientation_cohorts() from public, anon;
grant execute on function public.bulk_assign_orientation_cohort(uuid[], uuid) to authenticated;
grant execute on function public.auto_assign_orientation_cohorts(uuid) to authenticated;
grant execute on function public.update_orientation_cohort_settings(uuid, text, uuid, text, text, text, text) to authenticated;
grant execute on function public.get_my_orientation_cohorts() to authenticated;

-- Keep future registrations balanced between cohorts with available capacity.
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
  v_name text := left(trim(coalesce(p_payload->>'full_name', '')), 160);
  v_phone text := left(trim(coalesce(p_payload->>'phone', '')), 50);
  v_email text := lower(left(trim(coalesce(p_email, '')), 254));
begin
  if coalesce(p_payload->>'orientation_program', '') <> 'iac-orientation' then raise exception 'Unknown orientation program'; end if;
  if v_name = '' or v_phone = '' or v_email = '' then raise exception 'Name, email, and phone are required'; end if;
  select id into v_program_id from public.orientation_programs where code = 'iac-orientation' and is_active = true;
  if v_program_id is null then raise exception 'Orientation registration is not available'; end if;

  update public.profiles set full_name = v_name where id = p_student_id;
  insert into public.student_contacts (student_id, phone, email, guardian_phone)
  values (p_student_id, v_phone, v_email, nullif(left(trim(coalesce(p_payload->>'guardian_phone', '')), 50), ''))
  on conflict (student_id) do update set phone = excluded.phone, email = excluded.email, guardian_phone = excluded.guardian_phone;

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
  returning id, cohort_id into v_application_id, v_cohort_id;

  if v_cohort_id is null then
    select c.id, c.batch_id into v_cohort_id, v_batch_id
    from public.orientation_cohorts c
    where c.program_id = v_program_id
      and (select count(*) from public.orientation_applications a where a.cohort_id = c.id) < c.capacity
    order by (select count(*) from public.orientation_applications a where a.cohort_id = c.id), c.position, c.created_at
    limit 1;
    if v_cohort_id is not null then
      update public.orientation_applications set cohort_id = v_cohort_id, updated_at = now() where id = v_application_id;
    end if;
  else
    select batch_id into v_batch_id from public.orientation_cohorts where id = v_cohort_id;
  end if;

  if v_cohort_id is not null then
    insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
    values (v_batch_id, p_student_id, 'demo', 0, 'Orientation session — no fee')
    on conflict (batch_id, student_id) do nothing;
  end if;
  return v_application_id;
end;
$$;
revoke all on function public.submit_orientation_application(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_orientation_application(uuid, text, jsonb) to service_role;
