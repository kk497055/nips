-- NIPS Portal — event-driven orientation cohort autoscaling.
-- Additive only: raises open-cohort capacity to 90 and moves existing enrolment
-- rows transactionally when unscheduled cohorts are balanced. No records are removed.

alter table public.orientation_cohorts
  alter column capacity set default 90;

update public.orientation_cohorts
set capacity = 90, updated_at = now()
where capacity = 50;

create or replace function public.orientation_cohort_suffix(p_position integer)
returns text
language sql immutable strict set search_path = public as $$
  select case
    when p_position between 1 and 26 then chr(64 + p_position)
    else p_position::text
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
  if v_program.id is null then raise exception 'Active orientation program not found'; end if;

  select coalesce(max(position), 0) + 1 into v_position
  from public.orientation_cohorts
  where program_id = p_program_id;
  v_suffix := public.orientation_cohort_suffix(v_position);

  insert into public.batches (
    name, category, schedule, jitsi_room, fee, is_active, monthly_billing_enabled
  ) values (
    'IAC Orientation — Cohort ' || v_suffix,
    'Institute of Arts and Culture',
    'Orientation session — schedule to be announced',
    'iac-orientation-' || lower(v_suffix),
    0, true, false
  ) returning id into v_batch_id;

  insert into public.orientation_cohorts (
    program_id, code, name, batch_id, capacity, position, session_state
  ) values (
    p_program_id,
    'cohort-' || lower(v_suffix),
    'IAC Orientation — Cohort ' || v_suffix,
    v_batch_id, 90, v_position, 'registration_open'
  ) returning id into v_cohort_id;

  return v_cohort_id;
end;
$$;

create or replace function public.move_orientation_application(
  p_application_id uuid,
  p_target_cohort_id uuid,
  p_changed_by uuid default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_application public.orientation_applications%rowtype;
  v_target public.orientation_cohorts%rowtype;
  v_old_batch_id uuid;
begin
  select * into v_application
  from public.orientation_applications
  where id = p_application_id
  for update;
  select * into v_target
  from public.orientation_cohorts
  where id = p_target_cohort_id
  for update;
  if v_application.id is null or v_target.id is null then raise exception 'Application or cohort not found'; end if;
  if v_application.program_id <> v_target.program_id then raise exception 'Application and cohort belong to different programs'; end if;
  if v_application.cohort_id is not distinct from v_target.id then return false; end if;

  select c.batch_id into v_old_batch_id
  from public.orientation_cohorts c
  where c.id = v_application.cohort_id;

  if exists (
    select 1 from public.enrollments e
    where e.student_id = v_application.student_id and e.batch_id = v_target.batch_id
  ) then
    if v_old_batch_id is not null and exists (
      select 1 from public.enrollments e
      where e.student_id = v_application.student_id and e.batch_id = v_old_batch_id
    ) then
      raise exception 'Student already has enrolments in both source and target cohorts';
    end if;
  elsif v_old_batch_id is not null and exists (
    select 1 from public.enrollments e
    where e.student_id = v_application.student_id and e.batch_id = v_old_batch_id
  ) then
    update public.enrollments
    set batch_id = v_target.batch_id
    where student_id = v_application.student_id and batch_id = v_old_batch_id;
  else
    insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
    values (v_target.batch_id, v_application.student_id, 'demo', 0, 'Orientation session — no fee')
    on conflict (batch_id, student_id) do nothing;
  end if;

  update public.orientation_applications
  set cohort_id = v_target.id, updated_at = now()
  where id = v_application.id;
  insert into public.orientation_cohort_audit (
    application_id, from_cohort_id, to_cohort_id, changed_by
  ) values (
    v_application.id, v_application.cohort_id, v_target.id, p_changed_by
  );
  return true;
end;
$$;

create or replace function public.rebalance_open_orientation_cohorts(
  p_program_id uuid,
  p_changed_by uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_cohort_ids uuid[];
  v_capacity integer;
  v_application_count integer;
  v_row record;
  v_target_id uuid;
  v_moved integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_program_id::text, 0));
  select array_agg(id order by position, created_at), coalesce(sum(capacity), 0)
  into v_cohort_ids, v_capacity
  from public.orientation_cohorts
  where program_id = p_program_id and session_state = 'registration_open';
  if coalesce(array_length(v_cohort_ids, 1), 0) = 0 then return 0; end if;

  select count(*) into v_application_count
  from public.orientation_applications a
  where a.program_id = p_program_id
    and (a.cohort_id is null or a.cohort_id = any(v_cohort_ids));
  if v_application_count > v_capacity then raise exception 'Open orientation cohort capacity is insufficient'; end if;

  for v_row in
    select a.id, row_number() over (order by a.submitted_at, a.id) as rn
    from public.orientation_applications a
    where a.program_id = p_program_id
      and (a.cohort_id is null or a.cohort_id = any(v_cohort_ids))
    order by a.submitted_at, a.id
  loop
    v_target_id := v_cohort_ids[((v_row.rn - 1) % array_length(v_cohort_ids, 1)) + 1];
    if public.move_orientation_application(v_row.id, v_target_id, p_changed_by) then
      v_moved := v_moved + 1;
    end if;
  end loop;
  return v_moved;
