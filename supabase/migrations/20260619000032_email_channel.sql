-- ============================================================================
-- RENUVO — EMAIL CHANNEL (CAN-SPAM; consent SEPARATE from SMS/A2P)
-- customers.email already exists (Prompt 3) — only add the email-consent fields.
-- ============================================================================
alter table public.customers
  add column email_sendable        boolean not null default false,
  add column email_consent_at      timestamptz,
  add column email_consent_source  text,
  add column email_unsubscribed_at timestamptz,
  add column channel_preference    text not null default 'sms'
    check (channel_preference in ('sms','email','any'));

-- per-tenant sending identity on the SHARED domain + required CAN-SPAM postal addr
alter table public.organizations
  add column email_local_part text,
  add column email_from_name  text,
  add column email_reply_to   text,
  add column postal_address   text;

create unique index idx_org_email_local on public.organizations (email_local_part)
  where email_local_part is not null;

-- suppression list (hard bounces, complaints, unsubscribes) — shared-domain safety
create table public.email_suppressions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  email           text not null,
  reason          text not null,                 -- 'bounce' | 'complaint' | 'unsubscribe'
  created_at      timestamptz not null default now(),
  unique (email, reason)
);
create index idx_suppress_email on public.email_suppressions (email);

alter table public.email_suppressions enable row level security;
create policy "suppress_select_org" on public.email_suppressions
  for select using (organization_id in (select public.auth_org_ids()));

-- email sends are logged in the events spine (channel='email'); no messages table.
