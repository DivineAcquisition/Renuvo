-- ============================================================================
-- RENUVO — DATA LIFECYCLE (soft-delete, anonymization, consent retention)
-- ============================================================================

-- soft-delete + anonymization markers on customers (the PII holder)
alter table public.customers
  add column deleted_at        timestamptz,
  add column anonymized_at     timestamptz,
  add column anonymized_reason text;

-- anonymization sets phone to NULL — allow it (the E.164 CHECK passes on NULL).
alter table public.customers alter column phone drop not null;

-- org-level deletion request (grace period before hard teardown)
alter table public.organizations
  add column deletion_requested_at  timestamptz,
  add column deletion_scheduled_for timestamptz,
  add column deleted_at             timestamptz;

-- CONSENT RECORDS: the A2P-required proof that MUST survive customer deletion.
-- phone stored as an HMAC (keyed by a server secret) — proves a number consented
-- without keeping a live, queryable PII list.
create table public.consent_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_hash      text not null,
  consent_source  text not null,
  consent_at      timestamptz not null,
  opted_out_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index idx_consent_phonehash on public.consent_records (organization_id, phone_hash);

alter table public.consent_records enable row level security;
create policy "consent_select_org" on public.consent_records
  for select using (organization_id in (select public.auth_org_ids()));
