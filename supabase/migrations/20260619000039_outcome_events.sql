-- ============================================================================
-- RENUVO — OUTCOME EVENT SPINE (the substrate for intelligence AND finance)
-- Append-only, anonymizable, the source of truth for cross-tenant learning.
-- Cross-tenant reads ONLY via security-definer functions that enforce k-anonymity.
-- ============================================================================
create type public.outcome_type as enum (
  'capture_sent',
  'capture_opened',
  'plan_activated',
  'plan_canceled',
  'plan_failed',
  'plan_recovered',
  'visit_completed',
  'reply_classified'
);

create table public.outcome_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type            public.outcome_type not null,
  occurred_at     timestamptz not null default now(),
  -- DIMENSIONS for cohorting (no PII — categorical features only)
  vertical        text,
  region_bucket   text,                  -- coarse geo (state/metro), NEVER address
  cadence         text,
  -- FEATURES for learning (categorical/numeric only, no identities)
  message_template_key text,
  discount_pct    numeric,
  sequence_step   int,
  hour_of_day     int,
  day_of_week     int,
  -- soft links (this org's own drill-down only; stripped in cross-tenant agg)
  recurring_plan_id uuid,
  customer_id     uuid,
  meta            jsonb not null default '{}'::jsonb
);
create index idx_outcome_type_time on public.outcome_events (type, occurred_at desc);
create index idx_outcome_org on public.outcome_events (organization_id, type, occurred_at desc);
create index idx_outcome_cohort on public.outcome_events (vertical, region_bucket, cadence);

alter table public.outcome_events enable row level security;
-- a tenant reads ONLY its own raw events; cross-tenant aggregates come via the
-- security-definer functions below (k-anonymity enforced). No raw cross-tenant read.
create policy "outcome_select_own" on public.outcome_events
  for select using (organization_id in (select public.auth_org_ids()));

-- predictive churn outputs (Part 4) — transparent score + reason
alter table public.recurring_plans
  add column risk_score int,
  add column risk_reason text;