end;
$$;

create or replace function public.assign_orientation_application(p_application_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_application public.orientation_applications%rowtype;
  v_program_id uuid;
  v_target_id uuid;
  v_created boolean := false;
begin
  select program_id into v_program_id
  from public.orientation_applications
  where id = p_application_id;
  if v_program_id is null then raise exception 'Orientation application not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_program_id::text, 0));

  select * into v_application
  from public.orientation_applications
  where id = p_application_id
  for update;
  if v_application.cohort_id is not null then return v_application.cohort_id; end if;
  select c.id into v_target_id
  from public.orientation_cohorts c
  where c.program_id = v_application.program_id
    and c.session_state = 'registration_open'
    and (select count(*) from public.orientation_applications a where a.cohort_id = c.id) < c.capacity
  order by (select count(*) from public.orientation_applications a where a.cohort_id = c.id), c.position, c.created_at
  limit 1;

  if v_target_id is null then
    v_target_id := public.create_next_orientation_cohort(v_application.program_id);
    v_created := true;
  end if;
  perform public.move_orientation_application(v_application.id, v_target_id, auth.uid());

  if v_created then
    perform public.rebalance_open_orientation_cohorts(v_application.program_id, auth.uid());
    select cohort_id into v_target_id
    from public.orientation_applications
    where id = v_application.id;
  end if;
  return v_target_id;
end;
$$;

create or replace function public.auto_assign_orientation_cohorts(p_program_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_app record;
  v_total integer := 0;
begin
  if not public.is_admin() then raise exception 'Forbidden'; end if;
  for v_app in
    select id from public.orientation_applications
    where program_id = p_program_id and cohort_id is null
    order by submitted_at, id
  loop
    perform public.assign_orientation_application(v_app.id);
    v_total := v_total + 1;
  end loop;
  perform public.rebalance_open_orientation_cohorts(p_program_id, auth.uid());
  return v_total;
end;
$$;

-- Use the event-driven assignment inside the existing verified registration RPC.
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
    v_cohort_id := public.assign_orientation_application(v_application_id);
  end if;
  select batch_id into v_batch_id from public.orientation_cohorts where id = v_cohort_id;
  if v_batch_id is null then raise exception 'Orientation cohort assignment failed'; end if;
  insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
  values (v_batch_id, p_student_id, 'demo', 0, 'Orientation session — no fee')
  on conflict (batch_id, student_id) do nothing;
  return v_application_id;
end;
$$;

-- Reconcile existing live data after raising capacity. With 114 unscheduled
-- registrations this produces two balanced cohorts of 57 without removing rows.
do $$
declare
  v_program_id uuid;
  v_app record;
begin
  select id into v_program_id
  from public.orientation_programs
  where code = 'iac-orientation';
  if v_program_id is not null then
    for v_app in
      select id from public.orientation_applications
      where program_id = v_program_id and cohort_id is null
      order by submitted_at, id
    loop
      perform public.assign_orientation_application(v_app.id);
    end loop;
    perform public.rebalance_open_orientation_cohorts(v_program_id, null);
  end if;
end $$;

revoke all on function public.orientation_cohort_suffix(integer) from public, anon, authenticated;
revoke all on function public.create_next_orientation_cohort(uuid) from public, anon, authenticated;
revoke all on function public.move_orientation_application(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rebalance_open_orientation_cohorts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assign_orientation_application(uuid) from public, anon, authenticated;
revoke all on function public.auto_assign_orientation_cohorts(uuid) from public, anon, authenticated;
revoke all on function public.submit_orientation_application(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.auto_assign_orientation_cohorts(uuid) to authenticated;
grant execute on function public.submit_orientation_application(uuid, text, jsonb) to service_role;
