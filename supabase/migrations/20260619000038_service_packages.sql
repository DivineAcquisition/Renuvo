-- ============================================================================
-- RENUVO — SERVICE PACKAGES & ADD-ONS (the business's menu) + plan line items
-- Money is in CENTS to match recurring_plans.price_cents and the Stripe pipeline.
-- ============================================================================

-- the packages a business offers (its tiers / service types)
create table public.service_packages (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  name                    text not null,
  description             text,
  base_price_cents        int not null,
  default_cadence_key     text not null default 'biweekly',   -- cadence_profiles.key
  recurring_discount_pct  numeric check (recurring_discount_pct between 0 and 90),
  sort_order              int not null default 0,
  active                  boolean not null default true,
  created_at              timestamptz not null default now()
);
create index idx_packages_org on public.service_packages (organization_id, active, sort_order);
alter table public.service_packages enable row level security;
create policy "packages_rw_org" on public.service_packages
  for all using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

-- optional add-ons that adjust the price (fridge, windows, etc.)
create table public.service_addons (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  price_cents     int not null,
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index idx_addons_org on public.service_addons (organization_id, active, sort_order);
alter table public.service_addons enable row level security;
create policy "addons_rw_org" on public.service_addons
  for all using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

-- recurring_plans optionally reference a package; price_cents stays the COMPUTED
-- TOTAL snapshot (existing single-price plans are unchanged).
alter table public.recurring_plans
  add column service_package_id uuid references public.service_packages(id) on delete set null;

-- the composition snapshot for a plan (what the total is made of, at enrollment)
create table public.plan_line_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  recurring_plan_id uuid not null references public.recurring_plans(id) on delete cascade,
  kind              text not null check (kind in ('package','addon')),
  ref_id            uuid,                  -- soft link to the package/addon (may change later)
  label             text not null,         -- snapshot of the name AT enrollment
  price_cents       int not null,          -- snapshot of the price AT enrollment
  created_at        timestamptz not null default now()
);
create index idx_lineitems_plan on public.plan_line_items (recurring_plan_id);
alter table public.plan_line_items enable row level security;
create policy "lineitems_select_org" on public.plan_line_items
  for select using (organization_id in (select public.auth_org_ids()));
