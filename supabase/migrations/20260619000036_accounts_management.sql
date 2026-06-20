-- ============================================================================
-- RENUVO — ACCOUNTS MANAGEMENT (notes, plan-change history, bulk operations)
-- ============================================================================

-- free-form notes on an account (owner/team context, not customer-visible)
create table public.account_notes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  recurring_plan_id uuid not null references public.recurring_plans(id) on delete cascade,
  author_id         uuid references public.profiles(id),
  body              text not null,
  pinned            boolean not null default false,
  created_at        timestamptz not null default now()
);
create index idx_notes_plan on public.account_notes (recurring_plan_id, created_at desc);
alter table public.account_notes enable row level security;
create policy "notes_rw_org" on public.account_notes
  for all using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

-- immutable history of plan changes (cadence/price/status/payment) for the timeline
create table public.plan_change_log (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  recurring_plan_id uuid not null references public.recurring_plans(id) on delete cascade,
  actor_id          uuid references public.profiles(id),   -- null = system/customer
  actor_kind        text not null default 'owner'
    check (actor_kind in ('owner','customer','system')),
  change_type       text not null,   -- 'cadence' | 'price' | 'status' | 'payment' | 'note' | 'created'
  old_value         jsonb,
  new_value         jsonb,
  created_at        timestamptz not null default now()
);
create index idx_planlog_plan on public.plan_change_log (recurring_plan_id, created_at desc);
alter table public.plan_change_log enable row level security;
create policy "planlog_select_org" on public.plan_change_log
  for select using (organization_id in (select public.auth_org_ids()));

-- bulk operation tracking (so large batches run async + show progress + audit)
create type public.bulk_op_status as enum (
  'queued','running','completed','completed_with_errors','failed'
);
create table public.bulk_operations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid references public.profiles(id),
  action          text not null,        -- 'pause'|'resume'|'cancel'|'adjust_price'|'message'|'request_payment_update'
  params          jsonb not null default '{}'::jsonb,
  target_ids      uuid[] not null,      -- recurring_plan_ids
  total           int not null,
  succeeded       int not null default 0,
  failed          int not null default 0,
  errors          jsonb not null default '[]'::jsonb,  -- [{id, reason}]
  status          public.bulk_op_status not null default 'queued',
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index idx_bulkops_org on public.bulk_operations (organization_id, created_at desc);
create index idx_bulkops_queued on public.bulk_operations (status)
  where status in ('queued','running');
alter table public.bulk_operations enable row level security;
create policy "bulkops_select_org" on public.bulk_operations
  for select using (organization_id in (select public.auth_org_ids()));
