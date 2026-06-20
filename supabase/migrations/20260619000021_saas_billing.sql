-- ============================================================================
-- RENUVO — SAAS SUBSCRIPTION (flow #1: tenant pays Renuvo on the PLATFORM acct)
-- Entirely separate from connected-account recurring billing (flow #3).
-- ============================================================================
create type public.sub_status as enum ('none','trialing','active','past_due','canceled');

create table public.subscription_plans (
  id            text primary key,                    -- 'starter' | 'pro' | ...
  name          text not null,
  price_cents   int not null,                        -- monthly platform fee
  currency      text not null default 'usd',
  stripe_price_id text,                              -- the platform-account Price
  features      jsonb not null default '{}'::jsonb,  -- limits/flags
  active        boolean not null default true
);

-- tenant billing state (one row per org)
alter table public.organizations
  add column subscription_status      public.sub_status not null default 'none',
  add column subscription_plan_id     text references public.subscription_plans(id),
  add column platform_customer_id     text,            -- Stripe customer on PLATFORM acct (shared w/ wallet)
  add column platform_subscription_id text,
  add column trial_ends_at            timestamptz,
  add column current_period_end       timestamptz;

-- seed plans (edit prices to your model)
insert into public.subscription_plans (id, name, price_cents, features) values
  ('starter', 'Starter', 9700,  '{"max_active_plans": 100}'),
  ('pro',     'Pro',     19700, '{"max_active_plans": 1000}')
on conflict (id) do nothing;

-- one platform customer per org funds BOTH the SaaS sub and the wallet:
-- backfill the org pointer from the wallet's customer where present.
update public.organizations o
set platform_customer_id = w.stripe_customer_id
from public.wallets w
where w.organization_id = o.id
  and w.stripe_customer_id is not null
  and o.platform_customer_id is null;

-- subscription_plans is global reference data: any authenticated user may read.
alter table public.subscription_plans enable row level security;
create policy "sub_plans_select" on public.subscription_plans
  for select using (true);

-- SaaS fee → platform revenue in the unified ledger (extends Prompt 29).
alter type public.fin_category add value if not exists 'saas_fee';
