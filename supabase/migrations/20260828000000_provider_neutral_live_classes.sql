-- Provider-neutral live-class links and the first IAC online teaching batch.
-- Additive only: orientation applications, cohort assignments, payments, and
-- existing batch enrollments remain unchanged.

alter table public.batches
  add column if not exists live_class_url text;

alter table public.batches
  add constraint batches_live_class_url_check
  check (live_class_url is null or live_class_url ~* '^https://[^[:space:]]+$');

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
  select timezone into v_timezone from public.orientation_programs where id = v_cohort.program_id;
  if p_session_state not in ('registration_open','scheduled','live','completed') then raise exception 'Invalid session stage'; end if;
  if p_duration_minutes not between 15 and 480 then raise exception 'Duration must be between 15 and 480 minutes'; end if;
  if p_session_state in ('scheduled','live') and (p_scheduled_at is null or p_teacher_id is null) then
    raise exception 'Set the teacher and session date/time before announcing this cohort';
  end if;
  if p_session_state = 'live' and coalesce(trim(p_meet_url), '') !~* '^https://[^[:space:]]+$' then
    raise exception 'A valid HTTPS live-class link is required before going live';
  end if;
  v_schedule := case when p_scheduled_at is null then 'Orientation session — schedule to be announced'
    else to_char(p_scheduled_at at time zone v_timezone, 'FMDay, FMMonth DD, YYYY · HH12:MI AM') || ' ' || v_timezone end;

  update public.batches set schedule = v_schedule, teacher_id = p_teacher_id where id = v_cohort.batch_id;
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

do $$
declare
  v_teacher_id uuid;
  v_teacher_count integer;
  v_batch_id uuid;
  v_enrolled integer;
begin
  select count(*), max(id::text)::uuid into v_teacher_count, v_teacher_id
  from public.profiles
  where role = 'teacher' and lower(trim(full_name)) = 'warda mubashir';
  if v_teacher_count <> 1 then
    raise exception 'Expected exactly one teacher named Warda Mubashir; found %', v_teacher_count;
  end if;

  select id into v_batch_id from public.batches where jitsi_room = 'iac-online-2026-08' limit 1;
  if v_batch_id is null then
    insert into public.batches (
      name, category, teacher_id, schedule, jitsi_room, live_class_url,
      fee, is_active, monthly_billing_enabled
    ) values (
      'Institute of Arts and Culture — Online Classes',
      'Institute of Arts and Culture',
      v_teacher_id,
      'Sat · 19:00 (from 2026-08-29) · Asia/Karachi',
      'iac-online-2026-08',
      'https://us06web.zoom.us/j/87029945495?pwd=QiGLSK51aAFGjj8Zg9zwlmFjxnpJR8.1',
      0, true, false
    ) returning id into v_batch_id;
  else
    update public.batches
    set teacher_id = v_teacher_id,
        schedule = 'Sat · 19:00 (from 2026-08-29) · Asia/Karachi',
        live_class_url = 'https://us06web.zoom.us/j/87029945495?pwd=QiGLSK51aAFGjj8Zg9zwlmFjxnpJR8.1',
        is_active = true
    where id = v_batch_id;
  end if;

  insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
  select distinct v_batch_id, a.student_id, 'demo', 0,
         'Online access transferred from IAC orientation; regular-course fee not yet recorded'
  from public.orientation_applications a
  join public.orientation_cohorts c on c.id = a.cohort_id
  where a.study_mode_preference = 'online'
    and c.code in ('cohort-a', 'cohort-b')
  on conflict (batch_id, student_id) do nothing;
  get diagnostics v_enrolled = row_count;

  insert into public.portal_notifications (
    recipient_id, notification_type, title, message, action_url, delivery_key
  )
  select e.student_id, 'class_schedule', 'Your online classes start tomorrow',
         'Institute of Arts and Culture online classes begin Saturday, August 29 at 7:00 PM Pakistan time. Open My Classes to join.',
         'https://nips.com.pk/portal/student.html?view=classes',
         'batch:' || v_batch_id || ':launch:2026-08-29-1900'
  from public.enrollments e
  where e.batch_id = v_batch_id and e.payment_status in ('paid', 'demo')
  on conflict (recipient_id, delivery_key) do nothing;

  raise notice 'IAC online batch %, newly enrolled online students %', v_batch_id, v_enrolled;
end;
$$;
