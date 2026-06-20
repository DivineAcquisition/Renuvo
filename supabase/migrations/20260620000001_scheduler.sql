-- ============================================================================
-- RENUVO — SCHEDULER (atomic claim of due messages)
-- ============================================================================

-- add a 'processing' state to the queue status enum
alter type public.scheduled_msg_status add value if not exists 'processing';

-- ----------------------------------------------------------------------------
-- claim_due_messages() — atomically grab a batch of due pending rows.
-- FOR UPDATE SKIP LOCKED makes concurrent scheduler runs safe (no double-send).
-- ----------------------------------------------------------------------------
create or replace function public.claim_due_messages(p_limit int default 100)
returns table (
  id                uuid,
  organization_id   uuid,
  customer_id       uuid,
  job_id            uuid,
  recurring_plan_id uuid,
  event_key         public.template_event_key,
  attempts          int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.scheduled_messages s
  set status = 'processing', updated_at = now()
  where s.id in (
    select s2.id from public.scheduled_messages s2
    where s2.status = 'pending' and s2.send_at <= now()
    order by s2.send_at asc
    limit p_limit
    for update skip locked
  )
  returning s.id, s.organization_id, s.customer_id, s.job_id,
            s.recurring_plan_id, s.event_key, s.attempts;
end;
$$;

-- ----------------------------------------------------------------------------
-- recover_stale_processing() — reset rows stuck in 'processing' (crashed run).
-- ----------------------------------------------------------------------------
create or replace function public.recover_stale_processing(p_older_minutes int default 10)
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  update public.scheduled_messages
  set status = 'pending'
  where status = 'processing'
    and updated_at < now() - make_interval(mins => p_older_minutes);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.claim_due_messages(int)        from public, authenticated;
revoke execute on function public.recover_stale_processing(int)  from public, authenticated;
grant  execute on function public.claim_due_messages(int)        to service_role;
grant  execute on function public.recover_stale_processing(int)  to service_role;
