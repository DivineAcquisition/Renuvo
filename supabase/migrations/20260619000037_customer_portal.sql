-- ============================================================================
-- RENUVO — CUSTOMER PORTAL (passwordless magic-link sessions, scoped to ONE customer)
-- Portal tables are touched ONLY by the service-role portal routes (identity comes
-- from the validated session, not Supabase auth). Only owner READ on skips.
-- ============================================================================

-- a magic link: single-use, short-lived, scoped to one customer (store HASH only)
create table public.portal_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  token_hash      text not null unique,
  purpose         text not null default 'manage'
    check (purpose in ('manage','payment_update')),
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index idx_portal_links_lookup
  on public.portal_links (token_hash) where consumed_at is null;

-- a portal session: the homeowner's auth after a link is consumed (store HASH only)
create table public.portal_sessions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  customer_id        uuid not null references public.customers(id) on delete cascade,
  session_token_hash text not null unique,
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz
);
create index idx_portal_sessions_lookup
  on public.portal_sessions (session_token_hash) where revoked_at is null;

-- skipped visits (a soft, reversible alternative to cancel)
create table public.skipped_visits (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  recurring_plan_id uuid not null references public.recurring_plans(id) on delete cascade,
  skipped_charge_at timestamptz not null,
  created_by_kind   text not null default 'customer',
  created_at        timestamptz not null default now()
);
create index idx_skips_plan on public.skipped_visits (recurring_plan_id, created_at desc);

alter table public.portal_links    enable row level security;
alter table public.portal_sessions enable row level security;
alter table public.skipped_visits  enable row level security;

-- owners can SEE skipped visits for their org (read-only); portal_* have NO
-- policies → only the service role (portal routes) can touch them.
create policy "skips_select_org" on public.skipped_visits
  for select using (organization_id in (select public.auth_org_ids()));
