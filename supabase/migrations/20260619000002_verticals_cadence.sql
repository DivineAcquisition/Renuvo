-- ============================================================================
-- RENUVO — VERTICALS & CADENCE CONFIG
-- Global reference data. Makes the product multi-vertical via configuration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE: verticals  (cleaning, lawn, pool, pest, ...)
-- default_cadence_id FK is added AFTER cadence_profiles exists (circular dep).
-- ----------------------------------------------------------------------------
create table public.verticals (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null unique,        -- 'cleaning','lawn','pool','pest'
  display_name       text not null,
  default_cadence_id uuid,                          -- FK wired below
  created_at         timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- TABLE: cadence_profiles  (recurring rhythms, per vertical)
-- interval_days is the single source of truth for "how often" — never hardcode.
-- ----------------------------------------------------------------------------
create table public.cadence_profiles (
  id            uuid primary key default gen_random_uuid(),
  vertical_id   uuid not null references public.verticals(id) on delete cascade,
  key           text not null,                     -- 'weekly','biweekly','monthly','quarterly'
  label         text not null,                     -- 'Every week','Every 2 weeks',...
  interval_days int  not null,                      -- 7, 14, 30, 90
  created_at    timestamptz not null default now(),
  unique (vertical_id, key)
);

create index idx_cadence_vertical on public.cadence_profiles (vertical_id);

-- ----------------------------------------------------------------------------
-- Wire the circular + deferred FKs now that both tables exist
-- ----------------------------------------------------------------------------
alter table public.verticals
  add constraint fk_verticals_default_cadence
  foreign key (default_cadence_id) references public.cadence_profiles(id);

alter table public.organizations
  add constraint fk_orgs_vertical
  foreign key (vertical_id) references public.verticals(id);

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Seed verticals
-- ----------------------------------------------------------------------------
insert into public.verticals (key, display_name) values
  ('cleaning', 'Residential Cleaning'),
  ('lawn',     'Lawn Care'),
  ('pool',     'Pool Service'),
  ('pest',     'Pest Control');

-- ----------------------------------------------------------------------------
-- Seed cadence_profiles per vertical (interval_days drives the engine)
-- ----------------------------------------------------------------------------
insert into public.cadence_profiles (vertical_id, key, label, interval_days)
select v.id, c.key, c.label, c.interval_days
from public.verticals v
join (values
  -- cleaning
  ('cleaning','weekly',   'Every week',     7),
  ('cleaning','biweekly', 'Every 2 weeks',  14),
  ('cleaning','monthly',  'Every month',    30),
  -- lawn
  ('lawn','weekly',       'Every week',     7),
  ('lawn','biweekly',     'Every 2 weeks',  14),
  -- pool
  ('pool','weekly',       'Every week',     7),
  -- pest
  ('pest','monthly',      'Every month',    30),
  ('pest','quarterly',    'Every quarter',  90)
) as c(vkey, key, label, interval_days)
  on c.vkey = v.key;

-- ----------------------------------------------------------------------------
-- Set each vertical's default cadence (the most common rhythm for that trade)
-- cleaning → biweekly · lawn → weekly · pool → weekly · pest → quarterly
-- ----------------------------------------------------------------------------
update public.verticals v
set default_cadence_id = cp.id
from public.cadence_profiles cp
where cp.vertical_id = v.id
  and (
    (v.key = 'cleaning' and cp.key = 'biweekly') or
    (v.key = 'lawn'     and cp.key = 'weekly')   or
    (v.key = 'pool'     and cp.key = 'weekly')   or
    (v.key = 'pest'     and cp.key = 'quarterly')
  );

-- ============================================================================
-- ROW LEVEL SECURITY (read-only reference data)
-- ============================================================================

-- Global reference tables: any authenticated user may READ; nobody writes
-- via the API (writes happen through migrations / service-role only).
alter table public.verticals        enable row level security;
alter table public.cadence_profiles enable row level security;

create policy "verticals_select_all" on public.verticals
  for select using (auth.role() = 'authenticated');

create policy "cadence_select_all" on public.cadence_profiles
  for select using (auth.role() = 'authenticated');

-- No insert/update/delete policies → those operations are denied to all
-- normal callers; the service-role key bypasses RLS for any future admin tooling.
