-- NIPS Portal — let a student view fee details for their own enrolments.
-- This is additive: it does not grant access to any other student's data and
-- does not change the paid-only gate used for live classes and learning work.

create policy batches_student_finance on public.batches for select using (
  exists (
    select 1 from public.enrollments e
    where e.batch_id = batches.id and e.student_id = auth.uid()
  )
);
