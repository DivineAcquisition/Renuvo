-- ============================================================================
-- RENUVO — MESSAGE TEMPLATES  (vertical-keyed; org overrides global defaults)
-- ============================================================================

create type public.template_event_key as enum (
  'post_payment_activation',   -- immediate, post-payment greeting (carries opt-out)
  'conversion_offer',          -- the recurring offer
  'reminder',                  -- nudge if no reply
  'objection_followup',        -- response to hesitation
  'recurring_confirmation',    -- they accepted → confirmed
  'winback',                   -- re-engage a lapsed customer
  'save_offer'                 -- retention: offer to keep an at-risk plan
);

create table public.message_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,  -- NULL = global default
  vertical_id     uuid not null references public.verticals(id) on delete cascade,
  event_key       public.template_event_key not null,
  channel         text not null default 'sms',
  body            text not null,                 -- supports {{merge_vars}}
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One GLOBAL default per (vertical, event)
create unique index uniq_template_global
  on public.message_templates (vertical_id, event_key)
  where organization_id is null;

-- One ORG override per (org, vertical, event)
create unique index uniq_template_org
  on public.message_templates (organization_id, vertical_id, event_key)
  where organization_id is not null;

create index idx_templates_lookup
  on public.message_templates (vertical_id, event_key, organization_id);

create trigger trg_templates_updated
  before update on public.message_templates
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RESOLVER (org override → global fallback)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- resolve_template() — returns the active body for an org/vertical/event,
-- preferring the org's override, falling back to the global default.
-- Used by the agent (service-role) and the app.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_template(
  p_org_id      uuid,
  p_vertical_id uuid,
  p_event_key   public.template_event_key
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select body
  from public.message_templates
  where vertical_id = p_vertical_id
    and event_key = p_event_key
    and is_active = true
    and (organization_id = p_org_id or organization_id is null)
  order by (organization_id is not null) desc   -- org row first, then global
  limit 1;
$$;

grant execute on function public.resolve_template(uuid, uuid, public.template_event_key)
  to authenticated;

-- ============================================================================
-- SEED — global cleaning pack
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Global default templates for the CLEANING vertical (beachhead).
-- Lawn/pool/pest packs are added later as seed inserts (config, not code).
-- Keep each body < 320 chars. First message carries opt-out language.
-- ----------------------------------------------------------------------------
insert into public.message_templates (organization_id, vertical_id, event_key, body)
select null, v.id, t.event_key::public.template_event_key, t.body
from public.verticals v
join (values
  ('post_payment_activation',
   'Hi {{first_name}}, it''s {{business_name}} 👋 Thanks for your booking today — hope your home looks amazing! Quick question coming your way. Reply STOP to opt out anytime.'),
  ('conversion_offer',
   '{{first_name}}, want us back automatically {{cadence_label}}? We''ll hold your spot and bill {{price}} — no rebooking, cancel anytime. Want me to set it up?'),
  ('reminder',
   'Hi {{first_name}}, still want to lock in your {{cadence_label}} cleaning with {{business_name}}? It takes one tap: {{booking_link}}'),
  ('objection_followup',
   'Totally understand, {{first_name}}. Recurring just means one less thing to remember — and you can pause or cancel anytime. Want me to send the details?'),
  ('recurring_confirmation',
   'You''re all set, {{first_name}}! 🎉 {{business_name}} will see you {{cadence_label}}. We''ll text before each visit. Manage anytime here: {{booking_link}}'),
  ('winback',
   'Hi {{first_name}}, we''ve missed taking care of your home! Ready to restart your {{cadence_label}} service with {{business_name}}? Reply YES and we''ll handle the rest.'),
  ('save_offer',
   '{{first_name}}, before you go — we''d hate to lose you. Could we keep your {{cadence_label}} service going at a special rate? Reply YES and I''ll sort it out.')
) as t(event_key, body)
  on v.key = 'cleaning';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.message_templates enable row level security;

-- Read: global defaults (org is null) are readable by any authenticated user;
-- org overrides only by that org's members.
create policy "templates_select" on public.message_templates
  for select using (
    organization_id is null
    or organization_id in (select public.auth_org_ids())
  );

-- Write: ONLY org-scoped overrides, only by that org's members.
-- Global defaults are not writable via the API (migrations/service-role only).
create policy "templates_insert_org" on public.message_templates
  for insert with check (organization_id in (select public.auth_org_ids()));

create policy "templates_update_org" on public.message_templates
  for update using (organization_id in (select public.auth_org_ids()))
            with check (organization_id in (select public.auth_org_ids()));

create policy "templates_delete_org" on public.message_templates
  for delete using (organization_id in (select public.auth_org_ids()));
