-- Expand the existing IAC online class to every student in orientation
-- Cohorts A and B. Additive and idempotent: existing batch enrollments,
-- orientation applications, study-mode choices, and payments are unchanged.

do $$
declare
  v_batch_id uuid;
  v_enrolled integer;
begin
  select id into v_batch_id
  from public.batches
  where jitsi_room = 'iac-online-2026-08'
  limit 1;
  if v_batch_id is null then raise exception 'IAC online batch is not configured'; end if;

  insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
  select distinct v_batch_id, a.student_id, 'demo', 0,
         'Access transferred from IAC orientation; regular-course fee not yet recorded'
  from public.orientation_applications a
  join public.orientation_cohorts c on c.id = a.cohort_id
  where c.code in ('cohort-a', 'cohort-b')
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

  raise notice 'IAC online batch %, newly enrolled remaining cohort students %', v_batch_id, v_enrolled;
end;
$$;
