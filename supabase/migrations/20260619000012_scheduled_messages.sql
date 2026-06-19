-- ============================================================================
-- RENUVO — SCHEDULED MESSAGES  (the conversion sequence queue)
-- ============================================================================
create type public.scheduled_msg_status as enum ('pending', 'sent', 'cancelled', 'skipped', 'failed');

create table public.scheduled_messages (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id)  on delete cascade,
  customer_id        uuid not null references public.customers(id)       on delete cascade,
  job_id             uuid references public.jobs(id)                     on delete set null,
  recurring_plan_id  uuid references public.recurring_plans(id)          on delete set null,

  event_key          public.template_event_key not null,   -- which template to render at send
  send_at            timestamptz not null,
  status             public.scheduled_msg_status not null default 'pending',

  attempts           int not null default 0,
  last_error         text,
  cancel_reason      text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- scheduler hot path: pending rows that are due
create index idx_sched_due
  on public.scheduled_messages (send_at)
  where status = 'pending';
create index idx_sched_org      on public.scheduled_messages (organization_id, status);
create index idx_sched_customer on public.scheduled_messages (customer_id, status);

-- IDEMPOTENCY: one row per (job, event_key) so re-firing the sequence is safe.
-- Non-partial so it's usable as an ON CONFLICT arbiter from the engine's upsert;
-- NULL job_ids stay distinct (Postgres default), so retention messages with no
-- job can still be queued multiple times.
create unique index uniq_sched_job_event
  on public.scheduled_messages (job_id, event_key);

create trigger trg_sched_updated
  before update on public.scheduled_messages
  for each row execute function public.set_updated_at();

alter table public.scheduled_messages enable row level security;

-- members READ their org's queue; the engine/scheduler writes via service-role
create policy "sched_select_org" on public.scheduled_messages
  for select using (organization_id in (select public.auth_org_ids()));
