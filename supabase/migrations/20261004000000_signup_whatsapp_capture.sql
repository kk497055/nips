-- Capture the mandatory WhatsApp number supplied by new standard portal signups.
-- Additive only: existing users and existing contact records are preserved.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_campaign text := lower(trim(coalesce(new.raw_user_meta_data->>'orientation_program', '')));
  v_mode text := lower(trim(coalesce(new.raw_user_meta_data->>'study_mode_preference', '')));
  v_whatsapp text := left(trim(coalesce(new.raw_user_meta_data->>'whatsapp', new.raw_user_meta_data->>'phone', '')), 50);
  v_application_id uuid;
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'New User'), 'student');

  insert into public.student_contacts (student_id, phone, email)
  values (new.id, nullif(v_whatsapp, ''), new.email)
  on conflict (student_id) do update set
    phone = coalesce(nullif(excluded.phone, ''), public.student_contacts.phone),
    email = coalesce(nullif(excluded.email, ''), public.student_contacts.email);

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
