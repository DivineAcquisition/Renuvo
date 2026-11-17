# Company → Finance

Know what you earned, what you're owed, what you need to pay, and what each cleaning actually made.

Finance is the cleaning company's own money. Selestial's subscription, credits and plan stay under
Settings › Plan & Usage (`docs/billing/README.md`), and the two never share a table, a page or a word.

## Decisions (owner, November 17, 2026)

| Question | Decision |
|---|---|
| What an owner should feel sure of | Collected and owed first, then team pay owed, then what each job made |
| How much Selestial does on its own | Prepares; a person approves. Only non-money housekeeping may run on its own, within rules the owner sets |
| Layout | Money summary in the main column, "Needs your attention" beside it (under it on a phone) |
| Card payments | Stripe from the start, through **each company's own Stripe account** (Stripe Connect, full Dashboard, direct charges). Selestial takes **no fee** |
| What customers see | A **Selestial-branded pay page** with Stripe's Payment Element |
| Cleaner payouts | Stripe or recorded manual payments. Manual first; Stripe payouts once confirmed per company (see Phase 6) |
| Accounting | CSV export first, then QuickBooks Online sync |
| Sales tax | A company-set rate and taxable services; no automatic calculation or filing |
| Invoices start from | Completed visits (their price) or any customer. Quotes come later with the Sales agent |
| Name | **Finance** (as in the sidebar) |
| Novara | Design reference only. No data moves |
| Pay data to add | Fixed per-job pay, % tiers, cleaner check-out, owner-corrected hours, tips |
| Phone priorities | Approve pay and actions, snap a receipt, check who owes what, record a payment |
| A ninth agent | None. Company Chat and the existing agents do Finance work within their roles |
| Customer message channels (phase 2) | Email by default; text when the customer's texting permission is recorded and the texting number is approved |
| Reminder schedule | Drafts 3 days before due, then 1, 7 and 14 days overdue; after that Selestial flags the invoice and prepares nothing more |
| Approving customer messages | Each one, edited if wanted; Send all lists every recipient, channel and amount first |
| Who emails come from | The company's name via Selestial's sending address, replies to the Owner (or a set reply-to); the company's own Gmail when connected for sending |

## Phases

| Phase | Scope | State |
|---|---|---|
| 0 Foundations | Money records with an audit trail, separate finance capabilities checked on the server, Finance in the sidebar with its tabs, shared money UI | **Built** |
| 1 Stripe and getting paid | Connect the company's Stripe account; invoices with deposits and partial payments; branded pay page; Stripe webhooks; payments recorded by hand; customer statements; refunds and credits behind a confirmation; recovery from unclear Stripe answers | **Built** |
| 2 Collections with Selestial | Invoices and reminders to customers by email or text through the shared sending rules; Selestial drafts on a schedule; the Owner edits and approves each, or Send all; "Ready for you" queue; Chat tools and invoice context | **Built** |
| 3 Team Pay | Fixed, hourly, % share and % tiers; check-out and corrected hours; tips; Calculated → Needs review → Approved → Payment started → Paid; cleaner statements | |
| 4 Expenses | Receipt capture and extraction to confirm, categories and rules, duplicates, upcoming bills, links to jobs | |
| 5 Profitability | Estimated vs actual per job, service, customer, property; missing costs shown; margin vs markup; scenarios; "Review pricing" draft into Services & Pricing | |
| 6 Integrations | CSV export, QuickBooks Online sync, Stripe payouts to cleaners if the company is eligible | |
| 7 Final checks | Permissions, desktop and phone review, keyboard, tests and build | |

## How it fits together

```
Settings › Services & pricing ──► jobs.priceCents (a price, not a payment)
                                        │  Create invoice (draft)
                                        ▼
            invoices (draft → open → paid, or void; lines frozen when issued)
              │  issue: number + pay link            ▲ recompute() from rows
              ▼                                      │
   /c/pay/<token> ── start ──► payments (awaiting_customer → processing → succeeded | failed)
              │                     ▲                      refunds (sending → pending → succeeded | failed)
   Stripe Payment Element           │ read back from Stripe invoiceCredits (with a reason, reversible)
              │                     │
   company's own Stripe account ── webhook /webhooks/stripe (signature, dedupe) ──┘
```

- **Money** is whole cents. Invoice totals are worked out in one place (`convex/lib/finance/money.ts`)
  and written by one function (`recompute` in `convex/lib/finance/ledger.ts`) from the rows, so a total
  never drifts from what it summarizes.
