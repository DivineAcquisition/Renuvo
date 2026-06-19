-- ============================================================================
-- RENUVO — BILLING WALLET & SMS USAGE METERING
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE: usage_rates  (what you CHARGE + true carrier COST; global or per-org)
-- charge_cents_per_segment : customer-facing price (whole cents, e.g. 2)
-- cost_microdollars_per_segment : your Telnyx+carrier cost (e.g. 4000 = $0.004)
-- ----------------------------------------------------------------------------
create table public.usage_rates (
  id                             uuid primary key default gen_random_uuid(),
  organization_id                uuid references public.organizations(id) on delete cascade, -- NULL = global default
  channel                        text not null default 'sms',
  charge_cents_per_segment       int  not null,
  cost_microdollars_per_segment  bigint not null,
  effective_from                 timestamptz not null default now(),
  created_at                     timestamptz not null default now()
);

create unique index uniq_rate_global on public.usage_rates (channel)
  where organization_id is null;
create unique index uniq_rate_org on public.usage_rates (organization_id, channel)
  where organization_id is not null;

-- Seed the global default: charge 2¢/segment, cost $0.004/segment → ~5x markup
insert into public.usage_rates (organization_id, channel, charge_cents_per_segment, cost_microdollars_per_segment)
values (null, 'sms', 2, 4000);

