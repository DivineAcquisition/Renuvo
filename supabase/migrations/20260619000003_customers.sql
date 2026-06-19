-- ============================================================================
-- RENUVO — CUSTOMERS  (tenant-scoped end-clients / homeowners)
-- SMS consent + opt-out gate enforced at the data layer.
-- ============================================================================

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,

  -- identity
  full_name           text,
  phone               text not null,              -- E.164, e.g. +13015551234
  email               text,

  -- SMS compliance (load-bearing — gates every send)
  sms_consent         boolean not null default false,
  sms_consent_at      timestamptz,
  sms_consent_source  text,                        -- 'booking_form' | 'import' | 'manual' | 'reply_optin'
  opted_out           boolean not null default false,
  opted_out_at        timestamptz,

  -- single source of truth the engine checks before ANY send
  sms_sendable        boolean generated always as (sms_consent and not opted_out) stored,

  -- provenance
  source              text,                        -- lead source label
  external_ref        text,                        -- id from their existing booking tool
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- one customer per phone per tenant
  unique (organization_id, phone),

  -- enforce E.164 shape so junk numbers never reach Telnyx
  constraint chk_phone_e164 check (phone ~ '^\+[1-9]\d{1,14}$')
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index idx_customers_org      on public.customers (organization_id);
create index idx_customers_phone    on public.customers (organization_id, phone);
create index idx_customers_sendable on public.customers (organization_id) where sms_sendable;

-- updated_at maintainer (reuses set_updated_at() from Prompt 2)
create trigger trg_customers_updated
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ============================================================================
-- OPT-OUT HELPER (compliance-critical, reused by the STOP handler)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- mark_opted_out() — called by the Telnyx inbound STOP handler (Prompt 19)
-- and any manual opt-out. Sets the flags atomically; the generated column
-- flips sms_sendable to false automatically. Runs under service-role in the
-- webhook, but defined security definer so it's safe to expose if needed.
-- ----------------------------------------------------------------------------
create or replace function public.mark_opted_out(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customers
  set opted_out = true,
      opted_out_at = now()
  where id = p_customer_id;
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY (tenant-scoped via auth_org_ids)
-- ============================================================================

alter table public.customers enable row level security;

-- members of the owning org can read/write their customers; nobody else can
create policy "customers_select_org" on public.customers
  for select using (organization_id in (select public.auth_org_ids()));

create policy "customers_insert_org" on public.customers
  for insert with check (organization_id in (select public.auth_org_ids()));

create policy "customers_update_org" on public.customers
  for update using (organization_id in (select public.auth_org_ids()))
            with check (organization_id in (select public.auth_org_ids()));

create policy "customers_delete_org" on public.customers
  for delete using (organization_id in (select public.auth_org_ids()));
