-- Additive admin controls for live operations. No user, payment, attendance,
-- notification, or learning-history records are deleted by these functions.

alter table public.profiles
  add column if not exists is_active boolean not null default true;

create index if not exists profiles_role_active_idx
  on public.profiles (role, is_active);

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

create or replace function public.teaches_batch(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'teacher' and is_active = true)
    and (
      exists(select 1 from public.batches where id = b and teacher_id = auth.uid())
      or exists(select 1 from public.batch_teachers where batch_id = b and teacher_id = auth.uid())
    );
$$;

create or replace function public.enrolled_paid(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'student' and is_active = true)
    and exists(
      select 1 from public.enrollments
      where batch_id = b and student_id = auth.uid() and payment_status in ('paid','demo')
    );
$$;

-- A non-admin may edit their own ordinary profile fields, but cannot reactivate
-- themselves or alter access level.
create or replace function public.protect_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only admins can change roles or account status';
  end if;
  return new;
end;
$$;

-- Remove only this batch membership. The student account and all historical
-- attendance, payments, receipts, and learning records remain intact.
create or replace function public.admin_remove_student_from_batch(
  p_batch_id uuid,
  p_student_id uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_removed integer;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  delete from public.enrollments
  where batch_id = p_batch_id and student_id = p_student_id;
  get diagnostics v_removed = row_count;
  return v_removed > 0;
end;
$$;

revoke all on function public.admin_remove_student_from_batch(uuid,uuid) from public, anon;
grant execute on function public.admin_remove_student_from_batch(uuid,uuid) to authenticated;

-- Admin profile correction is intentionally scoped to student-facing fields.
-- Authentication email, role, student ID, and account history are untouched.
create or replace function public.admin_save_student_profile(
  p_student_id uuid,
  p_full_name text,
  p_grade_level text,
  p_subjects text[],
  p_other_subject text,
  p_study_modes text[],
  p_time_preference text,
  p_phone text,
  p_city text,
  p_education_board text,
  p_contact_email text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_allowed_subjects constant text[] := array['physics','maths','chemistry','biology','computer','english','accounting','other'];
  v_allowed_modes constant text[] := array['online','physical'];
  v_subjects text[];
  v_modes text[];
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student') then
    raise exception 'Student profile not found';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Full name is required'; end if;

  select coalesce(array_agg(subject order by first_position), array[]::text[]) into v_subjects from (
    select lower(trim(value)) subject, min(position) first_position
    from unnest(coalesce(p_subjects, array[]::text[])) with ordinality as item(value, position)
    where lower(trim(value)) = any(v_allowed_subjects)
    group by lower(trim(value))
  ) selected;
  select coalesce(array_agg(mode order by first_position), array[]::text[]) into v_modes from (
    select lower(trim(value)) mode, min(position) first_position
    from unnest(coalesce(p_study_modes, array[]::text[])) with ordinality as item(value, position)
    where lower(trim(value)) = any(v_allowed_modes)
    group by lower(trim(value))
  ) selected;
  if 'other' = any(v_subjects) and trim(coalesce(p_other_subject, '')) = '' then
    raise exception 'Please specify the other subject';
  end if;
  if p_time_preference is not null and p_time_preference not in ('morning','evening') then
    raise exception 'Time preference must be morning or evening';
  end if;

  update public.profiles set
    full_name = left(trim(p_full_name), 160),
    grade_level = nullif(left(trim(coalesce(p_grade_level, '')), 30), ''),
    subjects = v_subjects,
    other_subject = case when 'other' = any(v_subjects) then nullif(left(trim(coalesce(p_other_subject, '')), 120), '') else null end,
    preferred_study_modes = v_modes,
    time_preference = nullif(p_time_preference, ''),
    profile_submitted_at = now()
  where id = p_student_id;

  insert into public.student_contacts (student_id, phone, email, city, education_board)
  values (
    p_student_id,
    nullif(left(trim(coalesce(p_phone, '')), 50), ''),
    nullif(left(trim(coalesce(p_contact_email, '')), 254), ''),
    nullif(left(trim(coalesce(p_city, '')), 120), ''),
    nullif(left(trim(coalesce(p_education_board, '')), 160), '')
  )
  on conflict (student_id) do update set
    phone = excluded.phone, email = excluded.email,
    city = excluded.city, education_board = excluded.education_board;
end;
$$;

revoke all on function public.admin_save_student_profile(uuid,text,text,text[],text,text[],text,text,text,text,text) from public, anon;
grant execute on function public.admin_save_student_profile(uuid,text,text,text[],text,text[],text,text,text,text,text) to authenticated;
