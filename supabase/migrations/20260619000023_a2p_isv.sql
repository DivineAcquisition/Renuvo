-- ============================================================================
-- RENUVO — A2P 10DLC ISV corrections (vetting + per-tenant fees + kill-switch)
-- Builds on 20260619000022_a2p_registration.sql.
-- ============================================================================

-- vetting lifecycle states
alter type public.a2p_step add value if not exists 'vetting_requested';
alter type public.a2p_step add value if not exists 'vetting_complete';

-- track ENHANCED brand vetting + the per-tenant registration fees Renuvo paid
alter table public.a2p_registrations
  add column if not exists vetting_requested boolean not null default false,
  add column if not exists fees_paid_cents    int not null default 0,
  add column if not exists fees_charged_at    timestamptz;

-- ISV kill-switch: instantly suspend a tenant's sending (compliance/violation).
alter table public.organizations
  add column messaging_suspended        boolean not null default false,
  add column messaging_suspended_reason text;
