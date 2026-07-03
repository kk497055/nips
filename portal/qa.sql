-- ============================================================
-- NIPS Portal — batch Q&A / discussion (ADDITIVE, non-destructive)
-- Enrolled students + the batch teacher post questions and replies.
-- Author identity is stamped server-side (no spoofing). Run once in SQL Editor.
-- ============================================================

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.batches(id) on delete cascade,
  author_id   uuid references public.profiles(id),
  author_name text,
  body        text not null,
  parent_id   uuid references public.posts(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists posts_batch_idx on public.posts (batch_id, created_at);

-- Stamp author id + name from the session (ignore anything the client sends).
create or replace function public.qa_stamp()
returns trigger language plpgsql security definer as $$
begin
  new.author_id := auth.uid();
  new.author_name := (select full_name from public.profiles where id = auth.uid());
  return new;
end;
$$;
drop trigger if exists trg_qa_stamp on public.posts;
create trigger trg_qa_stamp before insert on public.posts
  for each row execute function public.qa_stamp();

alter table public.posts enable row level security;

-- Members of a batch = enrolled (paid/demo) student, the batch teacher, or admin.
drop policy if exists qa_select on public.posts;
create policy qa_select on public.posts for select using (
  public.enrolled_paid(batch_id) or public.teaches_batch(batch_id) or public.is_admin()
);
drop policy if exists qa_insert on public.posts;
create policy qa_insert on public.posts for insert with check (
  author_id = auth.uid()
  and (public.enrolled_paid(batch_id) or public.teaches_batch(batch_id) or public.is_admin())
);
drop policy if exists qa_delete on public.posts;
create policy qa_delete on public.posts for delete using (
  author_id = auth.uid() or public.teaches_batch(batch_id) or public.is_admin()
);
