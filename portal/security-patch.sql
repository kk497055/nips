-- ============================================================
-- NIPS Portal — security patch
-- Blocks role self-escalation (a student promoting themselves to admin).
-- Safe to run once in Supabase → SQL Editor. Idempotent.
-- ============================================================

create or replace function public.protect_role()
returns trigger language plpgsql security definer as $$
begin
  -- auth.uid() is null in the SQL editor / service role (trusted); only guard app users.
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_role on public.profiles;
create trigger trg_protect_role
  before update on public.profiles
  for each row execute function public.protect_role();
