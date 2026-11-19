# Messaging usage and billing: Phase 1 audit and plan

Date: November 18, 2026. Read-only audit of `main` at 6cc37d9, plus provider documentation read the same day.
Nothing in billing was changed by this phase.

## 1. What exists

### Billing (Autumn over Stripe)

- **Ownership.** Autumn is the authority on plans and balances. Selestial keeps:
  - the company → customer mapping (`billingAccounts`);
  - a read-only copy of Autumn's record;
  - one row per piece of AI work (`aiExecutions`);
  - webhook receipts (`billingWebhooks`) and the purchases people started (`billingIntents`).

  Selestial has no wallet of its own. See `docs/billing/README.md`.
- **Plans.** Operate $299 and Expand $499, in group `selestial`. These match the intended catalog, so no
  discrepancy needs flagging. AI credits are `selestial_credits`: 5,000 a month on Operate and 10,000 on
  Expand, reset monthly. Credit top-ups are defined but not on sale.
- **Reserve, run, finalize for AI work.** The REST API is called directly at version 2.6.0
  (`convex/lib/billing/autumn.ts`), never through the SDK, which fails open:
  - `balances.check` with `send_event` and a `lock` (expiry always set, `Idempotency-Key`), then
    `balances.finalize` to `confirm` (with an override for the actual amount) or `release`.
  - Every answer is classified:
    - 200 counts as verified.
    - 202 means degraded, which is never treated as allowed.
    - 409 is a replay.
    - 5xx means unavailable.
  - A 5-minute sweep retries settlements and expires abandoned holds.
- **Intents.** Plan changes, top-ups, the billing portal and setting up a payment method each run as an
  intent the Owner confirms. Autumn webhooks are signed and deduplicated, and a webhook only triggers a
  fresh read from Autumn.
- **Not built.** Automatic top-ups, Stripe refund and dispute handling, any tax configuration, and email
  to Owners (billing notices only appear in the app).
- **Verification.** Everything above was tested against `tests/fakeAutumn.ts` only. No Autumn or Stripe key
  exists in this environment, and the README records that no real sandbox run has happened.

### Messaging

- **One outbox.** Every business message goes through `messages`:
  plan → `claim` (the sending policy is checked again) → `deliver` → `settle` → provider receipt.
  - A send whose outcome is unknown becomes `unconfirmed` and is never resent automatically.
  - Each message carries a `dedupeKey`, and its provider idempotency key is the message id.
  - Writers:
    - Dispatch, Cleaners, Recruiter, Sales and Booking;
    - Finance, both to customers and to cleaners;
    - Client conversations;
    - STOP/HELP answers.
- **One policy, `checkSend`.** It runs when a message is planned and again at claim. It is the natural
  place for a messaging-balance refusal.
- **SMS through Telnyx.** Sends are SMS only, with `type: "SMS"` and no MMS anywhere.
  - Of the send response, only `id` and `status` are read. `parts`, `encoding` and `cost` are ignored, both
    there and in `message.finalized`.
  - `message.sent` is ignored.
  - Inbound texts are handled (`convex/inbound.ts`), but their `parts` and `cost` are not read. There is no
    single inbound ledger: inbound texts land in `inboundMessages`, `salesMessages` or tasks.
- **Numbers.** Numbers are searched for and ordered per company through Selestial's Telnyx account
  (`convex/texting.ts`), with staff approval, a 10DLC brand and campaign, and assignment. Alternatively a
  number can be typed in by hand. There is no recurring number charge, no number release, and no record of
  10DLC fees.
- **Email.**
  - **Resend**, through `lib/email/provider.ts`: one `to` only, with no cc or bcc. Webhooks for delivered,
    bounced, complained, failed and received are handled. Inbound is only Sales reply-addresses.
  - **Gmail**, through the company's connected mailbox: used for applicant, finance and sales email when
    connected.
  - **Selestial's own email** (invitations, trust requests) calls Resend directly, outside the outbox.
- **Agents.**
  - Dispatch and Recruiter run.
  - Sales runs, with `salesActions`, a first review batch, and re-checks at send time.
  - Cleaners follow-ups run under Recruiter or Dispatch.
  - Retention is not built.
  - Authority (`off`, `propose`, `execute_and_report`, `execute`) is separate from billing.
- **Owner screens.** Settings → Plan & Usage has Plan, Usage and Billing tabs. The Usage tab already lists
  "Texts, email and calls" as counts with no price.

## 2. What blocks metered messaging today (fixed in phases 2–5)

1. **No billable units are captured.** Nothing records SMS segments, encoding, provider cost, MMS, email
   recipient count or the provider that actually sent a message.
   - `messages.provider` can be wrong: booking email is labelled Gmail but sent through Resend.
2. **No segment calculator** (GSM-7 vs UCS-2), so no estimate can be shown before sending.
3. **No MMS at all.**
4. **No single inbound record per company**, and inbound cost is never read.
5. **Delivery reports can be lost.** A report that arrives while a message is still `sending` is marked as
   seen and dropped.
6. **Gmail can send twice.** Gmail sends have no idempotency, so a retry can duplicate.
7. **No sender on the message.** `messages` does not record which agent sent it, and sends a person approved
   for Recruiter are recorded as manual, so spend by agent is not possible.
8. **Refusals are final.** A refused send becomes `not_sent` for good. Only quiet hours hold and resume. A
   "waiting on balance" hold that is re-checked before sending is needed.
