-- Additive student profile, academic preference, ID, and batch-matching workflow.
-- Existing profiles, batches, enrollments, payments, and orientation data are unchanged.

create sequence if not exists public.nips_student_number_seq start 1;

alter table public.profiles
  add column if not exists grade_level text,
  add column if not exists subjects text[],
  add column if not exists other_subject text,
  add column if not exists preferred_study_modes text[],
  add column if not exists time_preference text,
  add column if not exists student_code text,
  add column if not exists profile_completed_at timestamptz,
  add column if not exists profile_submitted_at timestamptz;

create unique index if not exists profiles_student_code_unique
  on public.profiles (student_code) where student_code is not null;
create index if not exists profiles_subjects_gin on public.profiles using gin (subjects);
create index if not exists profiles_student_matching_idx
  on public.profiles (role, time_preference, profile_completed_at);

alter table public.student_contacts
  add column if not exists city text,
  add column if not exists education_board text;

alter table public.batches
  add column if not exists subject_key text,
  add column if not exists session_period text;

create index if not exists batches_student_matching_idx
  on public.batches (is_active, subject_key, session_period);

create or replace function public.subject_short_code(p_subject text)
returns text language sql immutable as $$
  select case lower(trim(coalesce(p_subject, '')))
    when 'physics' then 'PH' when 'maths' then 'MA' when 'mathematics' then 'MA'
    when 'chemistry' then 'CH' when 'biology' then 'BI' when 'computer' then 'CO'
    when 'english' then 'EN' when 'accounting' then 'AC' else 'OT' end;
$$;

create or replace function public.assign_nips_student_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_grade text;
  v_subject text;
  v_period text;
  v_number bigint;
begin
  if new.role <> 'student' or new.student_code is not null or new.profile_completed_at is null then return new; end if;
  v_grade := upper(regexp_replace(coalesce(new.grade_level, 'NA'), '[^a-zA-Z0-9]', '', 'g'));
  v_grade := left(coalesce(nullif(v_grade, ''), 'NA'), 3);
  v_subject := public.subject_short_code(coalesce(new.subjects[1], 'other'));
  v_period := case new.time_preference when 'morning' then 'MOR' when 'evening' then 'EVE' else 'ANY' end;
  v_number := nextval('public.nips_student_number_seq');
  new.student_code := 'NIPS' || v_grade || v_subject || v_period || lpad(v_number::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_assign_nips_student_code on public.profiles;
create trigger trg_assign_nips_student_code
  before insert or update of profile_completed_at on public.profiles
  for each row execute function public.assign_nips_student_code();

create or replace function public.auto_enroll_profile_into_matching_batches(p_student_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0;
begin
  if exists (select 1 from public.enrollments where student_id = p_student_id) then return 0; end if;
  insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
  select b.id, p.id, 'pending', coalesce(b.fee, 0),
         'Automatically matched from completed student profile'
  from public.profiles p
  join public.batches b
    on b.is_active = true
   and b.subject_key = any(coalesce(p.subjects, array[]::text[]))
   and (b.session_period is null or b.session_period = p.time_preference)
  where p.id = p_student_id and p.role = 'student' and p.profile_completed_at is not null
  on conflict (batch_id, student_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.auto_enroll_students_for_batch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_active and new.subject_key is not null then
    insert into public.enrollments (batch_id, student_id, payment_status, amount, discount_note)
    select new.id, p.id, 'pending', coalesce(new.fee, 0),
           'Automatically matched when batch was created or configured'
    from public.profiles p
    where p.role = 'student'
      and p.profile_completed_at is not null
      and new.subject_key = any(coalesce(p.subjects, array[]::text[]))
      and (new.session_period is null or new.session_period = p.time_preference)
      and not exists (select 1 from public.enrollments e where e.student_id = p.id)
    on conflict (batch_id, student_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_enroll_students_for_batch on public.batches;
create trigger trg_auto_enroll_students_for_batch
  after insert or update of subject_key, session_period, is_active on public.batches
  for each row execute function public.auto_enroll_students_for_batch();

create or replace function public.save_my_student_profile(
  p_full_name text,
  p_grade_level text,
  p_subjects text[],
  p_other_subject text,
  p_study_modes text[],
  p_time_preference text,
  p_phone text,
  p_city text,
  p_education_board text,
  p_email text
) returns table (student_code text, enrollments_added integer)
language plpgsql security definer set search_path = public as $$
declare
  v_allowed_subjects constant text[] := array['physics','maths','chemistry','biology','computer','english','accounting','other'];
  v_allowed_modes constant text[] := array['online','physical'];
  v_subjects text[];
  v_modes text[];
  v_added integer;
  v_code text;
  v_auth_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'student') then raise exception 'Student account required'; end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Full name is required'; end if;
  if trim(coalesce(p_grade_level, '')) = '' then raise exception 'Class or grade is required'; end if;
  select array_agg(subject order by first_position) into v_subjects from (
    select lower(trim(value)) subject, min(position) first_position
    from unnest(coalesce(p_subjects, array[]::text[])) with ordinality as item(value, position)
    where lower(trim(value)) = any(v_allowed_subjects)
    group by lower(trim(value))
  ) selected;
  select array_agg(mode order by first_position) into v_modes from (
    select lower(trim(value)) mode, min(position) first_position
    from unnest(coalesce(p_study_modes, array[]::text[])) with ordinality as item(value, position)
    where lower(trim(value)) = any(v_allowed_modes)
    group by lower(trim(value))
  ) selected;
  if coalesce(cardinality(v_subjects), 0) = 0 then raise exception 'Select at least one subject'; end if;
  if coalesce(cardinality(v_modes), 0) = 0 then raise exception 'Select at least one study mode'; end if;
  if p_time_preference not in ('morning','evening') then raise exception 'Choose morning or evening'; end if;
  if 'other' = any(v_subjects) and trim(coalesce(p_other_subject, '')) = '' then raise exception 'Please specify the other subject'; end if;

  update public.profiles set
    full_name = left(trim(p_full_name), 160), grade_level = left(trim(p_grade_level), 30),
    subjects = v_subjects, other_subject = nullif(left(trim(coalesce(p_other_subject, '')), 120), ''),
    preferred_study_modes = v_modes, time_preference = p_time_preference,
    profile_completed_at = coalesce(profile_completed_at, now()), profile_submitted_at = now()
  where id = auth.uid();

  select email into v_auth_email from auth.users where id = auth.uid();
  insert into public.student_contacts (student_id, phone, email, city, education_board)
  values (auth.uid(), nullif(left(trim(coalesce(p_phone, '')), 50), ''),
          nullif(left(trim(coalesce(v_auth_email, p_email, '')), 254), ''), nullif(left(trim(coalesce(p_city, '')), 120), ''),
          nullif(left(trim(coalesce(p_education_board, '')), 160), ''))
  on conflict (student_id) do update set phone = excluded.phone, email = excluded.email,
    city = excluded.city, education_board = excluded.education_board;

  v_added := public.auto_enroll_profile_into_matching_batches(auth.uid());
  select p.student_code into v_code from public.profiles p where p.id = auth.uid();
  return query select v_code, v_added;
end;
$$;

revoke all on function public.save_my_student_profile(text,text,text[],text,text[],text,text,text,text,text) from public, anon;
grant execute on function public.save_my_student_profile(text,text,text[],text,text[],text,text,text,text,text) to authenticated;
revoke all on function public.auto_enroll_profile_into_matching_batches(uuid) from public, anon, authenticated;
