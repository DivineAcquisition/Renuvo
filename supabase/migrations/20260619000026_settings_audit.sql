-- ============================================================================
-- RENUVO — SETTINGS AUDIT (who changed what, when — org + user scope)
-- ============================================================================
create table public.settings_audit (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id),
  scope           text not null check (scope in ('org','user')),
  setting_key     text not null,
  old_value       jsonb,
  new_value       jsonb,
  created_at      timestamptz not null default now()
);
create index idx_settings_audit_org on public.settings_audit (organization_id, created_at desc);

alter table public.settings_audit enable row level security;
-- members read their org's audit; writes are service-role (the updater).
create policy "settings_audit_select_org" on public.settings_audit
  for select using (organization_id in (select public.auth_org_ids()));