-- ----------------------------------------------------------------------------
-- TABLE: wallets  (one per org). Balance only moves via functions below.
-- ----------------------------------------------------------------------------
create table public.wallets (
  organization_id          uuid primary key references public.organizations(id) on delete cascade,
  balance_cents            bigint not null default 0,
  auto_reload_enabled      boolean not null default true,
  reload_threshold_cents   int not null default 500,    -- reload when below $5
  reload_amount_cents      int not null default 1000,   -- reload $10 at a time
  stripe_customer_id       text,
  stripe_payment_method_id text,                          -- saved card for auto-reload
  low_balance_notified_at  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger trg_wallets_updated
  before update on public.wallets
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- ENUM + TABLE: wallet_transactions  (append-only ledger; margin on each debit)
-- amount_cents is SIGNED: credits positive, debits negative.
-- ----------------------------------------------------------------------------
create type public.wallet_txn_type as enum (
  'credit_reload',     -- auto/manual Stripe top-up
  'credit_manual',     -- platform adjustment / comp
  'credit_refund',
  'debit_sms',         -- a send
  'debit_adjustment'
);

create table public.wallet_transactions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  type                public.wallet_txn_type not null,
  amount_cents        bigint not null,            -- signed
  balance_after_cents bigint not null,
  -- usage detail (debit_sms rows)
  segments            int,
  charge_cents        int,                         -- customer-facing charge for this send
  cost_microdollars   bigint,                      -- true carrier cost
  margin_microdollars bigint,                       -- charge(µ$) - cost(µ$)
  -- provenance
  reference           text,                         -- stripe charge id, telnyx message id, etc.
  meta                jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index idx_wallet_txn_org  on public.wallet_transactions (organization_id, created_at);
create index idx_wallet_txn_type on public.wallet_transactions (organization_id, type);

-- ----------------------------------------------------------------------------
-- Auto-create a wallet for every org
-- Every organization gets a wallet at creation (defaults: auto-reload on,
-- $5 threshold, $10 reload). Stripe fields stay null until a card is added.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_org_wallet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallets (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

create trigger on_org_created_wallet
  after insert on public.organizations
  for each row execute function public.handle_new_org_wallet();

-- ============================================================================
-- THE MONEY FUNCTIONS (atomic, service-role only)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- resolve_charge_rate() — org override → global default
-- ----------------------------------------------------------------------------
create or replace function public.resolve_charge_rate(p_org_id uuid, p_channel text default 'sms')
returns table (charge_cents int, cost_microdollars bigint)
language sql stable security definer set search_path = public as $$
  select charge_cents_per_segment, cost_microdollars_per_segment
  from public.usage_rates
  where channel = p_channel
    and (organization_id = p_org_id or organization_id is null)
  order by (organization_id is not null) desc
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- debit_wallet() — charge for a send. ATOMIC: locks the wallet row so two
-- concurrent sends can't both spend the last cent. Returns a jsonb verdict;
-- if funds are short it does NOT debit and signals reload_needed.
-- ----------------------------------------------------------------------------
create or replace function public.debit_wallet(
  p_org_id    uuid,
  p_segments  int,
  p_reference text default null,
  p_meta      jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w               public.wallets%rowtype;
  r_charge_cents  int;
  r_cost_micro    bigint;
  total_charge    int;
  total_cost_mc   bigint;
  margin_mc       bigint;
  new_balance     bigint;
  reload_needed   boolean;
begin
  -- lock the wallet row for the duration of the txn
  select * into w from public.wallets where organization_id = p_org_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_wallet');
  end if;

  select charge_cents, cost_microdollars into r_charge_cents, r_cost_micro
  from public.resolve_charge_rate(p_org_id, 'sms');

  total_charge  := p_segments * r_charge_cents;
  total_cost_mc := p_segments::bigint * r_cost_micro;
  margin_mc     := (total_charge::bigint * 10000) - total_cost_mc;  -- 1¢ = 10,000 µ$

  if w.balance_cents < total_charge then
    return jsonb_build_object(
      'ok', false, 'reason', 'insufficient_funds',
      'balance_after_cents', w.balance_cents,
      'required_cents', total_charge,
      'reload_needed', true
    );
  end if;

  new_balance := w.balance_cents - total_charge;
  update public.wallets set balance_cents = new_balance where organization_id = p_org_id;

  insert into public.wallet_transactions
    (organization_id, type, amount_cents, balance_after_cents,
     segments, charge_cents, cost_microdollars, margin_microdollars, reference, meta)
  values
    (p_org_id, 'debit_sms', -total_charge, new_balance,
     p_segments, total_charge, total_cost_mc, margin_mc, p_reference, p_meta);

  reload_needed := new_balance < w.reload_threshold_cents;

  return jsonb_build_object(
    'ok', true,
    'balance_after_cents', new_balance,
    'charge_cents', total_charge,
    'reload_needed', reload_needed
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- credit_wallet() — record a top-up AFTER a successful Stripe charge (the
-- actual charge runs in app code, Prompt 13/14). Atomic balance increment + ledger.
-- ----------------------------------------------------------------------------
create or replace function public.credit_wallet(
  p_org_id      uuid,
  p_amount_cents bigint,
  p_type        public.wallet_txn_type default 'credit_reload',
  p_reference   text default null,
  p_meta        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare new_balance bigint;
begin
  if p_amount_cents <= 0 then
    raise exception 'credit amount must be positive';
  end if;
  update public.wallets
    set balance_cents = balance_cents + p_amount_cents,
        low_balance_notified_at = null
  where organization_id = p_org_id
  returning balance_cents into new_balance;

  insert into public.wallet_transactions
    (organization_id, type, amount_cents, balance_after_cents, reference, meta)
  values (p_org_id, p_type, p_amount_cents, new_balance, p_reference, p_meta);

  return jsonb_build_object('ok', true, 'balance_after_cents', new_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- update_wallet_settings() — the ONLY way a tenant changes wallet config.
-- Owner-gated; cannot touch balance. (Balance is never user-writable.)
-- ----------------------------------------------------------------------------
create or replace function public.update_wallet_settings(
  p_org_id              uuid,
  p_auto_reload_enabled boolean,
  p_reload_threshold    int,
  p_reload_amount       int
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.memberships
    where organization_id = p_org_id and profile_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'only owners can change wallet settings';
  end if;

  update public.wallets
  set auto_reload_enabled    = p_auto_reload_enabled,
      reload_threshold_cents = greatest(p_reload_threshold, 0),
      reload_amount_cents    = greatest(p_reload_amount, 100)
  where organization_id = p_org_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- GRANTS: balance-moving functions are service-role ONLY (engine/webhooks).
-- Tenants may only resolve their rate (read) and update settings.
-- ----------------------------------------------------------------------------
revoke execute on function public.debit_wallet(uuid,int,text,jsonb)        from public, authenticated;
revoke execute on function public.credit_wallet(uuid,bigint,public.wallet_txn_type,text,jsonb) from public, authenticated;
grant  execute on function public.debit_wallet(uuid,int,text,jsonb)        to service_role;
grant  execute on function public.credit_wallet(uuid,bigint,public.wallet_txn_type,text,jsonb) to service_role;
grant  execute on function public.update_wallet_settings(uuid,boolean,int,int) to authenticated;
grant  execute on function public.resolve_charge_rate(uuid,text)            to authenticated, service_role;

-- ============================================================================
-- ROW LEVEL SECURITY (read-only for tenants; no balance writes)
-- ============================================================================

alter table public.usage_rates         enable row level security;
alter table public.wallets             enable row level security;
alter table public.wallet_transactions enable row level security;

-- usage_rates: tenant sees the global default + its own override (transparency)
create policy "rates_select" on public.usage_rates
  for select using (organization_id is null or organization_id in (select public.auth_org_ids()));

-- wallets: members READ only. No insert/update/delete policy → balance is never
-- writable via the API. Settings change only through update_wallet_settings().
create policy "wallets_select_org" on public.wallets
  for select using (organization_id in (select public.auth_org_ids()));

-- ledger: members READ only. Append-only; inserts happen via service-role functions.
create policy "wallet_txn_select_org" on public.wallet_transactions
  for select using (organization_id in (select public.auth_org_ids()));
