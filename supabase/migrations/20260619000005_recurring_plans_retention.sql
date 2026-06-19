-- ============================================================================
-- RENUVO — RECURRING PLANS & RETENTION  (the owned recurring layer)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
create type public.plan_status      as enum ('pending', 'active', 'paused', 'cancelled');
create type public.plan_risk_level  as enum ('none', 'low', 'medium', 'high');

create type public.retention_event_type as enum (
  'plan_created',
  'activated',
  'paused',
  'resumed',
  'churn_risk_flagged',
  'save_offer_sent',
  'save_offer_accepted',
  'save_offer_declined',
  'cancelled',
  'winback_sent',
  'winback_recovered',
  'payment_failed',
  'payment_recovered'
);

-- ----------------------------------------------------------------------------
-- TABLE: recurring_plans  (the owned, system-of-record recurring relationship)
-- ----------------------------------------------------------------------------
create table public.recurring_plans (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id)   on delete cascade,
  customer_id            uuid not null references public.customers(id)        on delete cascade,
  origin_job_id          uuid references public.jobs(id) on delete set null,  -- the one-time job that converted
  cadence_profile_id     uuid not null references public.cadence_profiles(id),

  status                 public.plan_status     not null default 'pending',
  risk_level             public.plan_risk_level not null default 'none',
  health_score           int,                                                 -- 0–100, set by signals

  price_cents            int not null,
  currency               text not null default 'usd',

  -- recurring billing that RENUVO owns (created on the tenant's connected acct)
  stripe_subscription_id text,
  stripe_customer_id     text,

  -- lifecycle timestamps
  started_at             timestamptz,
  next_service_at        timestamptz,
  paused_at              timestamptz,
  cancelled_at           timestamptz,
  cancellation_reason    text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- one active plan per customer (a customer can have a past cancelled plan + a new one,
-- so we scope uniqueness to active/pending, not all-time)
create unique index uniq_plan_active_customer
  on public.recurring_plans (customer_id)
  where status in ('pending', 'active');

-- one plan per Stripe subscription (idempotency for billing webhooks)
create unique index uniq_plan_subscription
  on public.recurring_plans (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index idx_plans_org      on public.recurring_plans (organization_id);
create index idx_plans_customer on public.recurring_plans (customer_id);
create index idx_plans_status   on public.recurring_plans (organization_id, status);
create index idx_plans_risk     on public.recurring_plans (organization_id, risk_level)
  where status = 'active';

create trigger trg_plans_updated
  before update on public.recurring_plans
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- TABLE: retention_events  (the lifecycle ledger for each plan — append-only)
-- ----------------------------------------------------------------------------
create table public.retention_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id)     on delete cascade,
  recurring_plan_id uuid not null references public.recurring_plans(id)    on delete cascade,
  customer_id       uuid not null references public.customers(id)          on delete cascade,
  type              public.retention_event_type not null,
  reason            text,
  meta              jsonb not null default '{}'::jsonb,
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index idx_retention_org   on public.retention_events (organization_id, occurred_at);
create index idx_retention_plan  on public.retention_events (recurring_plan_id, occurred_at);
create index idx_retention_type  on public.retention_events (organization_id, type);

-- ----------------------------------------------------------------------------
-- Link jobs → recurring_plans. Recurring job instances belong to a plan.
-- (parent_job_id from Prompt 5 stays for origin linkage; the plan is the owner.)
-- ----------------------------------------------------------------------------
alter table public.jobs
  add column recurring_plan_id uuid references public.recurring_plans(id) on delete set null;

create index idx_jobs_plan on public.jobs (recurring_plan_id);

-- ============================================================================
-- ROW LEVEL SECURITY (tenant-scoped)
-- ============================================================================

alter table public.recurring_plans  enable row level security;
alter table public.retention_events enable row level security;

-- recurring_plans: full tenant access for members
create policy "plans_select_org" on public.recurring_plans
  for select using (organization_id in (select public.auth_org_ids()));
create policy "plans_insert_org" on public.recurring_plans
  for insert with check (organization_id in (select public.auth_org_ids()));
create policy "plans_update_org" on public.recurring_plans
  for update using (organization_id in (select public.auth_org_ids()))
            with check (organization_id in (select public.auth_org_ids()));
create policy "plans_delete_org" on public.recurring_plans
  for delete using (organization_id in (select public.auth_org_ids()));

-- retention_events: read for members; append-only (no update/delete policy)
create policy "retention_select_org" on public.retention_events
  for select using (organization_id in (select public.auth_org_ids()));
create policy "retention_insert_org" on public.retention_events
  for insert with check (organization_id in (select public.auth_org_ids()));

-- ============================================================================
-- TRANSACTIONAL PLAN HELPERS
-- Plan status changes and their retention_event MUST never desync, so each is
-- a single function (one transaction). SECURITY INVOKER (default) so tenant RLS
-- still governs in-app callers; the service-role client bypasses RLS as usual.
-- ============================================================================

-- create a plan in 'pending' and log 'plan_created' atomically
create or replace function public.create_recurring_plan(
  p_org      uuid,
  p_customer uuid,
  p_origin_job uuid,
  p_cadence  uuid,
  p_price_cents int,
  p_currency text default 'usd'
)
returns public.recurring_plans
language plpgsql
set search_path = public
as $$
declare
  v_plan public.recurring_plans;
begin
  insert into public.recurring_plans
    (organization_id, customer_id, origin_job_id, cadence_profile_id, price_cents, currency, status)
  values
    (p_org, p_customer, p_origin_job, p_cadence, p_price_cents, coalesce(p_currency, 'usd'), 'pending')
  returning * into v_plan;

  insert into public.retention_events (organization_id, recurring_plan_id, customer_id, type)
  values (p_org, v_plan.id, p_customer, 'plan_created');

  return v_plan;
end;
$$;

-- activate a plan (attach the Stripe subscription) and log 'activated' atomically
create or replace function public.activate_plan(
  p_plan uuid,
  p_stripe_subscription_id text default null,
  p_started_at timestamptz default null,
  p_next_service_at timestamptz default null
)
returns public.recurring_plans
language plpgsql
set search_path = public
as $$
declare
  v_plan public.recurring_plans;
begin
  update public.recurring_plans
  set status                 = 'active',
      stripe_subscription_id = coalesce(p_stripe_subscription_id, stripe_subscription_id),
      started_at             = coalesce(p_started_at, started_at, now()),
      next_service_at        = coalesce(p_next_service_at, next_service_at)
  where id = p_plan
  returning * into v_plan;

  if v_plan.id is null then
    raise exception 'plan % not found or not permitted', p_plan;
  end if;

  insert into public.retention_events (organization_id, recurring_plan_id, customer_id, type)
  values (v_plan.organization_id, v_plan.id, v_plan.customer_id, 'activated');

  return v_plan;
end;
$$;

-- pause / resume / cancel a plan, stamping the matching timestamp + retention_event
create or replace function public.change_plan_status(
  p_plan   uuid,
  p_status public.plan_status,
  p_reason text default null
)
returns public.recurring_plans
language plpgsql
set search_path = public
as $$
declare
  v_plan public.recurring_plans;
  v_evt  public.retention_event_type;
begin
  update public.recurring_plans
  set status              = p_status,
      paused_at           = case when p_status = 'paused'    then now()    else paused_at end,
      cancelled_at        = case when p_status = 'cancelled' then now()    else cancelled_at end,
      cancellation_reason = case when p_status = 'cancelled' then p_reason else cancellation_reason end
  where id = p_plan
  returning * into v_plan;

  if v_plan.id is null then
    raise exception 'plan % not found or not permitted', p_plan;
  end if;

  v_evt := case p_status
    when 'paused'    then 'paused'::public.retention_event_type
    when 'active'    then 'resumed'::public.retention_event_type
    when 'cancelled' then 'cancelled'::public.retention_event_type
    else null
  end;

  if v_evt is not null then
    insert into public.retention_events
      (organization_id, recurring_plan_id, customer_id, type, reason)
    values (v_plan.organization_id, v_plan.id, v_plan.customer_id, v_evt, p_reason);
  end if;

  return v_plan;
end;
$$;

grant execute on function public.create_recurring_plan(uuid, uuid, uuid, uuid, int, text) to authenticated;
grant execute on function public.activate_plan(uuid, text, timestamptz, timestamptz)        to authenticated;
grant execute on function public.change_plan_status(uuid, public.plan_status, text)          to authenticated;
