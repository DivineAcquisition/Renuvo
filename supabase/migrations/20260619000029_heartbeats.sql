-- ============================================================================
-- RENUVO — SYSTEM HEARTBEATS (dead-man's-switch for crons)
-- ============================================================================
create table public.system_heartbeats (
  job_name     text primary key,
  last_run_at  timestamptz not null,
  last_status  text,
  meta         jsonb not null default '{}'::jsonb
);
-- written by service-role crons; readable by platform admins (Prompt 37).
alter table public.system_heartbeats enable row level security;
create policy "heartbeats_admin_read" on public.system_heartbeats
  for select using (public.is_platform_admin());
