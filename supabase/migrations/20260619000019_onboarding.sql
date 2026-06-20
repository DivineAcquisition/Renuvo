-- ============================================================================
-- RENUVO — ONBOARDING (completion flag)
-- ============================================================================
alter table public.organizations
  add column onboarding_completed_at timestamptz;
