-- ============================================================================
-- RENUVO — TELNYX (per-tenant sending number + A2P 10DLC registration state)
-- ============================================================================
create type public.a2p_status as enum ('not_started', 'pending', 'approved', 'rejected');

alter table public.organizations
  add column telnyx_phone_number       text,           -- E.164 sending number for this tenant
  add column telnyx_messaging_profile_id text,
  add column a2p_status                public.a2p_status not null default 'not_started',
  add column a2p_brand_id              text,
  add column a2p_campaign_id           text;

create unique index uniq_org_telnyx_number
  on public.organizations (telnyx_phone_number)
  where telnyx_phone_number is not null;
