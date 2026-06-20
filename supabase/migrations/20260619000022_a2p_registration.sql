-- ============================================================================
-- RENUVO — A2P 10DLC REGISTRATION (per-org brand + campaign lifecycle)
-- organizations already has: a2p_status, a2p_brand_id, a2p_campaign_id (Prompt 13)
-- ============================================================================
create type public.a2p_entity_type as enum (
  'SOLE_PROPRIETOR', 'PRIVATE_PROFIT', 'PUBLIC_PROFIT', 'NON_PROFIT', 'GOVERNMENT'
);

create type public.a2p_step as enum (
  'not_started', 'brand_submitted', 'brand_verified', 'brand_failed',
  'campaign_submitted', 'campaign_approved', 'campaign_failed', 'number_assigned'
);

create table public.a2p_registrations (
  organization_id    uuid primary key references public.organizations(id) on delete cascade,
  entity_type        public.a2p_entity_type,
  step               public.a2p_step not null default 'not_started',
  -- brand identity (mirrors what TCR needs)
  legal_name         text,
  display_name       text,
  ein                text,
  business_phone     text,
  business_email     text,
  website            text,
  street             text, city text, state text, postal_code text, country text default 'US',
  vertical           text,
  -- telnyx/tcr identifiers
  telnyx_brand_id    text,
  telnyx_campaign_id text,
  brand_status       text,
  campaign_status    text,
  vetting_score      int,
  is_mock            boolean not null default false,
  last_synced_at     timestamptz,
  status_detail      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_a2p_updated before update on public.a2p_registrations
  for each row execute function public.set_updated_at();

alter table public.a2p_registrations enable row level security;
create policy "a2p_select_org" on public.a2p_registrations
  for select using (organization_id in (select public.auth_org_ids()));
-- writes happen via service-role (the registration actions); no tenant write policy.
