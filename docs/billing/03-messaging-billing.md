# Messaging billing: how it works, how to turn it on, and what is proven

Built in six phases on top of the existing Autumn billing (phase 1's audit and decisions are in
[02-messaging-audit.md](02-messaging-audit.md)). **It is not production-ready.** Everything below was tested
against stand-ins for Autumn, Stripe, Telnyx and the email service, never against the real accounts, because
no keys for them exist in the development environment. See "Not proven" at the end before switching it on.

## What a company pays for

Three separate things, shown side by side on Settings → Plan & Usage:

| | What it is | Where it lives |
|---|---|---|
| **Plan** | Operate $299 or Expand $499 a month: the agents and features. | Autumn subscription |
| **AI credits** | AI work (writing, reading, creating). Sending a message that is already written uses none. | Autumn `credits` feature |
| **Messaging balance** | Prepaid US dollars for texts and business email. Never expires; carries over. | Autumn `messaging_balance` feature |

### Prices (`msg-2026-11`, the same on both plans, standard US routes only, carrier fees included)

| Item | Price |
|---|---|
| Outbound text | $0.025 per segment |
| Inbound text | $0.015 per segment |
| Outbound picture message | $0.05 per message (not sendable yet; see "Not built") |
| Inbound picture message | $0.04 per message |
| Business email through Selestial's delivery | $0.002 per distinct recipient |
| Email through the company's own Gmail | Included |
| Business texting number | $3.00 a month |
| Carrier registration | At Selestial's actual cost, entered by staff from the registry's bill |

Taxes are separate (Stripe Tax through Autumn, off until registrations exist). International, Canadian,
toll-free, short-code, premium and US-territory numbers have no rate and are refused before anything is held.

**Included, never charged:** sign-in and verification codes, receipts and billing notices, invitations and
onboarding, approval alerts and digests, low-balance and disconnection notices, notices to the company's own
members, STOP/HELP/START replies, inbound email and reading the inbox. Classified on the server from the
message's purpose (`convex/lib/messagingBilling/classify.ts`); nothing a screen or agent sends can mark a
business message as included.

## How a message is charged

All money is whole units of $0.0001 (`money.ts`), so amounts under a cent are exact.

1. **Plan** (`claim` in `convex/messaging.ts` → `planOutbound` in `ledger.ts`), after every existing check
   (suspension, paused agent, permission, opt-out, quiet hours) and after the email route is decided:
   - included purpose, or email through the company's Gmail → **free**;
   - no plan, unsupported route, text over 10 segments, no address → **not sent**, nothing held;
   - balance too low, monthly limit, the agent's monthly limit, or billing unreachable → **held** with the
     message and its words kept (`holdReason`), the Owner told (notice + email, once a day);
   - otherwise a charge row is written with the price list version and unit price → **reserve**.
2. **Hold** the estimate in Autumn (`balances.check` with a lock). Only a verified answer counts: a degraded
   202, timeout or error releases any hold and the message waits, uncharged.
3. **Send.** A retry of the same message reuses the same hold: a retry is never a second charge.
4. **Settle**: success captures the provider's own count (segments Telnyx reports; distinct recipients for
   email); a final failure, or an inbox that stopped letting Selestial send, releases the hold; a send with no
   answer stays **pending** (never resent) and is released uncharged after the hold window if never confirmed.
5. **Reconcile** with Autumn by the settlement sweep every 5 minutes (confirm, release, or track the
   difference), with back-off; and with the provider's final report: Telnyx's cost is stored for margin
   reporting, and its "not charged" code (40014) refunds the text. A report that arrives before its send
   settles is kept and applied when it does.

Inbound texts are charged after they arrive (they cannot be refused), down to an overdraft floor of **-$10**.
The Owner is told at $0 and -$5; at -$10, or at more than 300 inbound texts in an hour, an item opens for
Selestial staff (staff console → Messaging money). Opt-outs always work. **A number is never released for a
low balance.**

### Ledger (`messagingCharges`)

One row per charge with company, channel, direction, message and provider references, agent or member,
activity in words, count, price list version, unit price, amount set aside, final amount, settlement state,
provider cost, refund link, reason and a history of every step. A refund is its own row naming the original;
a charge can be refunded once. Number fees, registration fees, support credits and refund/dispute
adjustments are rows too (`postAdjustment`), each with a key so it is posted once. Autumn holds the money; the
balance Selestial shows is Autumn's, moved locally by exactly what Autumn moves until the next sync (a test
guard checks they agree after every billing test).

## Money in

- **Add funds:** $25, $50, $100 or whole dollars from $10 to $1,000. Autumn previews the exact charge (tax on
  its own line); nothing is bought until the Owner confirms; held messages are checked again and sent once
  paid. Owner only, plan required.
