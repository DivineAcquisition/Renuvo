-- ============================================================================
-- RENUVO — get_secret()  (read a Supabase Vault secret, service-role only)
-- Lets the app/agent store sensitive keys (e.g. ANTHROPIC_API_KEY) in Supabase
-- Vault and fetch them server-side via the service-role client. Never exposed to
-- anon/authenticated.
-- ============================================================================
create or replace function public.get_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_name
  limit 1;
$$;

revoke execute on function public.get_secret(text) from public, anon, authenticated;
grant  execute on function public.get_secret(text) to service_role;
