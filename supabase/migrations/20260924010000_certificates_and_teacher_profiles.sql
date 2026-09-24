-- Additive certificate issuance and private teacher profile workflows.

create table if not exists public.teacher_profiles (
  teacher_id uuid primary key references public.profiles(id) on delete cascade,
  contact_email text,
  phone text,
  address text,
  city text,
  emergency_contact text,
  qualification text,
  education_board text,
  subjects text[] not null default array[]::text[],
  other_subject text,
  experience_years numeric,
  designation text,
  joining_date date,
  compensation_type text check (compensation_type in ('monthly','per_class','hourly','other')),
  compensation_amount numeric,
  bank_name text,
  account_title text,
  iban text,
  profile_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.teacher_profiles enable row level security;
drop policy if exists teacher_profiles_self on public.teacher_profiles;
create policy teacher_profiles_self on public.teacher_profiles for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
drop policy if exists teacher_profiles_admin on public.teacher_profiles;
create policy teacher_profiles_admin on public.teacher_profiles for all
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.certificate_settings (
  id boolean primary key default true check (id),
  signer_name text,
  signer_title text not null default 'Chief Executive',
  signature_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.certificate_settings (id) values (true) on conflict (id) do nothing;
alter table public.certificate_settings enable row level security;
drop policy if exists certificate_settings_read on public.certificate_settings;
create policy certificate_settings_read on public.certificate_settings for select using (auth.uid() is not null);
drop policy if exists certificate_settings_admin on public.certificate_settings;
create policy certificate_settings_admin on public.certificate_settings for all using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificate-assets', 'certificate-assets', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists certificate_assets_public_read on storage.objects;
create policy certificate_assets_public_read on storage.objects for select using (bucket_id = 'certificate-assets');
drop policy if exists certificate_assets_admin_write on storage.objects;
create policy certificate_assets_admin_write on storage.objects for insert with check (bucket_id = 'certificate-assets' and public.is_admin());
drop policy if exists certificate_assets_admin_update on storage.objects;
create policy certificate_assets_admin_update on storage.objects for update using (bucket_id = 'certificate-assets' and public.is_admin());

create sequence if not exists public.nips_certificate_number_seq start 1;
create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_number text not null unique,
  verification_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  student_id uuid not null references public.profiles(id),
  batch_id uuid references public.batches(id),
  institution text not null default 'NIPS Education Solutions',
  program text not null,
  course text not null,
  duration text not null,
  completion_date date not null,
  signer_name text not null,
  signer_title text not null default 'Chief Executive',
  signature_url text,
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text
);
create index if not exists certificates_student_idx on public.certificates(student_id, issued_at desc);
create index if not exists certificates_batch_idx on public.certificates(batch_id, issued_at desc);
alter table public.certificates enable row level security;
drop policy if exists certificates_admin on public.certificates;
create policy certificates_admin on public.certificates for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists certificates_student_read on public.certificates;
create policy certificates_student_read on public.certificates for select using (student_id = auth.uid());

create or replace function public.issue_certificate(
  p_student_id uuid, p_batch_id uuid, p_institution text, p_program text,
  p_course text, p_duration text, p_completion_date date
) returns public.certificates
language plpgsql security definer set search_path = public as $$
declare v_settings public.certificate_settings; v_certificate public.certificates; v_name text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select * into v_settings from public.certificate_settings where id = true;
  if trim(coalesce(v_settings.signer_name,'')) = '' then raise exception 'Configure the Chief Executive name before issuing certificates'; end if;
  select full_name into v_name from public.profiles where id = p_student_id and role = 'student';
  if v_name is null then raise exception 'Student not found'; end if;
  if trim(coalesce(p_program,'')) = '' or trim(coalesce(p_course,'')) = '' or trim(coalesce(p_duration,'')) = '' then raise exception 'Program, course and duration are required'; end if;
  insert into public.certificates (certificate_number,student_id,batch_id,institution,program,course,duration,completion_date,signer_name,signer_title,signature_url,issued_by)
  values ('NIPS-CERT-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.nips_certificate_number_seq')::text,6,'0'), p_student_id,p_batch_id,left(trim(p_institution),160),left(trim(p_program),160),left(trim(p_course),160),left(trim(p_duration),80),p_completion_date,v_settings.signer_name,v_settings.signer_title,v_settings.signature_url,auth.uid())
  returning * into v_certificate;
  return v_certificate;
end;
$$;
revoke all on function public.issue_certificate(uuid,uuid,text,text,text,text,date) from public, anon;
grant execute on function public.issue_certificate(uuid,uuid,text,text,text,text,date) to authenticated;

create or replace function public.verify_certificate(p_code text)
returns table (certificate_number text, student_name text, institution text, program text, course text, duration text, completion_date date, signer_name text, signer_title text, issued_at timestamptz, is_valid boolean)
language sql security definer stable set search_path = public as $$
  select c.certificate_number,p.full_name,c.institution,c.program,c.course,c.duration,c.completion_date,c.signer_name,c.signer_title,c.issued_at,(c.revoked_at is null)
  from public.certificates c join public.profiles p on p.id=c.student_id
  where c.verification_code=p_code limit 1;
$$;
grant execute on function public.verify_certificate(text) to anon, authenticated;
