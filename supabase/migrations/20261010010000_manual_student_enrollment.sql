-- Academic enrollment is an explicit administrative decision. Student profile
-- preferences remain available for filtering and recommendations, but must not
-- create enrollments when a profile or batch is saved.

drop trigger if exists trg_auto_enroll_students_for_batch on public.batches;

create or replace function public.auto_enroll_profile_into_matching_batches(p_student_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return 0;
end;
$$;

create or replace function public.auto_enroll_students_for_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

revoke all on function public.auto_enroll_profile_into_matching_batches(uuid) from public, anon, authenticated;
revoke all on function public.auto_enroll_students_for_batch() from public, anon, authenticated;

comment on function public.auto_enroll_profile_into_matching_batches(uuid) is
  'Legacy compatibility stub. Academic enrollments require an explicit admin action.';

-- Orientation registration may use an existing administrator-created cohort,
-- but it must never provision another batch as a side effect of registration.
create or replace function public.assign_orientation_application(p_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.orientation_applications%rowtype;
  v_target_id uuid;
begin
  select * into v_application
  from public.orientation_applications
  where id = p_application_id
  for update;
  if v_application.id is null then raise exception 'Orientation application not found'; end if;
  if v_application.cohort_id is not null then return v_application.cohort_id; end if;

  select c.id into v_target_id
  from public.orientation_cohorts c
  where c.program_id = v_application.program_id
    and c.session_state = 'registration_open'
  order by
    case when (select count(*) from public.orientation_applications a where a.cohort_id = c.id) < c.capacity then 0 else 1 end,
    (select count(*) from public.orientation_applications a where a.cohort_id = c.id),
    c.position, c.created_at
  limit 1;

  if v_target_id is null then
    raise exception 'No administrator-created orientation cohort is available';
  end if;
  perform public.move_orientation_application(v_application.id, v_target_id, auth.uid());
  return v_target_id;
end;
$$;

revoke all on function public.create_next_orientation_cohort(uuid) from public, anon, authenticated;