-- ----------------------------------------------------------------------------
-- helper: resolve a tenant's cohort dimensions from its most-recent outcome event
-- ----------------------------------------------------------------------------
create or replace function public.bench_conversion(
  p_org_id uuid, p_window interval default interval '90 days'
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_vertical text; v_region text; v_self numeric; v_cohort numeric; v_k int;
begin
  if not exists (select 1 from public.memberships where organization_id=p_org_id and profile_id=auth.uid())
    then raise exception 'forbidden'; end if;
  select e.vertical, e.region_bucket into v_vertical, v_region
    from public.outcome_events e where e.organization_id=p_org_id
    order by e.occurred_at desc limit 1;

  select (count(*) filter (where type='plan_activated'))::numeric
       / nullif(count(*) filter (where type='capture_sent'),0)
    into v_self from public.outcome_events
   where organization_id=p_org_id and occurred_at >= now()-p_window;

  with per_org as (
    select organization_id,
      (count(*) filter (where type='plan_activated'))::numeric
      / nullif(count(*) filter (where type='capture_sent'),0) as rate
    from public.outcome_events
    where vertical is not distinct from v_vertical
      and region_bucket is not distinct from v_region
      and organization_id <> p_org_id and occurred_at >= now()-p_window
    group by organization_id
    having count(*) filter (where type='capture_sent') >= 20
  )
  select count(*), percentile_cont(0.5) within group (order by rate)
    into v_k, v_cohort from per_org;

  if v_k < 5 then
    return jsonb_build_object('self', v_self, 'cohort', null, 'k', v_k, 'suppressed', true);
  end if;
  return jsonb_build_object('self', v_self, 'cohort', v_cohort, 'k', v_k, 'suppressed', false);
end$$;
grant execute on function public.bench_conversion(uuid, interval) to authenticated;

-- churn rate = (canceled + failed) / activated, vs cohort median (k>=5)
create or replace function public.bench_churn(
  p_org_id uuid, p_window interval default interval '180 days'
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_vertical text; v_region text; v_self numeric; v_cohort numeric; v_k int;
begin
  if not exists (select 1 from public.memberships where organization_id=p_org_id and profile_id=auth.uid())
    then raise exception 'forbidden'; end if;
  select e.vertical, e.region_bucket into v_vertical, v_region
    from public.outcome_events e where e.organization_id=p_org_id
    order by e.occurred_at desc limit 1;

  select (count(*) filter (where type in ('plan_canceled','plan_failed')))::numeric
       / nullif(count(*) filter (where type='plan_activated'),0)
    into v_self from public.outcome_events
   where organization_id=p_org_id and occurred_at >= now()-p_window;

  with per_org as (
    select organization_id,
      (count(*) filter (where type in ('plan_canceled','plan_failed')))::numeric
      / nullif(count(*) filter (where type='plan_activated'),0) as rate
    from public.outcome_events
    where vertical is not distinct from v_vertical
      and region_bucket is not distinct from v_region
      and organization_id <> p_org_id and occurred_at >= now()-p_window
    group by organization_id
    having count(*) filter (where type='plan_activated') >= 10
  )
  select count(*), percentile_cont(0.5) within group (order by rate)
    into v_k, v_cohort from per_org;

  if v_k < 5 then
    return jsonb_build_object('self', v_self, 'cohort', null, 'k', v_k, 'suppressed', true);
  end if;
  return jsonb_build_object('self', v_self, 'cohort', v_cohort, 'k', v_k, 'suppressed', false);
end$$;
grant execute on function public.bench_churn(uuid, interval) to authenticated;

-- reply rate = reply_classified / capture_sent, vs cohort median (k>=5)
create or replace function public.bench_reply_rate(
  p_org_id uuid, p_window interval default interval '90 days'
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_vertical text; v_region text; v_self numeric; v_cohort numeric; v_k int;
begin
  if not exists (select 1 from public.memberships where organization_id=p_org_id and profile_id=auth.uid())
    then raise exception 'forbidden'; end if;
  select e.vertical, e.region_bucket into v_vertical, v_region
    from public.outcome_events e where e.organization_id=p_org_id
    order by e.occurred_at desc limit 1;

  select (count(*) filter (where type='reply_classified'))::numeric
       / nullif(count(*) filter (where type='capture_sent'),0)
    into v_self from public.outcome_events
   where organization_id=p_org_id and occurred_at >= now()-p_window;

  with per_org as (
    select organization_id,
      (count(*) filter (where type='reply_classified'))::numeric
      / nullif(count(*) filter (where type='capture_sent'),0) as rate
    from public.outcome_events
    where vertical is not distinct from v_vertical
      and region_bucket is not distinct from v_region
      and organization_id <> p_org_id and occurred_at >= now()-p_window
    group by organization_id
    having count(*) filter (where type='capture_sent') >= 20
  )
  select count(*), percentile_cont(0.5) within group (order by rate)
    into v_k, v_cohort from per_org;

  if v_k < 5 then
    return jsonb_build_object('self', v_self, 'cohort', null, 'k', v_k, 'suppressed', true);
  end if;
  return jsonb_build_object('self', v_self, 'cohort', v_cohort, 'k', v_k, 'suppressed', false);
end$$;
grant execute on function public.bench_reply_rate(uuid, interval) to authenticated;

-- which message templates convert best in a cohort (aggregated, volume-gated)
create or replace function public.intel_winning_messages(
  p_vertical text, p_region text default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_platform_admin()
     and not exists (select 1 from public.memberships where profile_id=auth.uid())
    then raise exception 'forbidden'; end if;

  with sent as (
    select message_template_key, count(*) n_sent
    from public.outcome_events
    where type='capture_sent' and vertical=p_vertical
      and (p_region is null or region_bucket=p_region)
      and message_template_key is not null
    group by message_template_key
  ),
  won as (
    select message_template_key, count(*) n_won
    from public.outcome_events
    where type='plan_activated' and vertical=p_vertical
      and (p_region is null or region_bucket=p_region)
      and message_template_key is not null
    group by message_template_key
  )
  select jsonb_agg(jsonb_build_object(
    'template', s.message_template_key,
    'conversion', round((coalesce(w.n_won,0)::numeric / nullif(s.n_sent,0)) * 100, 1),
    'volume', s.n_sent
  ) order by (coalesce(w.n_won,0)::numeric / nullif(s.n_sent,0)) desc)
  into result
  from sent s left join won w using (message_template_key)
  where s.n_sent >= 50;
  return coalesce(result, '[]'::jsonb);
end$$;
grant execute on function public.intel_winning_messages(text, text) to authenticated;
