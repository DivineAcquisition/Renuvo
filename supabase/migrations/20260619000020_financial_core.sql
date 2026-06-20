-- ============================================================================
-- RENUVO — UNIFIED FINANCIAL LEDGER (canonical µ$; tenant vs platform money)
-- ============================================================================
create type public.fin_category as enum (
  'wallet_topup',      -- tenant funds their SMS wallet (tenant → Renuvo)
  'sms_charge',        -- tenant billed for a send (tenant wallet out)
  'sms_cost',          -- Renuvo's carrier cost for that send (platform cost)
  'sms_margin',        -- Renuvo's spread on that send (platform revenue)
  'subscription_fee',  -- application fee on a tenant's recurring charge (platform revenue)
  'refund',            -- wallet refund (Renuvo → tenant)
  'adjustment'         -- manual correction
);

-- who the money belongs to / which way it moves
create type public.fin_bucket as enum (
  'tenant_in',         -- money INTO the tenant's wallet balance
  'tenant_out',        -- money OUT of the tenant's wallet (spend)
  'platform_revenue',  -- Renuvo earns
  'platform_cost'      -- Renuvo's cost of goods
);

create table public.financial_entries (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  occurred_at           timestamptz not null default now(),
  category              public.fin_category not null,
  bucket                public.fin_bucket not null,
  amount_microdollars   bigint not null,            -- always POSITIVE; bucket gives direction
  currency              text not null default 'usd',
  source                text not null,              -- 'wallet' | 'stripe' | 'telnyx' | 'system'
  reference             text,                        -- external id (stripe/telnyx) or internal ref
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  recurring_plan_id     uuid references public.recurring_plans(id)     on delete set null,
  meta                  jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index idx_fin_org_time  on public.financial_entries (organization_id, occurred_at desc);
create index idx_fin_bucket    on public.financial_entries (bucket, occurred_at desc);
create index idx_fin_category  on public.financial_entries (organization_id, category);

alter table public.financial_entries enable row level security;
-- tenants read their OWN entries (their spend + their wallet flow). Inserts
-- happen via trigger / service-role only.
create policy "fin_select_org" on public.financial_entries
  for select using (organization_id in (select public.auth_org_ids()));

-- ============================================================================
-- AUTO-MIRROR every wallet_transactions row into the ledger (can't drift)
-- ============================================================================
create or replace function public.mirror_wallet_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.type = 'debit_sms' then
    -- tenant spend (the charge), positive amount in µ$
    insert into public.financial_entries (organization_id, category, bucket, amount_microdollars, source, reference, wallet_transaction_id)
    values (NEW.organization_id, 'sms_charge', 'tenant_out', (NEW.charge_cents::bigint * 10000), 'wallet', NEW.reference, NEW.id);
    -- Renuvo carrier cost
    if NEW.cost_microdollars is not null then
      insert into public.financial_entries (organization_id, category, bucket, amount_microdollars, source, reference, wallet_transaction_id)
      values (NEW.organization_id, 'sms_cost', 'platform_cost', NEW.cost_microdollars, 'wallet', NEW.reference, NEW.id);
    end if;
    -- Renuvo margin
    if NEW.margin_microdollars is not null then
      insert into public.financial_entries (organization_id, category, bucket, amount_microdollars, source, reference, wallet_transaction_id)
      values (NEW.organization_id, 'sms_margin', 'platform_revenue', NEW.margin_microdollars, 'wallet', NEW.reference, NEW.id);
    end if;

  elsif NEW.type in ('credit_reload','credit_manual') then
    insert into public.financial_entries (organization_id, category, bucket, amount_microdollars, source, reference, wallet_transaction_id)
    values (NEW.organization_id, 'wallet_topup', 'tenant_in', (NEW.amount_cents * 10000), 'wallet', NEW.reference, NEW.id);

  elsif NEW.type = 'credit_refund' then
    insert into public.financial_entries (organization_id, category, bucket, amount_microdollars, source, reference, wallet_transaction_id)
    values (NEW.organization_id, 'refund', 'tenant_in', (NEW.amount_cents * 10000), 'wallet', NEW.reference, NEW.id);
  end if;
  return NEW;
end$$;

create trigger trg_wallet_to_ledger
  after insert on public.wallet_transactions
  for each row execute function public.mirror_wallet_to_ledger();

-- ============================================================================
-- REPORTING — the two questions, kept separate
-- ============================================================================

-- TENANT spend (what they paid Renuvo) over a window
create or replace function public.fin_tenant_spend(p_org_id uuid, p_since timestamptz default now() - interval '30 days')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not exists (select 1 from public.memberships where organization_id = p_org_id and profile_id = auth.uid()) then
    raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'wallet_topups_micro', coalesce(sum(amount_microdollars) filter (where category='wallet_topup'),0),
    'sms_spend_micro',     coalesce(sum(amount_microdollars) filter (where category='sms_charge'),0),
    'refunds_micro',       coalesce(sum(amount_microdollars) filter (where category='refund'),0)
  ) into r from public.financial_entries
  where organization_id = p_org_id and occurred_at >= p_since;
  return r;
end$$;

-- PLATFORM revenue (Renuvo's earnings) — platform-admin only, all orgs
create or replace function public.fin_platform_revenue(p_since timestamptz default now() - interval '30 days')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'sms_margin_micro',       coalesce(sum(amount_microdollars) filter (where category='sms_margin'),0),
    'subscription_fees_micro',coalesce(sum(amount_microdollars) filter (where category='subscription_fee'),0),
    'sms_cost_micro',         coalesce(sum(amount_microdollars) filter (where category='sms_cost'),0),
    'net_revenue_micro',
      coalesce(sum(amount_microdollars) filter (where bucket='platform_revenue'),0)
      - coalesce(sum(amount_microdollars) filter (where bucket='platform_cost'),0)
  ) into r from public.financial_entries where occurred_at >= p_since;
  return r;
end$$;

grant execute on function public.fin_tenant_spend(uuid, timestamptz)  to authenticated;
grant execute on function public.fin_platform_revenue(timestamptz)    to authenticated;
