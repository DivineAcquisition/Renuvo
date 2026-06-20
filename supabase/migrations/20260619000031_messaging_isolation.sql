-- ============================================================================
-- RENUVO — PER-TENANT MESSAGING PROFILE
-- organizations.telnyx_messaging_profile_id already exists (Prompt 13); this is
-- idempotent and documents the per-tenant isolation requirement:
--   one tenant → one messaging profile → one number → one A2P campaign.
-- ============================================================================
alter table public.organizations
  add column if not exists telnyx_messaging_profile_id text;