9. **Owners are notified only in the app.** Low balance, top-up failures and paused work need email through
   Selestial's included channel.
10. **No number lifecycle charges.** Numbers have no monthly charge and no 10DLC fee records.

## 3. Provider economics (official pages, read November 18, 2026)

| Route | Retail | Provider cost (Telnyx or Resend, plus US carrier fees) | Margin before card fees |
|---|---|---|---|
| Outbound SMS, per segment | $0.025 | $0.0075–0.009 | ~64–70% |
| Inbound SMS, per segment | $0.015 | $0.004–0.0075 | ~50–73% |
| Outbound MMS | $0.05 | $0.022–0.025 | ~50–56% |
| Inbound MMS | $0.04 | $0.005–0.015 | ~62–87% |
| Resend email, per recipient | $0.002 | $0.0004–0.0009 (Pro plan) | ~55–80% |
| US local number, per month | $3.00 | $1.10 ($1.00 number, $0.10 messaging) | ~63% |

Every route is above cost. These are the risks:

- **10DLC fees.** Brand $4.50, campaign review $15 per review, a monthly campaign fee (typically $10 for
  standard use cases, billed 3 months up front), and optional vetting from $41.50. If absorbed, a $10
  campaign fee makes a number lose money. These pass through at actual cost, as the rate card says.
- **Card fees are above 3% on small top-ups.** With 2.9% + 30¢ + 0.7% Billing, a $25 top-up costs about
  4.8% and $100 about 3.9%. A $15 dispute fee wipes out the margin of about 950 SMS segments.
- **Resend's plan minimum.** Below about 10,000 emails a month across all of Selestial, the $20 plan floor
  costs more than $0.002 per email. Inbound email uses the same quota.
- **Failed messages.** Telnyx charges for carrier-failed messages. Not charging the customer for them, as
  intended at launch, means absorbing about $0.008 per failed segment.
- **Optional features that must stay off:**
  - Number lookup on every send ($0.0025 to $0.044 a query).
  - Enhanced vetting.
  - A dedicated Resend IP ($30 a month).
  - Short codes ($1,000 a month).

  Telnyx smart encoding has no listed fee, and it lowers segment counts.
- **Autumn degraded checks.** A 202 must never allow a send, as the AI-credit code already enforces.

## 4. Who owns what (no second wallet)

| Concern | Owner |
|---|---|
| Payments, top-ups and automatic top-ups (charging the saved card) | **Autumn**, over Stripe |
| Available messaging balance and reservations | **Autumn**: a feature `messaging_balance` with `one_off` (no reset) prepaid balances, `balances.check` locks and `finalize` |
| Rate card, segment and recipient counts, the audit ledger of each charge, provider costs, refunds and adjustments | **Selestial**: tables `messagingCharges`, `messagingRateCards` (in code) and `messagingTopUps`, mirroring Autumn lock ids |
| Promotional balance | **Autumn**: `balances.create` with its own expiry, shown separately |

- **Unit.** One balance unit is $0.0001. Each rate is then a whole number: outbound SMS 250, inbound SMS 150,
  outbound MMS 500, inbound MMS 400, email 20. A $25 top-up is 250,000 units. No floating-point dollars
  anywhere; Selestial stores integers in units of $0.0001.
- **Reserve → send → reconcile.** Per message:
  1. Estimate the charge.
  2. Lock the estimated units in Autumn, keyed by the message, and record `reserved`.
  3. Send.
  4. Confirm with the provider's billable units: email at acceptance, SMS on `message.sent` or
     `message.finalized` using `parts`.
  5. Or release the lock.

  An unknown outcome stays `pending` until it is reconciled. A retry reuses the same lock, so it is never a
  second charge.
- **Inbound** is charged after it arrives. It can take the balance below zero, but only to a set limit (see
  the decisions below).

## 5. Launch blockers outside the code

1. **No Autumn sandbox key** in this environment. The flows can only be verified against the stand-in until
   one is provided. Production needs `AUTUMN_SECRET_KEY` and a pushed catalog that includes
   `messaging_balance`.
2. **No Stripe access for refunds and disputes.** Autumn does not document removing balance when a top-up is
   refunded or disputed. That needs a webhook from the Stripe account Autumn uses (secret and signing key).
3. **No tax configuration** for Selestial's own billing.
4. **The 10DLC campaign covers the wrong traffic.** It describes cleaner work texts only, but the same
   numbers text customers (Sales, Finance, client messages) and applicants. That is a carrier-compliance
   risk regardless of billing.
5. **Unconfirmed provider details.** Telnyx inbound cost reporting and Telnyx's acceptance of an idempotency
   key were not confirmed from the docs. Phase 6 tests both against the sandbox when keys exist.

## 6. Decisions (owner, November 18, 2026)

| Question | Decision |
|---|---|
| How number rental and 10DLC fees are charged | **From the messaging balance.** $3 per active number per month and registration fees at actual provider cost, on their own lines apart from message usage, each authorized by the Owner before anything is bought. |
| Inbound overdraft | **Down to -$10.** Inbound keeps being received and processed (opt-outs always). The Owner is alerted at $0 and at -$5. At -$10 Selestial staff get an escalation task. A number is never released for a low balance. The next top-up repays the overdraft first. |
| Tax | **Stripe Tax through Autumn.** Tax is a separate line, never part of the advertised rate. It stays off until Selestial's Stripe Tax registrations are set up (a launch dependency). |
| Plans | Operate $299 and Expand $499 already match Autumn's catalog. No change. |
