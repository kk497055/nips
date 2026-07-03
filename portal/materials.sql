-- ============================================================
-- NIPS Portal — class materials (ADDITIVE, non-destructive)
-- Teachers/admin upload files per batch; enrolled (paid/demo) students download.
-- Files live in a PRIVATE Storage bucket; access is enforced by RLS.
-- Run once in Supabase → SQL Editor.
-- ============================================================

-- 1. Metadata table (title + storage path per file).
create table if not exists public.materials (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.batches(id) on delete cascade,
  title        text not null,
  storage_path text not null,
  file_type    text,
  size_bytes   bigint,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

alter table public.materials enable row level security;

drop policy if exists mat_admin on public.materials;
create policy mat_admin on public.materials for all using (public.is_admin());
drop policy if exists mat_teacher on public.materials;
create policy mat_teacher on public.materials for all using (public.teaches_batch(batch_id));
drop policy if exists mat_student on public.materials;
create policy mat_student on public.materials for select using (public.enrolled_paid(batch_id));

-- 2. Private storage bucket with a hard 50 MB per-file cap (server-enforced,
--    so a client can't bypass the UI limit). Files are keyed as "<batch_id>/<file>".
insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- 3. Storage access mirrors the table: the first path folder is the batch_id.
drop policy if exists materials_read on storage.objects;
create policy materials_read on storage.objects for select using (
  bucket_id = 'materials' and (
    public.is_admin()
    or public.teaches_batch(((storage.foldername(name))[1])::uuid)
    or public.enrolled_paid(((storage.foldername(name))[1])::uuid)
  )
);

drop policy if exists materials_insert on storage.objects;
create policy materials_insert on storage.objects for insert with check (
  bucket_id = 'materials' and (
    public.is_admin()
    or public.teaches_batch(((storage.foldername(name))[1])::uuid)
  )
);

drop policy if exists materials_delete on storage.objects;
create policy materials_delete on storage.objects for delete using (
  bucket_id = 'materials' and (
    public.is_admin()
    or public.teaches_batch(((storage.foldername(name))[1])::uuid)
  )
);
