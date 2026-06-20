-- ============================================================================
-- RENUVO — BENCHMARK / IP LAYER (platform-admin only, anonymized, k≥5)
-- ============================================================================
create table public.platform_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
-- no policies → not readable/writable by anyone via the API; managed by you in SQL.

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where profile_id = auth.uid());
$$;
grant execute on function public.is_platform_admin() to authenticated;

-- Seed yourself (run once, replace with your profile id):
-- insert into public.platform_admins (profile_id) values ('<YOUR_PROFILE_UUID>');

-- ============================================================================
-- ANONYMIZED BENCHMARKS (k ≥ 5 distinct orgs enforced on every aggregate)
-- ============================================================================

-- ---- conversion rate by vertical (median across orgs) --------------------
create or replace function public.bench_conversion_by_vertical()
returns table (vertical text, org_count int, median_conversion_pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return query
  with per_org as (
    select o.id org_id, o.vertical_id,
           count(distinct rp.id)::numeric
             / nullif(count(distinct jt.customer_id), 0) conv
    from public.organizations o
    left join public.jobs jt on jt.organization_id = o.id and jt.kind = 'one_time'
    left join public.recurring_plans rp on rp.organization_id = o.id
    group by o.id, o.vertical_id
    having count(distinct jt.customer_id) > 0
  )
  select v.key, count(*)::int,
         round(percentile_cont(0.5) within group (order by conv) * 100, 1)
  from per_org po join public.verticals v on v.id = po.vertical_id
  group by v.key
  having count(*) >= 5;  -- k-anonymity
end$$;

-- ---- median time-to-rebook by vertical (days) ----------------------------
create or replace function public.bench_ttr_by_vertical()
returns table (vertical text, org_count int, median_ttr_days numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return query
  with per_org as (
    select o.id org_id, o.vertical_id,
           percentile_cont(0.5) within group
             (order by extract(epoch from (p.started_at - j.paid_at))) med
    from public.organizations o
    join public.recurring_plans p on p.organization_id = o.id
    join public.jobs j on j.id = p.origin_job_id
    where p.started_at is not null and j.paid_at is not null
    group by o.id, o.vertical_id
  )
  select v.key, count(*)::int,
         round(percentile_cont(0.5) within group (order by med) / 86400.0, 1)
  from per_org po join public.verticals v on v.id = po.vertical_id
  where po.med is not null
  group by v.key
  having count(*) >= 5;
end$$;

-- ---- objection / intent mix (aggregate, all orgs) ------------------------
create or replace function public.bench_intent_mix()
returns table (intent text, occurrences bigint, org_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return query
  select e.payload->>'intent' as intent,
         count(*) occurrences,
         count(distinct e.organization_id)::int org_count
  from public.events e
  where e.type = 'agent_action'
    and e.payload->>'action' = 'intent_classified'
    and e.payload ? 'intent'
  group by e.payload->>'intent'
  having count(distinct e.organization_id) >= 5;
end$$;

-- ---- cancellation reasons (aggregate) ------------------------------------
create or replace function public.bench_cancellation_reasons()
returns table (reason text, occurrences bigint, org_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return query
  select coalesce(cancellation_reason, 'unspecified') reason,
         count(*) occurrences,
         count(distinct organization_id)::int org_count
  from public.recurring_plans
  where status = 'cancelled'
  group by coalesce(cancellation_reason, 'unspecified')
  having count(distinct organization_id) >= 5;
end$$;

-- ---- save-offer & winback effectiveness (aggregate) ----------------------
create or replace function public.bench_retention_effectiveness()
returns table (metric text, numerator bigint, denominator bigint, rate_pct numeric, org_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return query
  with agg as (
    select
      count(*) filter (where type='save_offer_accepted') save_acc,
      count(*) filter (where type='save_offer_sent')     save_sent,
      count(*) filter (where type='winback_recovered')   wb_rec,
      count(*) filter (where type='winback_sent')        wb_sent,
      count(distinct organization_id) orgs
    from public.retention_events
  )
  select 'save_offer', save_acc, save_sent,
         case when save_sent>0 then round(save_acc::numeric/save_sent*100,1) else 0 end, orgs::int
  from agg where orgs >= 5
  union all
  select 'winback', wb_rec, wb_sent,
         case when wb_sent>0 then round(wb_rec::numeric/wb_sent*100,1) else 0 end, orgs::int
  from agg where orgs >= 5;
end$$;

grant execute on function public.bench_conversion_by_vertical()    to authenticated;
grant execute on function public.bench_ttr_by_vertical()           to authenticated;
grant execute on function public.bench_intent_mix()                to authenticated;
grant execute on function public.bench_cancellation_reasons()      to authenticated;
grant execute on function public.bench_retention_effectiveness()   to authenticated;
