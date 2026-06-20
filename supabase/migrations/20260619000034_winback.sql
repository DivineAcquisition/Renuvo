-- ============================================================================
-- RENUVO — WIN-BACK / REACTIVATION (eligibility, attempts, offer, tracking)
-- Three kinds of "gone", three motions: voluntary (win-back offer),
-- involuntary (payment recovery / dunning — NOT a sale), lapse (reactivation).
-- ============================================================================
create type public.winback_kind as enum ('voluntary','involuntary','lapse');
create type public.winback_status as enum (
  'eligible','in_progress','recovered','exhausted','suppressed'
);

create table public.winback_campaigns (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  customer_id       uuid not null references public.customers(id) on delete cascade,
  recurring_plan_id uuid references public.recurring_plans(id) on delete set null, -- null for lapse
  kind              public.winback_kind not null,
  status            public.winback_status not null default 'eligible',
  attempt_count     int not null default 0,
  eligible_at       timestamptz not null,        -- now() + cooldown
  last_attempt_at   timestamptz,
  recovered_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (organization_id, customer_id, recurring_plan_id, kind)
);
create index idx_winback_due
  on public.winback_campaigns (organization_id, status, eligible_at);

alter table public.winback_campaigns enable row level security;
create policy "winback_select_org" on public.winback_campaigns
  for select using (organization_id in (select public.auth_org_ids()));

-- win-back tuning lives with the offer config (Prompt 33), extended:
alter table public.offer_configs
  add column winback_enabled        boolean not null default false,
  add column winback_discount_pct   numeric not null default 0
    check (winback_discount_pct between 0 and 90),
  add column winback_cooldown_days  int not null default 14,   -- wait before first attempt
  add column winback_max_attempts   int not null default 2,    -- hard cap (anti-spam)
  add column winback_retry_gap_days int not null default 21;   -- spacing between attempts

-- honest reporting: record the win-back incentive on the reactivated plan
alter table public.recurring_plans
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- a win-back capture link carries its own (discounted) offer
alter table public.signup_links
  add column if not exists winback_discount_pct numeric not null default 0;

-- distinct message intents: dunning (no discount) + lapse re-book.
-- Added here but NOT used in this migration (safe enum extension).
alter type public.template_event_key add value if not exists 'payment_recovery';
alter type public.template_event_key add value if not exists 'reactivation';
