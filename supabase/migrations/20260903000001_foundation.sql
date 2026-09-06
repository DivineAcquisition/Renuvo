-- A new product. Auth, workspaces, and a forwarding inbox per org.
-- RLS on every public table. Privileged bootstrap lives in `private`.

create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My workspace',
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.inboxes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  address_local text not null unique,
  created_at timestamptz not null default now()
);

create index organization_members_user_id_idx on public.organization_members (user_id);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.inboxes enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "orgs: members read"
  on public.organizations for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.organization_id = organizations.id
        and m.user_id = auth.uid()
    )
  );

create policy "members: read own rows"
  on public.organization_members for select
  to authenticated
  using (user_id = auth.uid());

create policy "inboxes: members read"
  on public.inboxes for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.organization_id = inboxes.organization_id
        and m.user_id = auth.uid()
    )
  );

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  new_slug text;
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );

  new_slug := 'ws-' || substr(replace(new.id::text, '-', ''), 1, 10);

  insert into public.organizations (name, slug)
  values ('My workspace', new_slug)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  insert into public.inboxes (organization_id, address_local)
  values (new_org_id, new_slug);

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();
