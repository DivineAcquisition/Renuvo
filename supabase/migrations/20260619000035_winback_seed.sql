-- ============================================================================
-- RENUVO — WIN-BACK SEED (templates + default sequences). Separate migration so
-- the new template_event_key values from 0034 are committed before first use.
-- ============================================================================

-- 1) win-back voluntary template now carries the (discounted) capture link
update public.message_templates
set body = 'Hi {{first_name}}, we''ve missed taking care of your home! Come back to {{business_name}} and we''ll make your {{cadence_label}} service easy again: {{booking_link}}'
where organization_id is null and event_key = 'winback';

-- 2) global defaults for the two new intents (cleaning beachhead)
insert into public.message_templates (organization_id, vertical_id, event_key, body)
select null, v.id, t.event_key::public.template_event_key, t.body
from public.verticals v
join (values
  ('payment_recovery',
   'Hi {{first_name}}, your card on file with {{business_name}} didn''t go through, so your service is on hold. Update it here to pick right back up: {{booking_link}}'),
  ('reactivation',
   'Hi {{first_name}}, ready for another visit from {{business_name}}? Book your next {{cadence_label}} clean here: {{booking_link}}')
) as t(event_key, body)
  on v.key = 'cleaning'
on conflict do nothing;

-- 3) seed_org_controls now also seeds the three win-back sequences
create or replace function public.seed_org_controls(p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.offer_configs (organization_id) values (p_org_id)
    on conflict do nothing;
  insert into public.sequence_steps (organization_id, sequence_key, step_order, template_key, delay_minutes) values
    (p_org_id,'post_payment',1,'post_payment_activation',0),
    (p_org_id,'post_payment',2,'conversion_offer',60),
    (p_org_id,'post_payment',3,'reminder',1440),
    (p_org_id,'post_payment',4,'objection_followup',4320),
    -- win-back sequences: spacing is governed by the runner (retry_gap_days),
    -- so step delay_minutes are 0 — step_order selects the attempt's message.
    (p_org_id,'winback_voluntary',1,'winback',0),
    (p_org_id,'winback_voluntary',2,'winback',0),
    (p_org_id,'winback_involuntary',1,'payment_recovery',0),
    (p_org_id,'winback_involuntary',2,'payment_recovery',0),
    (p_org_id,'winback_lapse',1,'reactivation',0),
    (p_org_id,'winback_lapse',2,'reactivation',0)
  on conflict do nothing;
end$$;
grant execute on function public.seed_org_controls(uuid) to authenticated, service_role;

-- 4) backfill win-back sequences for orgs that already exist
insert into public.sequence_steps (organization_id, sequence_key, step_order, template_key, delay_minutes)
select o.id, s.sequence_key, s.step_order, s.template_key, 0
from public.organizations o
cross join (values
  ('winback_voluntary',1,'winback'),
  ('winback_voluntary',2,'winback'),
  ('winback_involuntary',1,'payment_recovery'),
  ('winback_involuntary',2,'payment_recovery'),
  ('winback_lapse',1,'reactivation'),
  ('winback_lapse',2,'reactivation')
) as s(sequence_key, step_order, template_key)
on conflict (organization_id, sequence_key, step_order) do nothing;

-- 5) lapse sweep candidates: one-time customers, still consented, with a past job
--    in a BOUNDED recent window (not the whole history), no recent job, no live
--    plan, and not already in a lapse campaign.
create or replace function public.winback_lapse_candidates(
  p_org uuid,
  p_min_days int default 60,
  p_max_days int default 180,
  p_limit int default 50
)
returns table (customer_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id
  from public.customers c
  where c.organization_id = p_org
    and (c.sms_sendable or c.email_sendable)
    and exists (
      select 1 from public.jobs j
      where j.customer_id = c.id
        and j.created_at <  now() - make_interval(days => p_min_days)
        and j.created_at >  now() - make_interval(days => p_max_days)
    )
    and not exists (
      select 1 from public.jobs j2
      where j2.customer_id = c.id
        and j2.created_at >= now() - make_interval(days => p_min_days)
    )
    and not exists (
      select 1 from public.recurring_plans p
      where p.customer_id = c.id
        and p.status in ('active','pending','paused')
    )
    and not exists (
      select 1 from public.winback_campaigns w
      where w.customer_id = c.id and w.kind = 'lapse'
    )
  limit p_limit;
$$;
revoke execute on function public.winback_lapse_candidates(uuid,int,int,int) from public, authenticated;
grant execute on function public.winback_lapse_candidates(uuid,int,int,int) to service_role;
