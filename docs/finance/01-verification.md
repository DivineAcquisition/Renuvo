# Finance: verification

## Tests

`convex/finance.test.ts` (14 tests) runs against `tests/fakeStripe.ts`, a stand-in for the parts of
Stripe's API Finance uses. It replays a request sent again with the same Idempotency-Key and can lose
an answer either before or after Stripe acted.

- Invoice arithmetic: line rounding, tax on taxable lines after taxable discounts, refusals.
- Owner only: a Manager is refused; another company's invoice is "Not found." for reads and writes.
- Journey 1, invoice → partial payment: a draft from a completed visit (asking again opens the same
  draft) → issue (INV-1001, pay link) → frozen lines → overpayment refused → $100 recorded once despite
  a double submit → partially paid → a mistaken payment voided with a reason → paid in full, with history.
- Confirmations: a credit reviewed before money arrived is refused at confirmation; the new preview
  shows the new limit.
- Void: refused while money is on the invoice; after a refund it voids, and the pay page then shows
  "cancelled" and refuses a new payment.
- Deposits: deposit requested → deposit paid (a finding appears) → balance requested with a due date.
- Card payment: the pay page view and an attempt; a forged link is null; processing is shown and not
  counted as paid; a succeeded event delivered twice counts once; the fee and card are recorded;
  the client secret is cleared; an unsigned webhook gets 401.
- Journey 6, an unclear answer: Stripe creates the payment and the answer is lost. The payment is
  "checking", has no client secret, and is asked again with the same key. There is one payment at
  Stripe, and it becomes payable.
- A payment the customer started is cancelled at Stripe when the invoice is paid another way.
- A declined card: the payment is failed with Stripe's words, the invoice stays open, and a finding lists it.
- Refunds: an unclear first answer → "checking" (nothing counted) → one refund at Stripe → refunded and
  credited, balance $0, statement in order. More than was received is refused. One click sent twice
  makes one refund. Without a credit, the customer owes the amount again.
- Connecting Stripe: a lost answer on account creation makes one account across two attempts; with no
  platform key the state is "not available" and connecting is refused in words.
- Overview: collected counts only money that arrived; outstanding, invoiced, the eight-week trend, and
  overdue once the terms pass.

Also changed: `dataRights.test.ts` (the export now covers the six finance tables, with link and secret
fields left out), `integrations.test.ts` (Stripe is built; the planned example is now Square), and
`navigation.test.ts` (Finance is live; its setup page is accounted for).

```
npm test            # 60 files, 645 passed, 19 skipped
npm run typecheck   # passes
npx eslint .        # 0 errors (1 warning in an existing file, not this work)
npx next build      # passes
```

## In a real browser

The screens were driven in Chromium against a local Convex backend (`convex dev` with no account),
seeded with **sample data** (a made-up company, "Brightside Cleaning Co."). Every screenshot carries a
"Sample data · local preview" label. This environment has no sign-in service, so a temporary preview
page, not committed, rendered the real Finance components with a Convex client acting as the sample
Owner. Every read and write went to the real functions.

Driven end to end by clicking:

1. Draft → add a line → saved → "Review and issue" → issued as INV-1031 with a pay link → "Record
   payment" $100 by check with a confirmation → "Partially paid", $95.00 requested.
2. Refund $30 of that check, "They no longer owe it", with the confirmation of having returned it → a
   refund and its credit are recorded once and appear in the history. Escape closes the drawer.
3. The customer's pay page in three states: amount due with the option to pay part, a card attempt that
   Stripe refused (the local key is a placeholder), and paid in full with a credit and a refund listed.

Checked at 1440 wide and on an iPhone 13 (390 wide): no sideways scrolling on any Finance screen or the
pay page. Fixed along the way: a definition tooltip that widened the phone page, a drawer whose
content was wider than the drawer, draft inputs overflowing their columns, the phone invoice list being
cut off, and a payment recorded the same day as its invoice being listed before it on the statement.

Screenshots: `docs/screenshots/finance/`.

## Not verified

- **Real Stripe.** No Stripe test keys are available here. Account creation, onboarding links, payment
  intents, refunds and webhooks were exercised against the stand-in only. The Payment Element itself
  was not rendered, because it needs a real payment intent.
- **A real phone and a real bank payment** (ACH processing over days).
- **Live webhooks from Stripe.** The signature check follows Stripe's documented scheme and is tested
  with locally signed bodies.
- **Dark mode screenshots.** The chart color was validated for both themes; the screens were reviewed in
  light mode only.

## Remaining for later phases

1. Selestial sending invoices and reminders to customers (Phase 2). Until then the Owner copies the pay
   link and marks it sent; Selestial never claims to have sent anything.
2. Chat tools over invoices and payments (Phase 2). The invoice drawer already offers its customer to the
   chat panel as context.
3. Saved cards and charging them, recurring invoices, write-offs, and connecting an existing Stripe
   account through OAuth.
4. Expenses, Team Pay and Profitability are shown as "Soon" and do nothing.


---

# Phase 2: collections with Selestial

## Tests

`convex/financeMessages.test.ts` (8 tests), with the mock email provider:

- The schedule: 3 days before, 1, 7 and 14 days after; nothing for an invoice issued inside the 3-day
  window; nothing when nothing is asked for.
- The sweep prepares each step once and never sends; a later step replaces a waiting earlier draft; paying
  the invoice takes the draft out of the queue and the sweep sets it aside.
- Reminders off: nothing prepared. A Manager can't see the queue or prepare.
- Approve: the email goes exactly as approved, under the company's name, replies to the Owner, with the
  pay link made at sending time; approving twice sends once; delivery shows on the invoice.
- Can't send: "sending setup not finished" then "no recorded permission", in the policy's words, before
  approving; approved anyway, the policy refuses it and it shows as needing attention. Nothing is emailed.
- What's owed changes after review: the approval is refused, Selestial's words are rewritten with the new
  amount, and the re-reviewed message goes with $140.00, not $240.00.
- Send all: the permitted message goes, the other is reported with its reason. A message held for quiet
  hours is not sent once its invoice is voided ("The invoice was voided before the message went out.").
- Chat: the three finance tools are offered to the Owner only; they list overdue invoices from the record,
  explain one by its number, and prepare drafts with nothing sent.

```
npm test            # 61 files, 653 passed, 19 skipped
npm run typecheck   # passes
npx eslint .        # 0 errors (1 warning in an existing file, not this work)
npx next build      # passes
```

## In a real browser

Same local backend and labelled sample data. The hourly schedule had already prepared two reminders on its
own (a 14-day reminder that could send, and a 7-day reminder blocked for lack of permission). Driven by
clicking: Record permission from the blocked card → Edit the words → Approve and send → the queue shrinks
and "Sent recently" shows it Delivered (mock email). Send all lists each recipient, channel and amount.
Checked at 1440 wide and 390 wide with no sideways scrolling; fixed a rail card wider than its column, and
renamed schedule steps ("7-day reminder") so they don't contradict the actual days late in the text.

Screenshots: `docs/screenshots/finance/09`–`12`.

## Not verified

- Real email and text delivery (Resend, the company's Gmail, Telnyx), bounces and STOP replies end to end.
  These go through the shared messaging code, which has its own tests.
- A real model choosing the Chat tools; the tools were called directly.
