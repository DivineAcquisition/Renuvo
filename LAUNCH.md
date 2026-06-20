# Renuvo — Master Assembly & Launch Sequence

The capstone map. This adds no features — it's the order things were built in, what
depends on what, what's required to go live, and what's deliberately deferred.
Read this first; build/operate in the phases below; clear the launch gate before
going live.

## The product in one paragraph

Renuvo is the financial + intelligence layer under home-service recurring revenue.
A cleaning business connects its Stripe (and, later, Jobber), and Renuvo turns
one-time jobs into recurring, auto-billed accounts via an AI SMS agent — taking an
application fee on the **tenant's connected-account** billing. It sits ON TOP of
booking tools (never replacing them), isolates each tenant's messaging for A2P
compliance, and accrues two moats: cross-tenant **conversion intelligence** and
recurring-book **financial intelligence**.

---

## Build phases (dependency-ordered)

| Phase | Theme | Prompts | Gate |
|------|-------|---------|------|
| 1 | Data & tenancy foundation | 1–9 | RLS verified — **no cross-tenant read anywhere** |
| 2 | Auth & access | 10, 36 | sign up → land in an org → invite a teammate who can join |
| 3 | Money rails | 11, 12, 29, 30 | three Stripe flows separate & correct; recurring lands on the **tenant's** connected account, only the app fee is Renuvo's |
| 4 | Messaging rails | 13, 41, 22 | no send escapes the guarded path; each tenant sends through its own profile |
| 5 | Compliance gate | 31 | sending blocked until `a2p_status='approved'` — **start 2+ weeks early** |
| 6 | The agent loop | 14–22 | payment → sequence → consented send → capture → recurring plan activated, end to end |
| 7 | Owner surfaces | 23, 28, 28B, 32, 34, 25, 33, 35, 45, 47 | an owner can run the whole business from the app |
| 8 | Customer-facing & retention | 18, 40, 46, 44 | homeowner self-manage (pause/skip/update card/cancel-with-deflection); churn recovered |
| 9 | Channels & integrations | 42, 43 | flagged off by default; enable per real demand |
| 10 | Platform, ops & moats | 24, 37, 38, 39, 48, 49 | admin operate + kill-switch; PII scrubbed; outcome spine emitting from day one |

---

## Cross-cutting invariants (true in EVERY prompt)

1. **Consent is sacred** — a payment, import, or edit never grants SMS/email consent;
   only first-party opt-in or owner attestation does; STOP is permanent.
2. **The money boundary** — recurring revenue is the tenant's, on their connected
   account; Renuvo's revenue is only application fees + SMS margin + SaaS.
3. **One guarded send path** — every message (agent, manual, bulk, win-back, link)
   goes through it; no bypass.
4. **Per-tenant isolation** — one tenant → one messaging profile → one A2P campaign.
5. **Privacy** — k-anonymity (k≥5) on all cross-tenant aggregates; no PII in logs;
   coarse geo only.
6. **Snapshot pricing** — plan price is fixed at enrollment; menu edits never
   re-charge existing customers (changes go through proration-aware modify).
7. **Money in microdollars + `<Money/>`** everywhere; mono numerals; no browser
   storage; reduced-motion respected.
8. **The moats stay decoupled** — intelligence and financial layers each read the
   shared spine read-only; neither writes the other's tables.

---

## The launch gate (do not go live until ALL true)

- [ ] RLS audited: zero cross-tenant data access (re-verified in prod)
- [ ] Three money flows correct in LIVE Stripe; recurring never touches the platform account
- [ ] A2P brand + campaign **APPROVED** for the launch tenant (start 2+ weeks early)
- [ ] Per-tenant messaging profile provisioned; guarded send blocks pre-approval
- [ ] Legal pages live (Terms, Privacy, SMS/A2P consent) and linked from capture page + portal
- [ ] Observability live: Sentry with PII scrub, scheduler heartbeat, `/api/health` green
- [ ] End-to-end test passes in prod with a REAL card + REAL number: payment → sequence
      → consented send → capture → recurring plan → first recurring charge on the
      connected account → appears in the ledger AND the outcome spine
- [ ] Kill-switch tested; deletion/teardown tested
- [ ] One real tenant (Novara) fully onboarded: Stripe connected, number + A2P live,
      wallet funded, customers imported (non-sendable until consent)

---

## Deliberately deferred (don't build yet)

- **Renuvo Capital (lending/advances)** — needs a real book to underwrite + legal
  structure. P49 measurement (`book_metrics`) accrues the history now; the product
  waits and consumes that read-only contract later.
- **Housecall/other connectors, inbound email parsing, multi-location, Stripe Tax,
  public API, referrals, reviews** — build when a paying tenant asks.
- **ML churn model** — the transparent v1 (P48 `churn-score`) ships first; ML once
  there's enough labeled cross-tenant outcome data.

---