- **States are derived.** An invoice stores draft, open, paid or void. Requested, deposit requested,
  deposit paid, partially paid, processing, overdue and overpaid are worked out from the money and the
  clock (`convex/lib/finance/invoiceState.ts`). Processing money is shown and never counted as paid.
- **Nothing is deleted.** A recorded payment entered by mistake is voided with a reason. A credit is
  reversed with a reason. An invoice is voided with a reason, and only once nothing paid remains on it.
  Every change writes an event; the invoice drawer shows the history.
- **Authority** (`convex/lib/finance/authority.ts`): read, analyze, draft, edit, send, approve earnings,
  initiate payments, issue refunds and write off are separate capabilities. All belong to the Owner
  today. Agents may read, analyze and draft only.
- **Confirmation** (`convex/lib/finance/confirm.ts`): refunds, credits and voids show a preview of the
  exact consequence. The preview's fingerprint must match the record when the person confirms, or
  nothing runs and they review again.
- **One request key per record.** Stripe calls for a payment or refund use that record's own
  Idempotency-Key on every try. An unclear answer marks the record "checking"; Selestial asks again with
  the same key (Stripe replays its first answer for 24 hours) or looks the object up after that. A new
  key is never used, so an unclear answer can't become a second charge or refund.
- **Webhooks only point.** `/webhooks/stripe` verifies Stripe's signature, records the event id once
  (`providerReceipts`), and reads the named object back from Stripe. A late or repeated event can't move
  a record backwards. A cron re-reads anything still in flight every 10 minutes.
- **Pay links** are `<public id>.<HMAC>` with `ACTION_LINK_SECRET` under their own words, like cleaner
  links. The token is never stored. Voiding the invoice closes it. The page shows that one invoice only.

## Messages to customers (phase 2)

```
hourly sweep (financeMessages.sweep)            Owner: "Send invoice" / "Prepare reminder" / Chat
        │ step due: before_due, overdue_1/7/14         │
        ▼                                              ▼
 financeMessages (draft: words from templates.ts, channel, what the invoice said)
        │ Owner reviews, edits, approves (fingerprint must match; changed amount → rewritten, reviewed again)
        ▼
 messages row (purpose invoice_sent | payment_reminder) ── shared sending policy at planning and at sending:
        │                                                  sender setup, address, do-not-contact list,
        ▼                                                  recorded permission, quiet hours
 claim: invoice still open and owing? pay link made now ── provider (Resend / company Gmail / Telnyx)
```

- Selestial prepares; a person approves every send. A schedule step is prepared once per invoice; a newer
  step sets the older waiting draft aside; a draft whose invoice is paid or voided is set aside by the sweep.
- Templates are code, not a model: every amount and date comes from the invoice. `{link}` becomes the pay
  link only at sending time, so a message held for quiet hours never carries a link to a voided invoice.
- A billing message is an operational message to a customer, sent as the Owner (`origin: manual`). It needs
  the customer's recorded permission for that channel; Finance records it with how they agreed.
- Delivery (scheduled, sending, sent, delivered, failed, not sent with the policy's words) is read from the
  `messages` row, never copied.
- Chat (Owner only): `list_unpaid_invoices`, `explain_invoice`, `prepare_payment_reminders` (drafts only),
  and an invoice can be attached as context. Refunds and credits stay in Finance's confirmations.

## Setup

On the Convex deployment (`npx convex env set`):

| Setting | What it is |
|---|---|
| `STRIPE_SECRET_KEY` | Selestial's platform secret key (`sk_test_…` for test mode, `sk_live_…` for live). Unset: card payments say they aren't available; everything else works |
| `STRIPE_PUBLISHABLE_KEY` | The matching `pk_…` key, for the pay page |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | The `whsec_…` of a **Connect** webhook endpoint at `https://<deployment>.convex.site/webhooks/stripe`, listening for events on connected accounts: `account.updated`, `account.application.deauthorized`, `payment_intent.processing`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` |
| `ACTION_LINK_SECRET`, `LINK_ORIGIN`, `APP_ORIGIN` | Already used by cleaner links and invitations. Pay links need the first two; Stripe's return address after onboarding uses `APP_ORIGIN` |

In Stripe: enable Connect on Selestial's platform account. Accounts are created through the API with the
full Stripe Dashboard, Stripe collecting fees and covering losses (Managed Risk), and Stripe-hosted
onboarding. Stripe recommends Accounts v2 for new Connect platforms; this uses the v1 Accounts API with
controller properties, which Stripe still supports. The calls are all in `convex/lib/finance/stripe.ts`
so moving to v2 is one file. Connecting an account a company already has (OAuth) is not built yet.
