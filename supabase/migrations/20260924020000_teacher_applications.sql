-- Public faculty applications remain separate from portal accounts until approved.
create table if not exists public.teacher_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  city text,
  qualification text,
  education_board text,
  subjects text[] not null default array[]::text[],
  other_subject text,
  experience_years numeric,
  message text,
  status text not null default 'submitted' check (status in ('submitted','under_review','approved','rejected')),
  admin_note text,
  teacher_id uuid references public.profiles(id),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create unique index if not exists teacher_applications_email_open_idx
  on public.teacher_applications (lower(email))
  where status in ('submitted','under_review','approved');
create index if not exists teacher_applications_status_idx
  on public.teacher_applications (status, submitted_at desc);

alter table public.teacher_applications enable row level security;
drop policy if exists teacher_applications_admin on public.teacher_applications;
create policy teacher_applications_admin on public.teacher_applications for all
  using (public.is_admin()) with check (public.is_admin());

-- Applicants use Edge Functions. Anonymous clients never receive direct table access.
revoke all on table public.teacher_applications from anon;
grant select, update on table public.teacher_applications to authenticated;

-- Certificate identity is snapshotted at issuance for durable verification.
alter table public.certificates add column if not exists father_name text;
update public.certificate_settings
set signer_name = coalesce(nullif(trim(signer_name), ''), 'Yasir Durrani'),
    signer_title = 'Chief Executive',
    signature_url = 'https://nips.com.pk/assets/ceo-signature-transparent.png',
    updated_at = now()
where id = true;

drop function if exists public.issue_certificate(uuid,uuid,text,text,text,text,date);
create or replace function public.issue_certificate(
  p_student_id uuid, p_batch_id uuid, p_institution text, p_program text,
  p_course text, p_duration text, p_completion_date date, p_father_name text
) returns public.certificates
language plpgsql security definer set search_path = public as $$
declare v_settings public.certificate_settings; v_certificate public.certificates; v_name text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select * into v_settings from public.certificate_settings where id = true;
  if trim(coalesce(v_settings.signer_name,'')) = '' then raise exception 'Configure the Chief Executive name before issuing certificates'; end if;
  select full_name into v_name from public.profiles where id = p_student_id and role = 'student';
  if v_name is null then raise exception 'Student not found'; end if;
  if trim(coalesce(p_program,'')) = '' or trim(coalesce(p_course,'')) = '' or trim(coalesce(p_duration,'')) = '' or trim(coalesce(p_father_name,'')) = '' then raise exception 'Father name, program, course and duration are required'; end if;
  insert into public.certificates (certificate_number,student_id,batch_id,institution,program,course,duration,completion_date,father_name,signer_name,signer_title,signature_url,issued_by)
  values ('NIPS-CERT-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.nips_certificate_number_seq')::text,6,'0'), p_student_id,p_batch_id,left(trim(p_institution),160),left(trim(p_program),160),left(trim(p_course),160),left(trim(p_duration),80),p_completion_date,left(trim(p_father_name),160),v_settings.signer_name,v_settings.signer_title,v_settings.signature_url,auth.uid())
  returning * into v_certificate;
  return v_certificate;
end;
$$;
revoke all on function public.issue_certificate(uuid,uuid,text,text,text,text,date,text) from public, anon;
grant execute on function public.issue_certificate(uuid,uuid,text,text,text,text,date,text) to authenticated;

drop function if exists public.verify_certificate(text);
create or replace function public.verify_certificate(p_code text)
returns table (certificate_number text, student_name text, father_name text, institution text, program text, course text, duration text, completion_date date, signer_name text, signer_title text, issued_at timestamptz, is_valid boolean)
language sql security definer stable set search_path = public as $$
  select c.certificate_number,p.full_name,c.father_name,c.institution,c.program,c.course,c.duration,c.completion_date,c.signer_name,c.signer_title,c.issued_at,(c.revoked_at is null)
  from public.certificates c join public.profiles p on p.id=c.student_id
  where c.verification_code=p_code limit 1;
$$;
grant execute on function public.verify_certificate(text) to anon, authenticated;
