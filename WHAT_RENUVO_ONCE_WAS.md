# What Renuvo once was

This is a snapshot of the product that lived in this repository before the
2026-09-03 reset. The codebase was erased so Renuvo could start over as a
feedback-pattern product. Bring features back from this map, not from memory.

Canonical domain then and now: **renuvo.io**. The operator app lived on
`app.renuvo.io`. Capture links were `r.renuvo.io`. The customer portal was
`account.renuvo.io`. Transactional mail used `notify.renuvo.io`; tenant mail
used `mail.renuvo.io`.

---

## One-line product

AI recurring-conversion engine for home-service businesses. It sat on top of
booking tools the owner already used, converted one-time jobs into recurring
monthly-billed clients, and took an application fee on the tenant’s connected
Stripe account.

## Positioning

Renuvo was the financial + intelligence layer under home-service recurring
revenue. A cleaning (or similar) business connected Stripe (and later Jobber).
Renuvo enrolled one-time customers onto recurring, auto-billed accounts via an
AI SMS agent. It never replaced the booking tool.

Two moats were designed in from day one:

1. Cross-tenant **conversion intelligence** (what messages actually convert).
2. Recurring-book **financial intelligence** (book health, churn, unit economics).

## Stack

- Next.js 14 App Router, TypeScript, Tailwind, shadcn-style primitives
- White theme, indigo/purple ramp `#4F38FF / #6A57FF / #9A8CFF`
- Fonts: Inter (opsz display/text) + JetBrains Mono for money
- Supabase (RLS, multi-tenant orgs)
- Stripe Connect (tenant connected accounts; Renuvo takes app fee only)
- Telnyx SMS + A2P 10DLC, per-tenant messaging profile
- Anthropic for agent copy
- Resend for email (platform vs tenant domains)
- Sentry, Vercel cron, Google Calendar (flagged)

## Surfaces

| Host / path | What it was |
|---|---|
| `renuvo.io` | Marketing (Framer). This Next app redirected `/` on the apex to it. |
| `app.renuvo.io` | Operator app: home, dashboard, inbox, customers, plans, accounts, finances, intelligence, settings, onboarding, admin |
| `r.renuvo.io/{token}` | Public capture / enroll page (tenant-branded) |
| `account.renuvo.io` | Passwordless homeowner portal (pause/skip/card/cancel) |
| `/admin` | Platform console: tenants, A2P, finance, benchmarks, system |

## Feature map (build order)

1. **Tenancy** — orgs, members, RLS, no cross-tenant reads.
2. **Auth** — signup lands in an org; teammate invites.
3. **Money** — Stripe Connect; recurring charges on the tenant connected account; wallet for SMS; SaaS billing.
4. **Messaging** — one guarded send path; per-tenant Telnyx profile; consent sacred; STOP permanent.
5. **A2P** — brand + campaign; send blocked until approved.
6. **Agent loop** — payment → sequence → consented send → capture → recurring plan live.
7. **Owner surfaces** — home feed, dashboard, inbox, customers, plans, accounts hub, settings, controls.
8. **Customer-facing** — capture page, portal, win-back sequences.
9. **Channels** — email (Resend), Google Calendar; flagged off by default.
10. **Moats** — conversion benchmarks, financial book-health, admin kill-switch, PII scrub.

## Schema (migrations, in order)

`supabase/migrations/` held 42 SQL files, 2026-06-19 through 2026-06-20:

tenancy_core → verticals_cadence → customers → jobs → recurring_plans_retention →
message_templates → billing_wallet → events → payment_trigger → telnyx →
calendar → scheduled_messages → signup_links → get_secret → guardrails →
dashboard → benchmarks → settings → onboarding → financial_core → saas_billing →
a2p_registration → a2p_isv → home_summary → controls → settings_audit →
admin_views → data_lifecycle → heartbeats → capture_links → messaging_isolation →
email_channel → stripe_completion → winback (+ seed) → accounts_management →
customer_portal → service_packages → outcome_events → financial_intelligence →
org_accent → scheduler.

## Invariants that must come back if money/SMS returns

1. Consent is never implied by a payment, import, or edit.
2. Recurring revenue is the tenant’s. Renuvo’s cut is app fee + SMS margin + SaaS.
3. Every message goes through one guarded send path.
4. One tenant → one messaging profile → one A2P campaign.
5. Cross-tenant aggregates need k-anonymity (k≥5). No PII in logs.
6. Plan price is snapshotted at enrollment.
7. Money in microdollars; render through a `<Money/>` primitive.

## UI system that was in flight

Premium white shell, one ambient purple wash, one glass surface per view,
Bricolage/Inter/JetBrains, purple used as a scalpel. Component sourcing was
documented in `COMPONENT_SOURCING.md` (shadcn + Magic UI + Aceternity + Tremor).
Page rules lived in `PAGE_SYSTEM.md`. Launch sequence lived in `LAUNCH.md`.

The north-star mark (6-point elongated star, no horizontal points) was the
logo. Keep that identity.

## What this reset is *not*

It is not a dump of the old git history. History remains on `main` and the
`cursor/renuvo-*` branches. This file is the human-readable index so the new
product can stay small until those features are deliberately reintroduced.

## New product (post-reset)

Renuvo reads the complaints, reviews, and texts a business already receives.
The owner forwards them to a Renuvo inbox. Renuvo tags, tracks, and shows
weekly patterns before they become lost customers. No CRM connection. No new
habit. Landing domain: **renuvo.io**.
