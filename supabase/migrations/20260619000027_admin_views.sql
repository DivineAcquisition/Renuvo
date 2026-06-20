-- ============================================================================
-- RENUVO — ADMIN: tenant health roll-up (operational only; NO customer PII)
-- ============================================================================
create or replace function public.admin_tenant_directory()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'created_at', o.created_at,
      'subscription_status', o.subscription_status,
      'a2p_status', o.a2p_status,
      'messaging_suspended', coalesce(o.messaging_suspended, false),
      'active_plans', coalesce(p.cnt, 0),
      'mrr_microdollars', coalesce(p.mrr, 0),
      'wallet_balance_cents', coalesce(w.balance_cents, 0)
    ) as t
    from public.organizations o
    left join lateral (
      select count(*) filter (where rp.status='active') as cnt,
             coalesce(
               sum((rp.price_cents::numeric * (30.0 / cp.interval_days)) * 10000)
                 filter (where rp.status='active'),
               0
             )::bigint as mrr
      from public.recurring_plans rp
      join public.cadence_profiles cp on cp.id = rp.cadence_profile_id
      where rp.organization_id = o.id
    ) p on true
    left join public.wallets w on w.organization_id = o.id
  ) sub;
  return result;
end$$;
grant execute on function public.admin_tenant_directory() to authenticated;
