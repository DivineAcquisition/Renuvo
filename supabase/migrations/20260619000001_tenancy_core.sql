-- ============================================================================
-- RENUVO — TENANCY CORE
-- organizations (tenants) · profiles (auth users) · memberships (join + role)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUM: membership role
-- ----------------------------------------------------------------------------
create type public.membership_role as enum ('owner', 'staff');

-- ----------------------------------------------------------------------------
-- TABLE: organizations  (one row per tenant)
-- ----------------------------------------------------------------------------
create table public.organizations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  vertical_id       uuid,                       -- FK added in Prompt 4 (verticals)
  stripe_account_id text,                        -- set in Prompt 13 (Connect)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- TABLE: profiles  (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- TABLE: memberships  (which profile belongs to which org, in what role)
-- ----------------------------------------------------------------------------
create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  role            public.membership_role not null default 'owner',
  created_at      timestamptz not null default now(),
  unique (organization_id, profile_id)
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index idx_memberships_org     on public.memberships (organization_id);
create index idx_memberships_profile on public.memberships (profile_id);
create index idx_orgs_slug           on public.organizations (slug);

-- ============================================================================
-- TRIGGERS & HELPER FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- updated_at maintainer
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_orgs_updated
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Auto-create a profile row whenever an auth user is created
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- auth_org_ids() — the org ids the current caller belongs to.
-- Reused by RLS policies on EVERY tenant-scoped table from here on.
-- security definer so it can read memberships regardless of that table's RLS.
-- ----------------------------------------------------------------------------
create or replace function public.auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.memberships
  where profile_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- create_organization() — onboarding bootstrap.
-- A new user has NO membership yet, so they can't satisfy an insert policy
-- that requires org ownership. This security-definer RPC atomically creates
-- the org + the owner membership, bypassing that chicken-and-egg safely.
-- ----------------------------------------------------------------------------
create or replace function public.create_organization(org_name text, org_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.organizations (name, slug)
  values (org_name, org_slug)
  returning id into new_org_id;

  insert into public.memberships (organization_id, profile_id, role)
  values (new_org_id, auth.uid(), 'owner');

  return new_org_id;
end;
$$;

grant execute on function public.auth_org_ids()                to authenticated;
grant execute on function public.create_organization(text,text) to authenticated;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enable RLS on all three tables (deny-by-default until policies match)
-- ----------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.memberships   enable row level security;

-- ---- PROFILES: a user sees/edits only their own profile ---------------------
create policy "profiles_select_self" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---- ORGANIZATIONS: members read; only owners update ------------------------
-- (No direct INSERT policy — orgs are created via create_organization() RPC.)
create policy "orgs_select_member" on public.organizations
  for select using (id in (select public.auth_org_ids()));

create policy "orgs_update_owner" on public.organizations
  for update using (
    id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and role = 'owner'
    )
  );

-- ---- MEMBERSHIPS: members read their org's rows; owners manage --------------
create policy "memberships_select_member" on public.memberships
  for select using (organization_id in (select public.auth_org_ids()));

create policy "memberships_insert_owner" on public.memberships
  for insert with check (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and role = 'owner'
    )
  );

create policy "memberships_delete_owner" on public.memberships
  for delete using (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and role = 'owner'
    )
  );
