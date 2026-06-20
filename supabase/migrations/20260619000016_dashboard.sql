-- ============================================================================
-- RENUVO — DASHBOARD METRICS + human takeover flag
-- ============================================================================
alter table public.customers add column agent_paused boolean not null default false;

-- ----------------------------------------------------------------------------
-- get_dashboard_metrics() — one call, all headline numbers (org-scoped)
-- ----------------------------------------------------------------------------
create or replace function public.get_dashboard_metrics(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not exists (select 1 from public.memberships
                 where organization_id = p_org_id and profile_id = auth.uid()) then
    raise exception 'forbidden';
  end if;

  with
  one_time as (
    select count(*) c, count(distinct customer_id) cust
    from public.jobs where organization_id = p_org_id and kind = 'one_time'
  ),
  plans as (select * from public.recurring_plans where organization_id = p_org_id),
  active_plans as (select * from plans where status = 'active'),
  mrr as (
    select coalesce(sum(ap.price_cents * (30.0 / cp.interval_days)), 0) cents
    from active_plans ap join public.cadence_profiles cp on cp.id = ap.cadence_profile_id
  ),
  ttr as (
    select percentile_cont(0.5) within group
      (order by extract(epoch from (p.started_at - j.paid_at))) med
    from plans p join public.jobs j on j.id = p.origin_job_id
    where p.started_at is not null and j.paid_at is not null
  ),
  churn as (
    select count(*) filter (where status = 'cancelled') cancelled,
           count(*) filter (where status in ('active','cancelled','paused')) total
    from plans
  ),
  msgs as (
    select count(*) filter (where direction = 'outbound') outc,
           count(*) filter (where direction = 'inbound')  inc
    from public.events where organization_id = p_org_id
  ),
  atrisk as (select count(*) c from active_plans where risk_level in ('medium','high'))
  select jsonb_build_object(
    'one_time_jobs',  (select c from one_time),
    'plans_total',    (select count(*) from plans),
    'active_plans',   (select count(*) from active_plans),
    'conversion_rate', case when (select cust from one_time) > 0
       then round((select count(*) from plans)::numeric / (select cust from one_time) * 100, 1) else 0 end,
    'mrr_cents',      (select cents from mrr)::bigint,
    'arr_cents',      ((select cents from mrr) * 12)::bigint,
    'median_ttr_days', round(coalesce((select med from ttr), 0) / 86400.0, 1),
    'churn_rate', case when (select total from churn) > 0
       then round((select cancelled from churn)::numeric / (select total from churn) * 100, 1) else 0 end,
    'reply_rate', case when (select outc from msgs) > 0
       then round((select inc from msgs)::numeric / (select outc from msgs) * 100, 1) else 0 end,
    'at_risk',        (select c from atrisk)
  ) into result;
  return result;
end$$;

-- ----------------------------------------------------------------------------
-- get_monthly_conversions() — last 6 months of plans created (for the chart)
-- ----------------------------------------------------------------------------
create or replace function public.get_monthly_conversions(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not exists (select 1 from public.memberships
                 where organization_id = p_org_id and profile_id = auth.uid()) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon'), 'conversions', coalesce(c, 0)) order by m), '[]'::jsonb)
  into result
  from generate_series(date_trunc('month', now()) - interval '5 months',
                       date_trunc('month', now()), interval '1 month') m
  left join (
    select date_trunc('month', created_at) mm, count(*) c
    from public.recurring_plans where organization_id = p_org_id
    group by 1
  ) x on x.mm = m;
  return result;
end$$;

grant execute on function public.get_dashboard_metrics(uuid)   to authenticated;
grant execute on function public.get_monthly_conversions(uuid) to authenticated;
