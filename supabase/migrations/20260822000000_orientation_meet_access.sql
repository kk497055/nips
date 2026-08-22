-- Allow assigned students to access a saved Meet link once the schedule is announced.
-- Access remains scoped by auth.uid() through the student's orientation application.

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
         case when c.session_state in ('scheduled', 'live') then c.meet_url else null end as join_url
  from public.orientation_applications a
  join public.orientation_cohorts c on c.id = a.cohort_id
  join public.batches b on b.id = c.batch_id
  where a.student_id = auth.uid();
$$;

revoke all on function public.get_my_orientation_cohorts() from public, anon;
grant execute on function public.get_my_orientation_cohorts() to authenticated;
