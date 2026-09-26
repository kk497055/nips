-- Safe operational fixes: auditable primary-teacher replacement and expiring
-- classroom heartbeats. No accounts, batches, attendance or session rows are deleted.

create table if not exists public.batch_teacher_assignment_history (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id),
  old_teacher_id uuid references public.profiles(id),
  new_teacher_id uuid references public.profiles(id),
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now()
);
alter table public.batch_teacher_assignment_history enable row level security;
drop policy if exists batch_teacher_assignment_history_admin on public.batch_teacher_assignment_history;
create policy batch_teacher_assignment_history_admin on public.batch_teacher_assignment_history
  for select using (public.is_admin());

create or replace function public.admin_replace_batch_teacher(p_batch_id uuid, p_new_teacher_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_old_teacher_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select teacher_id into v_old_teacher_id from public.batches where id = p_batch_id for update;
  if not found then raise exception 'Batch not found'; end if;
  if p_new_teacher_id is not null and not exists (
    select 1 from public.profiles where id = p_new_teacher_id and role = 'teacher' and coalesce(is_active, true)
  ) then raise exception 'Select an active teacher'; end if;
  if v_old_teacher_id is not distinct from p_new_teacher_id then return v_old_teacher_id; end if;

  update public.batches set teacher_id = p_new_teacher_id where id = p_batch_id;
  -- A replacement revokes the former primary assignment and avoids duplicating
  -- the new primary as a co-teacher. Other co-teachers remain unchanged.
  delete from public.batch_teachers
  where batch_id = p_batch_id and teacher_id in (v_old_teacher_id, p_new_teacher_id);
  insert into public.batch_teacher_assignment_history(batch_id,old_teacher_id,new_teacher_id,changed_by)
  values (p_batch_id,v_old_teacher_id,p_new_teacher_id,auth.uid());
  return v_old_teacher_id;
end;
$$;
revoke all on function public.admin_replace_batch_teacher(uuid,uuid) from public, anon;
grant execute on function public.admin_replace_batch_teacher(uuid,uuid) to authenticated;

alter table public.sessions add column if not exists last_heartbeat_at timestamptz;
update public.sessions
set ended_at = coalesce(ended_at, started_at + interval '3 hours')
where ended_at is null and started_at < now() - interval '4 hours';
update public.sessions set last_heartbeat_at = coalesce(last_heartbeat_at, ended_at, started_at);
alter table public.sessions alter column last_heartbeat_at set default now();
alter table public.sessions alter column last_heartbeat_at set not null;
create index if not exists sessions_live_heartbeat_idx
  on public.sessions(last_heartbeat_at desc) where ended_at is null;

create or replace function public.close_stale_class_sessions()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.sessions
  set ended_at = last_heartbeat_at
  where ended_at is null and last_heartbeat_at < now() - interval '150 seconds';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.close_stale_class_sessions() from public, anon;
grant execute on function public.close_stale_class_sessions() to authenticated;

