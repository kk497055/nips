-- A moderator heartbeat proves presence, but must never keep a class live past
-- its configured teaching window. This is additive and preserves session logs.
alter table public.batches
  add column if not exists class_duration_minutes integer not null default 60
  check (class_duration_minutes between 15 and 480);

alter table public.sessions add column if not exists scheduled_end_at timestamptz;

update public.sessions s
set scheduled_end_at = s.started_at + make_interval(mins => b.class_duration_minutes)
from public.batches b
where b.id = s.batch_id and s.scheduled_end_at is null;

update public.sessions
set ended_at = scheduled_end_at
where ended_at is null and scheduled_end_at <= now();

create or replace function public.close_stale_class_sessions()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.sessions
  set ended_at = case
    when scheduled_end_at is not null and scheduled_end_at <= now() then scheduled_end_at
    else last_heartbeat_at
  end
  where ended_at is null
    and (
      last_heartbeat_at < now() - interval '150 seconds'
      or (scheduled_end_at is not null and scheduled_end_at <= now())
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.close_stale_class_sessions() from public, anon;
grant execute on function public.close_stale_class_sessions() to authenticated;
