-- ============================================================================
-- RENUVO — GUARDRAILS CONFIG (timezone + quiet hours per org)
-- ============================================================================
alter table public.organizations
  add column timezone          text not null default 'America/New_York',
  add column quiet_hours_start int  not null default 8,   -- 8am local
  add column quiet_hours_end   int  not null default 21;  -- 9pm local (exclusive)

-- sanity bounds (0–23, start < end)
alter table public.organizations
  add constraint chk_quiet_hours
  check (quiet_hours_start between 0 and 23
     and quiet_hours_end   between 1 and 24
     and quiet_hours_start < quiet_hours_end);
