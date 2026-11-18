# Sales: how it was verified

## Automated

```
npm test            # includes convex/sales.test.ts and convex/salesSafety.test.ts
npm run typecheck
npx eslint .
npx next build
```

The scenario tests cover: the journey from a form to a job with Dispatch; duplicate inquiries and
submissions; a reply arriving before a reminder; opt-out; a person taking over and handing back;
revised, expired and withdrawn quotes; stale approvals; capacity and two bookings for one time;
an unsigned agreement and an unpaid deposit; access across companies; missing texting, email and
services; exhausted credits; provider failures and unconfirmed delivery; and pausing mid-run.

## In a real browser

Chromium, against a local Convex backend with no account, seeded with sample data (a made-up company,
"Brightside Cleaning Co."), with mock text and email services. This environment has no sign-in
service, so a temporary change that was not committed let the real workspace render as the sample Owner.
Every read and write went to the real functions.

Driven by clicking and typing:

1. Three inquiries arrived (two form submissions, one text). Sales prepared three messages and sent none.
2. The Owner sent all three from the first review.
3. A prospect answered Sales's question by text; Sales priced and sent the quote on its own.
4. A damage question and a question with no approved answer went to a person. A text the carrier
   refused showed as not delivered.
5. On a phone, the customer opened the private quote link, gave an address and access, chose an open
   time and accepted. The page said the time was held and not yet confirmed.
6. The Owner confirmed the booking in the opportunity. The page showed the job, with Dispatch.
7. On a phone, the public form refused a submission with missing answers, marking each, then accepted it.
8. Two prospects were imported from pasted lines (a third with nobody to reach was skipped). Each was
   filed waiting on a person. After the Owner recorded how one had agreed to be contacted, Sales sent
   its first question to that one and to nobody else.

Checked on every Sales page and both customer pages at 1440 wide and on an iPhone 13: no page error,
no console error, no sideways scrolling. The opportunity's tabs move with the arrow keys and Escape
closes it. `/c/form/*` is served without `X-Frame-Options`; `/c/quote/*` and the workspace keep `DENY`.

Screenshots: `docs/screenshots/sales/`.

## Not verified

- Email replies against live Resend. The reader is tested from the fetched message onward; the webhook notice and the fetch follow Resend's documented shapes and were not exercised against the service.
- Live Telnyx, Resend, Stripe and Anthropic. The AI reader's request shape is untested against the live API.
- Dragging a card with a mouse (the same server call was exercised from the opportunity and in tests).
- A screen reader, and measured contrast.
