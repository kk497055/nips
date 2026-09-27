-- Additive support for night batches and student preferences. Existing values,
-- codes, enrollments, and batches remain unchanged.

create or replace function public.assign_nips_student_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_grade text; v_subject text; v_period text; v_number bigint;
begin
  if new.role <> 'student' or new.student_code is not null or new.profile_completed_at is null then return new; end if;
  v_grade := left(coalesce(nullif(upper(regexp_replace(coalesce(new.grade_level,'NA'),'[^a-zA-Z0-9]','','g')),''),'NA'),3);
  v_subject := public.subject_short_code(coalesce(new.subjects[1],'other'));
  v_period := case new.time_preference when 'morning' then 'MOR' when 'evening' then 'EVE' when 'night' then 'NGT' else 'ANY' end;
  v_number := nextval('public.nips_student_number_seq');
  new.student_code := 'NIPS' || v_grade || v_subject || v_period || lpad(v_number::text,5,'0');
  return new;
end;
$$;

create or replace function public.save_my_student_profile(
  p_full_name text, p_grade_level text, p_subjects text[], p_other_subject text,
  p_study_modes text[], p_time_preference text, p_phone text, p_city text,
  p_education_board text, p_email text
) returns table (student_code text, enrollments_added integer)
language plpgsql security definer set search_path = public as $$
declare
  v_allowed_subjects constant text[] := array['physics','maths','chemistry','biology','computer','english','accounting','other'];
  v_allowed_modes constant text[] := array['online','physical'];
  v_subjects text[]; v_modes text[]; v_added integer; v_code text; v_auth_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles where id=auth.uid() and role='student') then raise exception 'Student account required'; end if;
  if length(trim(coalesce(p_full_name,''))) < 2 then raise exception 'Full name is required'; end if;
  if trim(coalesce(p_grade_level,'')) = '' then raise exception 'Class or grade is required'; end if;
  select array_agg(subject order by first_position) into v_subjects from (
    select lower(trim(value)) subject,min(position) first_position
    from unnest(coalesce(p_subjects,array[]::text[])) with ordinality as item(value,position)
    where lower(trim(value))=any(v_allowed_subjects) group by lower(trim(value))
  ) selected;
  select array_agg(mode order by first_position) into v_modes from (
    select lower(trim(value)) mode,min(position) first_position
    from unnest(coalesce(p_study_modes,array[]::text[])) with ordinality as item(value,position)
    where lower(trim(value))=any(v_allowed_modes) group by lower(trim(value))
  ) selected;
  if coalesce(cardinality(v_subjects),0)=0 then raise exception 'Select at least one subject'; end if;
  if coalesce(cardinality(v_modes),0)=0 then raise exception 'Select at least one study mode'; end if;
  if p_time_preference not in ('morning','evening','night') then raise exception 'Choose morning, evening, or night'; end if;
  if 'other'=any(v_subjects) and trim(coalesce(p_other_subject,''))='' then raise exception 'Please specify the other subject'; end if;
  update public.profiles set full_name=left(trim(p_full_name),160),grade_level=left(trim(p_grade_level),30),
    subjects=v_subjects,other_subject=nullif(left(trim(coalesce(p_other_subject,'')),120),''),
    preferred_study_modes=v_modes,time_preference=p_time_preference,
    profile_completed_at=coalesce(profile_completed_at,now()),profile_submitted_at=now()
  where id=auth.uid();
  select email into v_auth_email from auth.users where id=auth.uid();
  insert into public.student_contacts(student_id,phone,email,city,education_board)
  values(auth.uid(),nullif(left(trim(coalesce(p_phone,'')),50),''),nullif(left(trim(coalesce(v_auth_email,p_email,'')),254),''),
    nullif(left(trim(coalesce(p_city,'')),120),''),nullif(left(trim(coalesce(p_education_board,'')),160),''))
  on conflict(student_id) do update set phone=excluded.phone,email=excluded.email,city=excluded.city,education_board=excluded.education_board;
  v_added := public.auto_enroll_profile_into_matching_batches(auth.uid());
  select p.student_code into v_code from public.profiles p where p.id=auth.uid();
  return query select v_code,v_added;
end;
$$;
revoke all on function public.save_my_student_profile(text,text,text[],text,text[],text,text,text,text,text) from public,anon;
grant execute on function public.save_my_student_profile(text,text,text[],text,text[],text,text,text,text,text) to authenticated;

create or replace function public.admin_save_student_profile(
  p_student_id uuid,p_full_name text,p_grade_level text,p_subjects text[],p_other_subject text,
  p_study_modes text[],p_time_preference text,p_phone text,p_city text,p_education_board text,p_contact_email text
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_allowed_subjects constant text[]:=array['physics','maths','chemistry','biology','computer','english','accounting','other'];
  v_allowed_modes constant text[]:=array['online','physical']; v_subjects text[]; v_modes text[];
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='student') then raise exception 'Student profile not found'; end if;
  if length(trim(coalesce(p_full_name,'')))<2 then raise exception 'Full name is required'; end if;
  select coalesce(array_agg(subject order by first_position),array[]::text[]) into v_subjects from (
    select lower(trim(value)) subject,min(position) first_position from unnest(coalesce(p_subjects,array[]::text[])) with ordinality as item(value,position)
    where lower(trim(value))=any(v_allowed_subjects) group by lower(trim(value))) selected;
  select coalesce(array_agg(mode order by first_position),array[]::text[]) into v_modes from (
    select lower(trim(value)) mode,min(position) first_position from unnest(coalesce(p_study_modes,array[]::text[])) with ordinality as item(value,position)
    where lower(trim(value))=any(v_allowed_modes) group by lower(trim(value))) selected;
  if 'other'=any(v_subjects) and trim(coalesce(p_other_subject,''))='' then raise exception 'Please specify the other subject'; end if;
  if p_time_preference is not null and p_time_preference not in ('morning','evening','night') then raise exception 'Time preference must be morning, evening, or night'; end if;
  update public.profiles set full_name=left(trim(p_full_name),160),grade_level=nullif(left(trim(coalesce(p_grade_level,'')),30),''),
    subjects=v_subjects,other_subject=case when 'other'=any(v_subjects) then nullif(left(trim(coalesce(p_other_subject,'')),120),'') else null end,
    preferred_study_modes=v_modes,time_preference=nullif(p_time_preference,''),profile_submitted_at=now() where id=p_student_id;
  insert into public.student_contacts(student_id,phone,email,city,education_board)
  values(p_student_id,nullif(left(trim(coalesce(p_phone,'')),50),''),nullif(left(trim(coalesce(p_contact_email,'')),254),''),
    nullif(left(trim(coalesce(p_city,'')),120),''),nullif(left(trim(coalesce(p_education_board,'')),160),''))
  on conflict(student_id) do update set phone=excluded.phone,email=excluded.email,city=excluded.city,education_board=excluded.education_board;
end;
$$;
revoke all on function public.admin_save_student_profile(uuid,text,text,text[],text,text[],text,text,text,text,text) from public,anon;
grant execute on function public.admin_save_student_profile(uuid,text,text,text[],text,text[],text,text,text,text,text) to authenticated;
