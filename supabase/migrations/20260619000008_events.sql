-- ============================================================================
-- RENUVO — EVENTS  (append-only instrumentation spine; agent + analytics)
-- ============================================================================

create type public.event_source as enum ('stripe', 'telnyx', 'agent', 'system', 'app');

create type public.event_type as enum (
  -- payments
  'payment_succeeded',
  'payment_refunded',
  -- messaging
  'message_sent',
  'message_delivered',
  'message_failed',
  'reply_received',
  -- conversion / lifecycle (analytics mirrors of key moments)
  'activation_sent',
  'conversion_offer_sent',
  'recurring_booked',
  'opted_out',
  -- engine
  'scheduled_message_queued',
  'agent_action'
);

create type public.msg_direction as enum ('outbound', 'inbound');

create table public.events (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id)    on delete cascade,
  customer_id           uuid references public.customers(id)                 on delete set null,
  job_id                uuid references public.jobs(id)                       on delete set null,
  recurring_plan_id     uuid references public.recurring_plans(id)            on delete set null,

  type                  public.event_type   not null,
  source                public.event_source not null,

  -- messaging detail (null for non-message events)
  channel               text,                       -- 'sms'
  direction             public.msg_direction,
  body                  text,                        -- message content (for thread reconstruction)

  -- link a send event to the wallet debit that paid for it (Prompt 8)
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,

  -- idempotency for external webhooks (stripe event id, telnyx message id)
  external_id           text,

  payload               jsonb not null default '{}'::jsonb,
  occurred_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index idx_events_org_time   on public.events (organization_id, occurred_at desc);
create index idx_events_type       on public.events (organization_id, type);
create index idx_events_customer    on public.events (customer_id, occurred_at desc);
create index idx_events_plan        on public.events (recurring_plan_id, occurred_at desc);

-- IDEMPOTENCY: one event per external source+id (skip re-delivered webhooks)
create unique index uniq_events_external
  on public.events (source, external_id)
  where external_id is not null;

-- ============================================================================
-- record_event() helper (service-role, idempotent)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- record_event() — single entry point the engine/webhooks use to log.
-- Idempotent: if (source, external_id) already exists, returns the existing
-- event id instead of inserting (handles webhook re-delivery cleanly).
-- ----------------------------------------------------------------------------
create or replace function public.record_event(
  p_org_id     uuid,
  p_type       public.event_type,
  p_source     public.event_source,
  p_customer_id uuid default null,
  p_job_id     uuid default null,
  p_plan_id    uuid default null,
  p_channel    text default null,
  p_direction  public.msg_direction default null,
  p_body       text default null,
  p_external_id text default null,
  p_wallet_txn_id uuid default null,
  p_payload    jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  new_id      uuid;
begin
  if p_external_id is not null then
    select id into existing_id from public.events
    where source = p_source and external_id = p_external_id;
    if existing_id is not null then
      return existing_id;  -- already processed
    end if;
  end if;

  insert into public.events
    (organization_id, type, source, customer_id, job_id, recurring_plan_id,
     channel, direction, body, external_id, wallet_transaction_id, payload)
  values
    (p_org_id, p_type, p_source, p_customer_id, p_job_id, p_plan_id,
     p_channel, p_direction, p_body, p_external_id, p_wallet_txn_id, p_payload)
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.record_event(uuid,public.event_type,public.event_source,uuid,uuid,uuid,text,public.msg_direction,text,text,uuid,jsonb) from public;
grant  execute on function public.record_event(uuid,public.event_type,public.event_source,uuid,uuid,uuid,text,public.msg_direction,text,text,uuid,jsonb) to service_role, authenticated;

-- ============================================================================
-- ROW LEVEL SECURITY (read for tenants; append-only)
-- ============================================================================

alter table public.events enable row level security;

-- members read their org's events
create policy "events_select_org" on public.events
  for select using (organization_id in (select public.auth_org_ids()));

-- members may append their org's events (e.g. manual human-takeover send);
-- engine/webhooks append via service-role. NO update/delete policy → append-only.
create policy "events_insert_org" on public.events
  for insert with check (organization_id in (select public.auth_org_ids()));
