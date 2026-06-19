-- ============================================================================
-- RENUVO — SIGNUP LINKS  (tokenized, single-use, expiring recurring-offer links)
-- ============================================================================
create type public.signup_link_status as enum ('active', 'used', 'expired');

create table public.signup_links (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id)  on delete cascade,
  customer_id        uuid not null references public.customers(id)       on delete cascade,
  job_id             uuid references public.jobs(id)                     on delete set null,
  cadence_profile_id uuid not null references public.cadence_profiles(id),
  price_cents        int not null,                       -- offered recurring per-visit price
  currency           text not null default 'usd',
  token              text not null unique,               -- 256-bit url-safe random
  status             public.signup_link_status not null default 'active',
  expires_at         timestamptz not null,
  used_at            timestamptz,
  created_at         timestamptz not null default now()
);

create index idx_signup_links_customer on public.signup_links (organization_id, customer_id, status);

alter table public.signup_links enable row level security;
-- members may read their org's links; resolution/consumption happens via
-- service-role (the public page has no auth). No public select policy.
create policy "signup_links_select_org" on public.signup_links
  for select using (organization_id in (select public.auth_org_ids()));
