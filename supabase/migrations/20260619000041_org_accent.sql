-- ============================================================================
-- RENUVO — TENANT BRAND ACCENT (customer-facing surfaces carry the business brand)
-- Used by the capture page (P18), customer portal (P46), and emails (P52).
-- ============================================================================
alter table public.organizations
  add column accent_color text;   -- hex, e.g. '#4F38FF'; null → Renuvo default
