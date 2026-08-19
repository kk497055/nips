-- Additive study-mode preference workflow for orientation applicants.
-- Existing applications intentionally remain NULL until a student or admin chooses.

alter table public.orientation_applications
  add column if not exists study_mode_preference text;

alter table public.orientation_applications
  drop constraint if exists orientation_applications_study_mode_check;
alter table public.orientation_applications
  add constraint orientation_applications_study_mode_check
  check (study_mode_preference is null or study_mode_preference in ('online', 'physical'));

create index if not exists orientation_applications_program_study_mode_idx
  on public.orientation_applications (program_id, study_mode_preference);

create table if not exists public.orientation_study_mode_audit (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.orientation_applications(id) on delete cascade,
  old_mode text,
  new_mode text not null check (new_mode in ('online', 'physical')),
  changed_by uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('registration', 'student', 'admin')),
  changed_at timestamptz not null default now()
);

alter table public.orientation_study_mode_audit enable row level security;
drop policy if exists orientation_study_mode_audit_admin_select on public.orientation_study_mode_audit;
create policy orientation_study_mode_audit_admin_select on public.orientation_study_mode_audit
  for select using (public.is_admin());
grant select on public.orientation_study_mode_audit to authenticated;

create or replace function public.set_my_orientation_study_mode(
  p_application_id uuid,
  p_mode text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_mode not in ('online', 'physical') then raise exception 'Choose online or physical'; end if;
  select study_mode_preference into v_old
  from public.orientation_applications
  where id = p_application_id and student_id = auth.uid()
  for update;
  if not found then raise exception 'Orientation application not found'; end if;
  if v_old is distinct from p_mode then
    update public.orientation_applications set study_mode_preference = p_mode, updated_at = now()
    where id = p_application_id;
    insert into public.orientation_study_mode_audit(application_id, old_mode, new_mode, changed_by, source)
    values (p_application_id, v_old, p_mode, auth.uid(), 'student');
  end if;
end;
$$;

create or replace function public.admin_set_orientation_study_mode(
  p_application_id uuid,
  p_mode text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_mode not in ('online', 'physical') then raise exception 'Choose online or physical'; end if;
  select study_mode_preference into v_old from public.orientation_applications
  where id = p_application_id for update;
  if not found then raise exception 'Orientation application not found'; end if;
  if v_old is distinct from p_mode then
    update public.orientation_applications set study_mode_preference = p_mode, updated_at = now()
    where id = p_application_id;
    insert into public.orientation_study_mode_audit(application_id, old_mode, new_mode, changed_by, source)
    values (p_application_id, v_old, p_mode, auth.uid(), 'admin');
  end if;
end;
$$;

revoke all on function public.set_my_orientation_study_mode(uuid,text) from public, anon;
grant execute on function public.set_my_orientation_study_mode(uuid,text) to authenticated;
revoke all on function public.admin_set_orientation_study_mode(uuid,text) from public, anon;
grant execute on function public.admin_set_orientation_study_mode(uuid,text) to authenticated;

-- Preserve the existing signup workflow while capturing the preference from
-- Auth metadata for brand-new applicants after they confirm their email.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_campaign text := lower(trim(coalesce(new.raw_user_meta_data->>'orientation_program', '')));
  v_mode text := lower(trim(coalesce(new.raw_user_meta_data->>'study_mode_preference', '')));
  v_application_id uuid;
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name','New User'), 'student');
  if v_campaign <> '' and exists (
    select 1 from public.orientation_programs
    where (lower(code) = v_campaign or lower(public_slug) = v_campaign)
      and is_active = true and campaign_status = 'published'
  ) then
    v_application_id := public.submit_orientation_application(new.id, new.email, new.raw_user_meta_data);
    if v_mode in ('online', 'physical') then
      update public.orientation_applications set study_mode_preference = v_mode, updated_at = now()
      where id = v_application_id;
      insert into public.orientation_study_mode_audit(application_id, old_mode, new_mode, changed_by, source)
      values (v_application_id, null, v_mode, new.id, 'registration');
    end if;
  end if;
  return new;
end;
$$;
