-- ============================================================================
-- RENUVO — PAYMENT TRIGGER (source-agnostic provenance + ingest auth)
-- ============================================================================

-- Source-agnostic payment provenance on jobs (replaces Stripe-only idempotency
-- as the general key; stripe_payment_intent_id from Prompt 5 stays for refunds).
alter table public.jobs add column payment_source      text;   -- 'stripe'|'manual'|'square'|'quickbooks'|'jobber'|...
alter table public.jobs add column payment_external_id text;   -- the source's unique payment id

-- A payment can arrive with no phone yet (e.g. Stripe charge without metadata),
-- so a job may exist before a messageable customer is linked. Allow null here;
-- recurring children always carry a customer.
alter table public.jobs alter column customer_id drop not null;

-- One job per (org, source, external payment id) → idempotent across ALL sources
create unique index uniq_jobs_payment_ref
  on public.jobs (organization_id, payment_source, payment_external_id)
  where payment_external_id is not null;

-- Per-org secret to authenticate the universal ingest webhook (Zapier/Make/etc.)
alter table public.organizations
  add column ingest_secret text not null default encode(gen_random_bytes(24), 'hex');

create index idx_orgs_ingest on public.organizations (ingest_secret);