## Operate: env / secrets

Resolved from env first, then the Supabase Vault (`get_secret`). Required for core flows:

| Secret | Used for | If missing |
|--------|----------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | auth, RLS, admin client | app breaks |
| `STRIPE_SECRET_KEY` (Vault: live) | Connect, wallet, subscriptions, capture | Stripe calls throw |
| `STRIPE_PUBLISHABLE_KEY` (Vault) | Elements (wallet/capture/portal) — served from server so it matches the secret | card forms blank |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhooks | all webhooks 400 |
| `STRIPE_CONNECT_CLIENT_ID` | Connect OAuth (connect + disconnect) | broken OAuth |
| `TELNYX_API_KEY` / `TELNYX_PUBLIC_KEY` | SMS send/provisioning / inbound webhook verify | sends fail / inbound 401 |
| `ANTHROPIC_API_KEY` | AI personalization (degrades to template if absent) | safe fallback |
| `CRON_SECRET` | all cron routes | crons 401 |
| `ENCRYPTION_KEY` (64 hex) | Google Calendar token encryption | calendar connect/write fails |
| `PORTAL_TOKEN_SECRET` / `CONSENT_HMAC_KEY` | portal magic links / A2P consent proof | falls back to service-role key |
| `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` / `RENUVO_FROM_EMAIL` | email (Resend) | email no-ops / webhook unverified |
| `NEXT_PUBLIC_SENTRY_DSN` (+ org/project/token) | observability | Sentry off |
| `NEXT_PUBLIC_*_URL`, `NEXT_PUBLIC_ROOT_DOMAIN` | routing, capture/portal subdomains | wrong links |

### Feature flags (default OFF)

`EMAIL_CHANNEL_ENABLED` + `NEXT_PUBLIC_EMAIL_CHANNEL_ENABLED` (email channel),
`WINBACK_ENABLED` (+ per-org `offer_configs.winback_enabled`), `A2P_MOCK_MODE` (dev
only — fakes A2P), `TELNYX_ALLOW_UNREGISTERED` (allow SMS before A2P approval — dev only).

### Cron schedule (`vercel.json`, Bearer `CRON_SECRET`)

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/scheduler` | `*/5 * * * *` | drain scheduled messages (guarded send) |
| `/api/cron/process-bulk-operations` | `*/2 * * * *` | bulk account actions worker |
| `/api/cron/churn-scoring` | `0 3 * * *` | transparent churn scores (P48) |
| `/api/cron/compute-book-metrics` | `30 3 * * *` | financial intelligence (P49) |
| `/api/cron/winback` | `0 */6 * * *` | win-back enqueue + lapse sweep |
| `/api/cron/process-deletions` | `0 4 * * *` | data deletion/teardown |
| `/api/cron/retention` | `0 5 * * 0` | retention scrub |

### Subdomains

- `app.renuvo.io` — the owner app
- `r.renuvo.io` — public capture links
- `account.renuvo.io` — passwordless homeowner portal
- `mail.renuvo.io` — Resend sending subdomain (SPF/DKIM/DMARC)

---

## Current implementation status (honest)

**Built & on `main`:** phases 1–8 and most of 10 — foundation/tenancy/RLS, auth,
the three Stripe money flows + financial core, guarded Telnyx send + per-tenant
isolation, A2P 10DLC, the full agent loop + scheduler, owner surfaces (dashboard,
home, inbox, customers, plans, settings, controls, accounts management, service
packages), capture + capture-link management, customer portal, win-back, email
channel (Resend, flagged), admin console, data/privacy + deletion, observability.

**In open PRs (stacked, not yet merged):** conversion intelligence — Moat #1 (P48,
#63) and financial intelligence — Moat #2 foundation (P49, #64). Merge order: #63 → #64.

**Known gaps / follow-ups:**
- **Jobber integration (P43) is NOT built** — only a generic payment-ingest API
  (`/api/payments/ingest`) + Stripe Connect exist. Build when a tenant needs it.
- ⌘K command palette is a placeholder ("search coming soon").
- `types/database.ts` lags migrations; Supabase clients are untyped (`<Database>` not
  applied) — regenerate + type the clients to restore compile-time schema safety.
- One-click "apply winning template" + new-tenant smart defaults (P48) are scaffolded
  by the intel functions but await a message-variant model.
- Stripe is on **LIVE** keys — test flows will create real charges; swap the Vault to
  test keys for QA.

---

## The one thing this map makes unavoidable

The benchmarks suppress below 5 tenants, the financial metrics need a book, and the
whole point is a tenant taking a **real recurring payment**. The machine is built;
its value is now gated on traction.

So the true "Prompt 51" is not a prompt: **onboard Novara for real, run one recent
customer through the live flow, and watch the outcome event land.** That single
event is worth more than prompts 1–50 — it's the first proof any of this is real.

Build the machine from this map. Then go feed it.
