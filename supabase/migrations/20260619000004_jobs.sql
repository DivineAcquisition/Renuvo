-- ============================================================================
-- RENUVO — JOBS  (tenant-scoped appointments; one-time → recurring conversion)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
create type public.job_kind   as enum ('one_time', 'recurring');
create type public.job_status as enum ('scheduled', 'completed', 'cancelled', 'no_show');

-- ----------------------------------------------------------------------------
-- TABLE: jobs
-- ----------------------------------------------------------------------------
create table public.jobs (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  customer_id              uuid not null references public.customers(id)     on delete cascade,

  kind                     public.job_kind   not null default 'one_time',
  status                   public.job_status not null default 'scheduled',

  -- recurring config (null for one-time jobs)
  cadence_profile_id       uuid references public.cadence_profiles(id),

  -- a recurring series' children point at the original one-time job
  parent_job_id            uuid references public.jobs(id) on delete set null,

  scheduled_at             timestamptz,
  price_cents              int,
  currency                 text not null default 'usd',

  -- payment / provenance
  stripe_payment_intent_id text,                 -- idempotency key (see unique index)
  paid_at                  timestamptz,
  external_ref             text,                  -- id from their existing booking tool
  notes                    text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- a recurring job must carry a cadence; a one-time job must not
  constraint chk_recurring_has_cadence check (
    (kind = 'recurring' and cadence_profile_id is not null) or
    (kind = 'one_time'  and cadence_profile_id is null)
  )
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index idx_jobs_org          on public.jobs (organization_id);
create index idx_jobs_customer      on public.jobs (customer_id);
create index idx_jobs_scheduled     on public.jobs (organization_id, scheduled_at);
create index idx_jobs_kind          on public.jobs (organization_id, kind);
create index idx_jobs_parent        on public.jobs (parent_job_id);

-- IDEMPOTENCY: one job per Stripe payment intent. Partial unique so the many
-- jobs with NULL payment intents (e.g. recurring children) don't collide.
create unique index uniq_jobs_payment_intent
  on public.jobs (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- updated_at maintainer (reuses set_updated_at() from Prompt 2)
create trigger trg_jobs_updated
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (tenant-scoped)
-- ============================================================================

alter table public.jobs enable row level security;

create policy "jobs_select_org" on public.jobs
  for select using (organization_id in (select public.auth_org_ids()));

create policy "jobs_insert_org" on public.jobs
  for insert with check (organization_id in (select public.auth_org_ids()));

create policy "jobs_update_org" on public.jobs
  for update using (organization_id in (select public.auth_org_ids()))
            with check (organization_id in (select public.auth_org_ids()));

create policy "jobs_delete_org" on public.jobs
  for delete using (organization_id in (select public.auth_org_ids()));
