-- ============================================================
-- PROJECT MEMBERS
-- ============================================================
create table public.project_members (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'editor' check (role in ('viewer', 'editor')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique(project_id, user_id)
);

-- ============================================================
-- PROJECT INVITATIONS (pending — email not yet registered)
-- ============================================================
create table public.project_invitations (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  email       text not null,
  role        text not null default 'editor' check (role in ('viewer', 'editor')),
  invited_by  uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  unique(project_id, email)
);

-- ============================================================
-- RLS — new tables
-- ============================================================
alter table public.project_members enable row level security;
alter table public.project_invitations enable row level security;

-- project_members: owner manages all; each member sees their own row
create policy "owner_manage_members" on public.project_members
  for all using (
    exists (select 1 from public.projects where id = project_id and user_id = auth.uid())
  );

create policy "members_see_own_membership" on public.project_members
  for select using (auth.uid() = user_id);

-- project_invitations: owner manages all
create policy "owner_manage_invitations" on public.project_invitations
  for all using (
    exists (select 1 from public.projects where id = project_id and user_id = auth.uid())
  );

-- ============================================================
-- RLS — extend existing tables to allow member access
-- ============================================================

-- Projects: members can SELECT (owner ALL already covered)
create policy "members_see_projects" on public.projects
  for select using (
    exists (select 1 from public.project_members where project_id = id and user_id = auth.uid())
  );

-- Data sources: owner can see all sources in project (including member-uploaded ones)
create policy "owners_see_project_sources" on public.data_sources
  for all using (
    exists (select 1 from public.projects where id = project_id and user_id = auth.uid())
  );

-- Data sources: members can access all sources in project
create policy "members_access_sources" on public.data_sources
  for all using (
    exists (select 1 from public.project_members where project_id = data_sources.project_id and user_id = auth.uid())
  );

-- Charter: members
create policy "members_access_charter" on public.project_charter
  for all using (
    exists (select 1 from public.project_members where project_id = project_charter.project_id and user_id = auth.uid())
  );

-- PRD: members
create policy "members_access_prd" on public.prd
  for all using (
    exists (select 1 from public.project_members where project_id = prd.project_id and user_id = auth.uid())
  );

-- Epics: members
create policy "members_access_epics" on public.epics
  for all using (
    exists (select 1 from public.project_members where project_id = epics.project_id and user_id = auth.uid())
  );

-- User stories: members
create policy "members_access_stories" on public.user_stories
  for all using (
    exists (select 1 from public.project_members where project_id = user_stories.project_id and user_id = auth.uid())
  );

-- Project prompts: members
create policy "members_access_project_prompts" on public.project_prompts
  for all using (
    exists (select 1 from public.project_members where project_id = project_prompts.project_id and user_id = auth.uid())
  );
