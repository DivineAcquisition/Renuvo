-- ============================================================================
-- RENUVO — CALENDAR CONNECTIONS  (per-org, optional, tokens encrypted)
-- ============================================================================
create table public.calendar_connections (
  organization_id        uuid primary key references public.organizations(id) on delete cascade,
  provider               text not null default 'google',
  enabled                boolean not null default true,
  calendar_id            text,                          -- target calendar (default 'primary')
  access_token_enc       text,                          -- AES-256-GCM ciphertext
  refresh_token_enc      text,
  token_expiry           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger trg_calendar_updated
  before update on public.calendar_connections
  for each row execute function public.set_updated_at();

alter table public.calendar_connections enable row level security;

-- NO select policy for members → token columns are never readable via the API.
-- Members get connection STATUS through the safe function below; the engine
-- reads tokens via the service-role client (bypasses RLS).

-- ----------------------------------------------------------------------------
-- get_calendar_status() — safe, non-secret status for the settings UI
-- ----------------------------------------------------------------------------
create or replace function public.get_calendar_status(p_org_id uuid)
returns table (connected boolean, enabled boolean, calendar_id text)
language sql stable security definer set search_path = public as $$
  select
    (access_token_enc is not null) as connected,
    coalesce(enabled, false) as enabled,
    calendar_id
  from public.calendar_connections
  where organization_id = p_org_id
  union all
  select false, false, null
  where not exists (select 1 from public.calendar_connections where organization_id = p_org_id)
  limit 1;
$$;

grant execute on function public.get_calendar_status(uuid) to authenticated;
