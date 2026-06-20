-- ============================================================================
-- RENUVO — CONTROL & CONFIGURATION
-- ============================================================================

-- 1) AGENT AUTONOMY -----------------------------------------------------------
alter table public.organizations
  add column agent_mode     text not null default 'auto'
    check (agent_mode in ('auto','review')),
  add column max_follow_ups int  not null default 3
    check (max_follow_ups between 0 and 10);

alter table public.scheduled_messages
  add column requires_approval boolean not null default false,
  add column approved_at       timestamptz,
  add column approved_by       uuid references public.profiles(id),
  add column edited_body       text;

-- 2) SEQUENCE STEPS (editable; the engine falls back to the constant) ---------
create table public.sequence_steps (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sequence_key    text not null default 'post_payment',
  step_order      int  not null,
  template_key    text not null,
  delay_minutes   int  not null,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, sequence_key, step_order)
);
alter table public.sequence_steps enable row level security;
create policy "seq_rw_org" on public.sequence_steps
  for all using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

-- 3) OFFER CONFIG -------------------------------------------------------------
create table public.offer_configs (
  organization_id        uuid primary key references public.organizations(id) on delete cascade,
  recurring_discount_pct numeric not null default 0 check (recurring_discount_pct between 0 and 90),
  offered_cadences       text[]  not null default '{weekly,biweekly,monthly}',
  default_cadence        text    not null default 'biweekly',
  pitch_style            text    not null default 'balanced'
    check (pitch_style in ('gentle','balanced','direct')),
  updated_at             timestamptz not null default now()
);
alter table public.offer_configs enable row level security;
create policy "offer_rw_org" on public.offer_configs
  for all using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

-- 4) NOTIFICATIONS ------------------------------------------------------------
create type public.notif_event as enum (
  'new_conversion','at_risk','failed_payment','reply_needs_human','approval_pending','wallet_low'
);

create table public.notification_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  event           public.notif_event not null,
  email           boolean not null default true,
  in_app          boolean not null default true,
  primary key (organization_id, profile_id, event)
);
alter table public.notification_preferences enable row level security;
create policy "notifpref_rw_self" on public.notification_preferences
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  event           public.notif_event not null,
  title           text not null,
  body            text,
  link            text,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index idx_notif_unread on public.notifications (profile_id, read_at) where read_at is null;
alter table public.notifications enable row level security;
create policy "notif_select_self" on public.notifications
  for select using (profile_id = auth.uid());
create policy "notif_update_self" on public.notifications
  for update using (profile_id = auth.uid());

-- seed defaults for an org (safe to backfill). Sequence matches the engine's
-- POST_PAYMENT_SEQUENCE event keys.
create or replace function public.seed_org_controls(p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.offer_configs (organization_id) values (p_org_id)
    on conflict do nothing;
  insert into public.sequence_steps (organization_id, sequence_key, step_order, template_key, delay_minutes) values
    (p_org_id,'post_payment',1,'post_payment_activation',0),
    (p_org_id,'post_payment',2,'conversion_offer',60),
    (p_org_id,'post_payment',3,'reminder',1440),
    (p_org_id,'post_payment',4,'objection_followup',4320)
  on conflict do nothing;
end$$;
grant execute on function public.seed_org_controls(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Update claim_due_messages: skip review-mode messages that aren't approved yet,
-- and return the owner's edited_body so the scheduler can send it verbatim.
-- ----------------------------------------------------------------------------
-- return type changes (added edited_body) → must drop before recreating
drop function if exists public.claim_due_messages(int);
create or replace function public.claim_due_messages(p_limit int default 100)
returns table (
  id                uuid,
  organization_id   uuid,
  customer_id       uuid,
  job_id            uuid,
  recurring_plan_id uuid,
  event_key         public.template_event_key,
  attempts          int,
  edited_body       text
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
      and (s2.requires_approval = false or s2.approved_at is not null)
    order by s2.send_at asc
    limit p_limit
    for update skip locked
  )
  returning s.id, s.organization_id, s.customer_id, s.job_id,
            s.recurring_plan_id, s.event_key, s.attempts, s.edited_body;
end;
$$;
revoke execute on function public.claim_due_messages(int) from public, authenticated;
grant  execute on function public.claim_due_messages(int) to service_role;
