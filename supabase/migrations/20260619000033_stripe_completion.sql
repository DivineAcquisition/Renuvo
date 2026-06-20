-- ============================================================================
-- RENUVO — STRIPE FINANCIAL INFRASTRUCTURE COMPLETION
-- Persisted SaaS catalog ids (self-provisioned at runtime) + Connect readiness.
-- ============================================================================

-- SaaS plan catalog: cache the platform-account Product so we never re-create it.
alter table public.subscription_plans
  add column if not exists stripe_product_id text;

-- Connect account readiness — populated from OAuth callback + account.updated
-- webhook so the UI and capture flow can tell when a tenant can actually charge.
alter table public.organizations
  add column if not exists stripe_charges_enabled   boolean not null default false,
  add column if not exists stripe_payouts_enabled   boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false;
