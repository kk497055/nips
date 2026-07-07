-- ============================================================
-- NIPS Portal - reusable curriculum templates
-- Teachers can design curriculums before being assigned to a batch.
-- Applying a template copies topics into curriculum_topics for one batch.
-- ============================================================

create table if not exists public.curriculum_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  category    text,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.curriculum_template_topics (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.curriculum_templates(id) on delete cascade,
  title       text not null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists curriculum_templates_owner_idx
  on public.curriculum_templates (owner_id, is_archived, created_at);
create index if not exists curriculum_template_topics_template_idx
  on public.curriculum_template_topics (template_id, position);

alter table public.curriculum_templates enable row level security;
alter table public.curriculum_template_topics enable row level security;

create or replace function public.is_teacher()
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('teacher','admin'));
$$;

create or replace function public.owns_curriculum_template(t uuid)
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from public.curriculum_templates
    where id = t and (owner_id = auth.uid() or public.is_admin())
  );
$$;

drop policy if exists ct_select on public.curriculum_templates;
create policy ct_select on public.curriculum_templates for select using (
  owner_id = auth.uid() or public.is_admin()
);
drop policy if exists ct_insert on public.curriculum_templates;
create policy ct_insert on public.curriculum_templates for insert with check (
  owner_id = auth.uid() and public.is_teacher()
);
drop policy if exists ct_update on public.curriculum_templates;
create policy ct_update on public.curriculum_templates for update using (
  owner_id = auth.uid() or public.is_admin()
) with check (
  owner_id = auth.uid() or public.is_admin()
);
drop policy if exists ct_delete on public.curriculum_templates;
create policy ct_delete on public.curriculum_templates for delete using (
  owner_id = auth.uid() or public.is_admin()
);

drop policy if exists ctt_select on public.curriculum_template_topics;
create policy ctt_select on public.curriculum_template_topics for select using (
  public.owns_curriculum_template(template_id)
);
drop policy if exists ctt_insert on public.curriculum_template_topics;
create policy ctt_insert on public.curriculum_template_topics for insert with check (
  public.owns_curriculum_template(template_id)
);
drop policy if exists ctt_update on public.curriculum_template_topics;
create policy ctt_update on public.curriculum_template_topics for update using (
  public.owns_curriculum_template(template_id)
) with check (
  public.owns_curriculum_template(template_id)
);
drop policy if exists ctt_delete on public.curriculum_template_topics;
create policy ctt_delete on public.curriculum_template_topics for delete using (
  public.owns_curriculum_template(template_id)
);
