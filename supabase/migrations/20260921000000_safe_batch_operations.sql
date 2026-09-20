-- Safe admin batch operations.
-- Batch rows and their historical learning/financial records are never deleted.

create or replace function public.admin_move_batch_students(
  p_source_batch_id uuid,
  p_target_batch_id uuid,
  p_retire_source boolean default false
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_source_batch_id is null or p_target_batch_id is null or p_source_batch_id = p_target_batch_id then
    raise exception 'Choose two different batches';
  end if;
  perform 1 from public.batches where id = p_source_batch_id for update;
  if not found then raise exception 'Source batch not found'; end if;
  perform 1 from public.batches where id = p_target_batch_id and is_active for update;
  if not found then raise exception 'Destination batch must be active'; end if;

  select count(*)::integer into v_count
  from public.enrollments
  where batch_id = p_source_batch_id;

  -- If a student is already in the destination, retain that destination record
  -- and remove only the redundant source membership.
  delete from public.enrollments source
  where source.batch_id = p_source_batch_id
    and exists (
      select 1 from public.enrollments target
      where target.batch_id = p_target_batch_id
        and target.student_id = source.student_id
    );

  -- Updating preserves the enrollment id, payment state, agreed fee and date.
  update public.enrollments
  set batch_id = p_target_batch_id
  where batch_id = p_source_batch_id;

  if p_retire_source then
    update public.batches set is_active = false where id = p_source_batch_id;
  end if;

  return v_count;
end;
$$;

create or replace function public.admin_retire_empty_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if exists (select 1 from public.enrollments where batch_id = p_batch_id) then
    raise exception 'Move enrolled students before retiring this batch';
  end if;
  update public.batches set is_active = false where id = p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
end;
$$;

revoke all on function public.admin_move_batch_students(uuid, uuid, boolean) from public;
revoke all on function public.admin_retire_empty_batch(uuid) from public;
grant execute on function public.admin_move_batch_students(uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_retire_empty_batch(uuid) to authenticated;