- **Automatic top-up:** off until the Owner ticks the exact authorization words, which name the threshold,
  amount and monthly cap ("I authorize Selestial to charge my saved payment method $25.00 … whenever my
  messaging balance falls below $5.00, up to 4 times ($100.00) per calendar month…"). The server accepts only
  those exact words and stores who and when. Agents can never add funds or change this.
- **Refunds and disputes:** a Stripe refund of a top-up takes back up to what it added, once per event; staff
  record disputes (opened takes the funds back, won returns them).
- **Promotional funds** are kept apart from paid funds, with their expiry shown.

## Controls (Owner only)

Monthly limit, largest single batch, low-balance alert, and a monthly limit for each of Sales, Dispatch,
Recruiter and Retention. Limits stop spending; they never grant permission to send. Spending is counted
against the agent whose work it is, including a draft a person edited or approved. The batch limit is
enforced on the Sales first review batch, which shows a full preview first: who gets a message and who
doesn't (with the sending policy's own reason), segments, emails, cost against the balance, and "AI credits:
none". Text composers show "This message uses 2 SMS segments. Estimated cost: $0.05."

## Turning it on (launch checklist)

1. Push the Autumn catalog (`billing/autumn.config.ts`): the `messaging_balance` feature and the
   `messaging_top_up` add-on ($1 per 10,000 units, one-off, prepaid). **Not pushed yet.**
2. Autumn: enable auto top-ups for `messaging_balance`; confirm the existing webhook endpoint receives
   `billing.auto_topup_succeeded` and `billing.auto_topup_failed`.
3. Stripe (the account Autumn uses): add a webhook to `/webhooks/stripe-billing` for `charge.refunded` and set
   `STRIPE_BILLING_WEBHOOK_SECRET` in Convex.
4. Telnyx: confirm `message.finalized` webhooks reach `/webhooks/telnyx` with `cost` and `errors`.
5. `EMAIL_PROVIDER` and its keys set, so Owner notices are emailed.
6. Stripe Tax registrations, then turn tax on in Autumn.
7. Run one sandbox pass of every case in the table below against the real Autumn, Stripe and Telnyx.
8. Then set `MESSAGING_BILLING=on`. Until then nothing is metered and every screen says so.

`MESSAGING_RATE_CARD` pins a price list version; leave it unset in production (the test-only list
`msg-fixture-higher` can only be reached through it).

## Failure cases and the tests that cover them

| Case | Test (file › test) |
|---|---|
| Concurrency: two sends against a balance for one | messagingBilling › never overspends |
| Same send started twice; double click | messagingEndToEnd › sends and charges once when the same message is started twice |
| Multi-part and Unicode texts; provider's count differs | messagingBilling › charges Unicode and long texts by segment |
| Multiple recipients counted once; Gmail excluded | messagingEndToEnd › charges email … per distinct recipient |
| Duplicate and out-of-order delivery reports | messagingEndToEnd › applies a delivery report that beats the send's own answer; refunds a text whose early report … |
| Duplicate inbound webhook | messagingBilling › charges inbound texts even at zero |
| Provider timeout / unknown outcome | messagingBilling › treats a send that never answered as uncertain |
| Retry then final failure | messagingBilling › retries a provider failure on the same hold |
| Billing unreachable or unverified answer | messagingBilling › never holds a send on an unverified answer |
| Failed and duplicate top-ups | messagingFunds › adds funds only after the Owner confirms; records a purchase that needs a card; records each automatic top-up once |
| Refunds and disputes | messagingFunds › takes back refunded top-up funds once per event; holds back disputed funds |
| Included notices | messagingBilling › does not charge the required answer to STOP; emails the Owner … never the balance |
| Opt-out while waiting | messagingBilling › keeps a message that waited for funds, and checks it again |
| Inbound at zero and at the floor | messagingBilling › charges inbound texts even at zero; opens one item for Selestial staff |
| Limits and batch limit | messagingBatch › refuses a batch over the Owner's batch limit; messagingFunds › shows the Owner … held work |
| Price change while queued | messagingEndToEnd › keeps the price set aside when the price list changes |
| Cancellation with unused funds | messagingEndToEnd › refuses business messages once the plan has ended, keeps the funds |
| Tenant isolation and permissions | messagingEndToEnd › keeps each company's messaging money to its own Owner |
| Number and registration fees | texting › charges the number and its registration … only with the Owner's authorization |
| Metering off | messagingBilling › charges nothing while metering is off |

## Not proven, not built, and risks

**Not proven against the real services** (stand-ins only):
- Autumn: the `customers.update` path and shape for auto top-up controls; that a lock's answer reports the
  balance after the hold; that top-up invoices carry Stripe's invoice id (refund matching depends on it).
- Telnyx: idempotency-key handling on send; `cost` on inbound and outbound final reports.
- Email delivery of Owner notices to a real inbox.

**Not built:**
- Outbound picture messages: the texting sender only sends plain text. Inbound picture messages are charged.
- The batch limit covers the Sales first review only. Recruiter urgent outreach is one approval per
  applicant and crew offers are capped by open places; every message still meets the balance, monthly and
  agent limits.
- Disputes are recorded by staff; matching them automatically needs read access to Stripe charges.
- Ending a number (and its fee) has no flow; there is no release call at all.

**Risks:**
- The 10DLC campaign describes cleaner work texts only, but the numbers also text customers and applicants
  (phase 1 audit). This is a carrier-compliance risk regardless of billing.
- Telnyx's $10/month campaign fee and registration fees are not covered by the $3 number fee unless staff
  post them; the margin table in the audit assumes they are.
