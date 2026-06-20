-- ============================================================================
-- RENUVO — CAPTURE LINK MANAGEMENT (extends signup_links from Prompt 18)
-- ============================================================================
alter table public.signup_links
  add column link_type    text not null default 'customer'
    check (link_type in ('customer','generic')),
  add column label        text,
  add column created_by   uuid references public.profiles(id),
  add column opened_at    timestamptz,
  add column open_count   int not null default 0,
  add column converted_at timestamptz,
  add column revoked_at   timestamptz;

-- generic links aren't tied to a customer and may never expire; relax NOT NULLs.
alter table public.signup_links alter column customer_id drop not null;
alter table public.signup_links alter column cadence_profile_id drop not null;
alter table public.signup_links alter column price_cents drop not null;
alter table public.signup_links alter column expires_at drop not null;

create index idx_signup_links_org on public.signup_links (organization_id, created_at desc);

-- derived status: active | opened | converted | expired | revoked
create or replace function public.signup_link_status(l public.signup_links)
returns text language sql immutable as $$
  select case
    when l.revoked_at is not null then 'revoked'
    when l.converted_at is not null and l.link_type = 'customer' then 'converted'
    when l.expires_at is not null and l.expires_at < now() then 'expired'
    when l.opened_at is not null then 'opened'
    else 'active'
  end
$$;
