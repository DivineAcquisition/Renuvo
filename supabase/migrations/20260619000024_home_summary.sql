-- ============================================================================
-- RENUVO — HOME SUMMARY (everything the post-login home needs, one round trip)
-- Adapted to Renuvo's actual schema: prices in cents + cadence_profiles for
-- interval, agent_paused on customers, risk_level on plans (no conversations
-- table, no last_payment_failed column).
-- ============================================================================
create or replace function public.get_home_summary(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not exists (
    select 1 from public.memberships
    where organization_id = p_org_id and profile_id = auth.uid()
  ) then raise exception 'forbidden'; end if;

  select jsonb_build_object(
    'setup', jsonb_build_object(
      'onboarding_complete',  (o.onboarding_completed_at is not null),
      'stripe_connected',     (o.stripe_account_id is not null),
      'subscription_status',  o.subscription_status,
      'a2p_status',           o.a2p_status,
      'messaging_suspended',  coalesce(o.messaging_suspended, false),
      'has_number',           (o.telnyx_phone_number is not null),
      'has_customers',        coalesce(cu.cnt, 0) > 0,
      'wallet_balance_cents', coalesce(w.balance_cents, 0)
    ),
    'snapshot', jsonb_build_object(
      'active_plans',     coalesce(p.active_plans, 0),
      'mrr_microdollars', coalesce(p.mrr_micro, 0),
      'conversions_7d',   coalesce(c7.cnt, 0),
      'pending_messages', coalesce(sm.cnt, 0)
    ),
    'attention', jsonb_build_object(
      'at_risk_plans',      coalesce(ar.cnt, 0),
      'replies_need_human', coalesce(rh.cnt, 0),
      'failed_payments',    coalesce(fp.cnt, 0),
      'wallet_low',         (coalesce(w.balance_cents, 0) < 500)
    )
  )
  into result
  from public.organizations o
  left join public.wallets w on w.organization_id = o.id
  left join lateral (
    select count(*) cnt from public.customers where organization_id = o.id
  ) cu on true
  left join lateral (
    select count(*) filter (where rp.status = 'active') active_plans,
           coalesce(
             sum((rp.price_cents::numeric * (30.0 / cp.interval_days)) * 10000)
               filter (where rp.status = 'active'),
             0
           )::bigint mrr_micro
    from public.recurring_plans rp
    join public.cadence_profiles cp on cp.id = rp.cadence_profile_id
    where rp.organization_id = o.id
  ) p on true
  left join lateral (
    select count(*) cnt from public.recurring_plans
    where organization_id = o.id and created_at >= now() - interval '7 days'
  ) c7 on true
  left join lateral (
    select count(*) cnt from public.scheduled_messages
    where organization_id = o.id and status = 'pending'
  ) sm on true
  left join lateral (
    select count(*) cnt from public.recurring_plans
    where organization_id = o.id and status = 'active' and risk_level = 'medium'
  ) ar on true
  left join lateral (
    select count(*) cnt from public.customers
    where organization_id = o.id and agent_paused = true
  ) rh on true
  left join lateral (
    select count(*) cnt from public.recurring_plans
    where organization_id = o.id and status = 'active' and risk_level = 'high'
  ) fp on true
  where o.id = p_org_id;

  return result;
end$$;

grant execute on function public.get_home_summary(uuid) to authenticated;
