-- ============================================================================
-- RENUVO — FINANCIAL INTELLIGENCE (derived, read-only measurement of the book)
-- Reads: financial_entries (P29) + outcome_events (P48) + recurring_plans.
-- Writes: ONLY this table. Moves no money, touches no billing flow.
-- This is the stable contract the future "Renuvo Capital" layer will consume.
-- ============================================================================
create table public.book_metrics (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  as_of_date      date not null,
  -- BOOK VALUE
  mrr_microdollars            bigint not null default 0,
  active_plans                int    not null default 0,
  avg_plan_value_microdollars bigint not null default 0,
  -- PREDICTABILITY (the underwriting signals)
  churn_rate_30d              numeric,
  involuntary_churn_rate_30d  numeric,
  collection_rate            numeric,
  mrr_volatility             numeric,
  churn_adjusted_forward_mrr bigint,
  -- TRAJECTORY
  net_revenue_retention      numeric,
  mrr_growth_30d             numeric,
  book_age_days              int,
  -- composite 0..100 (transparent weights)
  book_health_score          int,
  health_reason              text,
  computed_at                timestamptz not null default now(),
  primary key (organization_id, as_of_date)
);
create index idx_bookmetrics_latest on public.book_metrics (organization_id, as_of_date desc);

alter table public.book_metrics enable row level security;
-- a tenant sees ITS OWN book metrics (their asset). Cross-tenant comparison stays
-- in the k-anon intelligence layer (Prompt 48), never here.
create policy "bookmetrics_select_own" on public.book_metrics
  for select using (organization_id in (select public.auth_org_ids()));
