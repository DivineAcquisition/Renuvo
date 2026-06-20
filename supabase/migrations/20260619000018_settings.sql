-- ============================================================================
-- RENUVO — SETTINGS (preferred cadence)
-- ============================================================================
-- Optional per-org preferred cadence for the recurring offer (overrides the
-- vertical default in getSignupLink). Null → fall back to vertical default.
alter table public.organizations
  add column preferred_cadence_id uuid references public.cadence_profiles(id);
