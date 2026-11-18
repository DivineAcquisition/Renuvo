# Booking Experiences

Customers book a cleaning online, with no account, on a page the company builds in
**Sales › Booking Forms** (titled "Booking Experiences"). The layout follows the reference booking flow
(sticky branded header with progress, centered step headings, illustrated size cards, stacked offer
cards with a featured one, comparison, calendar with arrival windows, single-column checkout, details
and agreement, confirmation, a bottom bar on phones). None of the reference company's content is
carried over: no phone number, branding, claims, payment account, membership names or policy text.
Every word, price and rule on a Selestial page comes from the company's own settings.

The public booking page is separate from a customer portal. A guest gets one private link for one
booking; there is no login, no saved card and no booking history. A portal is a later, higher-plan
product and nothing here depends on it.

## 1. How it fits together

```
 Owner / Manager                           Visitor
 ───────────────                           ───────
 /app/agents/sales/booking-forms           /b/<handle>/<slug>          (also /embed for an iframe)
   home.tsx  rules.tsx                     /b/resume#bk_…              (link from an email)
   builder.tsx  inspector.tsx                     │
        │      (same renderer, preview mode)      │ server action (HMAC visitor key, rate limit)
        ▼                                         ▼
 bookingExperiences.ts  ──publish──▶  bookingExperienceVersions   bookingPublic.start  → session + token (once)
   draft (revisioned)                      (frozen definition)    bookingSessions.*    → steps, by token only
        │                                                                 │
        └──── lib/booking/definition.ts (typed, versioned, plain text, no HTML or script)
                                                                          │
          lib/booking/session.ts  recalc(): answers · quote · agreement · payment · capacity · confirmation
          lib/booking/logic.ts    pure rules shared with the browser (size plan, steps, gate)
          lib/services/engine.ts  the one pricing engine (server-side quote for every price shown)
          lib/booking/capacity.ts supply from Dispatch, holds acquired and released in one transaction
          lib/booking/payments.ts Finance invoice + payment, company's own Stripe, verified by webhook
          lib/booking/agreement.ts approved agreement templates, rendered with the booking's facts
          lib/booking/handoff.ts  customer, property, job, Dispatch coverage, confirmation message
          lib/booking/funnel.ts   funnel events without personal data; test sessions kept apart
```

Three layers stay apart:

- **Presentation** is the experience's `Definition` (`convex/lib/booking/definition.ts`): theme, header,
  step order and words, sections, which published services to offer and how to name them, size card
  labels, content (trust statements, FAQs, next steps), behavior (instant / estimate request /
  walkthrough request, which payment policy and agreement rule apply). It is validated and normalized
  on every save: plain text only, length limits, location first and confirmation last, size before
  service before checkout. There is no way to put HTML or script in it.
- **Business rules** live where they already lived and are only referenced: prices, scope, add-ons,
  questions and recurring options in Services & Pricing; service ZIP codes and hours in Business
  details; cleaners, time off and assignments in Dispatch; tax and Stripe in Finance; agreement
  templates in Agreements; sending policy in Messaging. Booking rules (`bookingSettings`) add only what
  is new: the public handle, the public profile, scheduling (notice, horizon, slot length, hold length,
  arrival window), payment policies (none, deposit %, fixed deposit, full) and agreement rules.
- **Booking state** is `bookingSessions`, one row per visitor, with separate states that are never
  inferred from one another: `answersState`, `quoteState` (firm / estimate / walkthrough / incomplete),
  `agreementState`, `paymentState`, `capacityState`, `confirmationState`, plus `blockers` in words.
  "Paid", "confirmed" and "crew accepted" are different facts and are shown differently.

The editor preview and the public page are the same React tree (`src/components/booking/renderer.tsx`).
In the builder it renders the draft against a test session; on `/b/…` it renders the published version.

## 2. Publishing and versions

A draft has a revision. Every save names the revision it started from; a stale save is refused with who
saved last, and the builder offers to reload or to keep its own copy. Publishing freezes the draft into
`bookingExperienceVersions` after the readiness check passes (`lib/booking/readiness.ts`): an active
plan, a handle, published services that can actually be offered, an approved promotion, a payment
policy that Stripe can take, an agreement that fills completely from the booking's facts, and trust
statements a person has confirmed. A visitor who started on version 3 finishes on version 3 even if
version 4 is published meanwhile. Rollback publishes an earlier version again; restore copies one into
the draft. Unpublishing closes the page to new visitors without breaking links already sent.
Publish, rollback, unpublish, archive and booking rules are the Owner's; drafts are Owner and Manager.

## 3. One booking, start to finish

1. **Start.** The ZIP code is posted through a Next server action that signs a visitor key with
   `PUBLIC_FORM_SECRET`; Convex refuses a start without it and rate-limits per visitor and per page.
   A random 256-bit token (`bk_…`) comes back once. Only its SHA-256 is stored. The browser keeps it
   under `selestial.booking.v1.<handle>.<slug>`; nothing else about the visitor is kept in browser
   storage. Campaign words and the referring site are kept; any other query string is dropped.
2. **Area, size, service.** Out-of-area ZIPs are offered a request. Size cards are built from the union
   of the offered services' price bands, or bedrooms/bathrooms, or square footage, or beds for a rental.
   Every price shown comes from `quote()` on the server with the published service version.
3. **Quote kinds.** A firm price books instantly. Hourly pricing is an estimate. A walkthrough answer,
   a condition that needs a walkthrough, a size above the custom-quote size, a custom-quote service, a
   recurring schedule or a package sends a request instead: nothing is reserved or charged.
4. **Time.** Slots come from ready cleaners' weekly windows minus time off, exceptions, active
   assignments, open crew on existing jobs and live holds. Choosing one acquires a hold inside the
   mutation that re-checks supply; a second visitor at the same moment is refused. Holds expire (15
   minutes by default, 20 while a payment is in flight) and are swept every five minutes. A company
   can choose request-only scheduling instead.
5. **Accept.** The accepted quote (total, lines, engine version, tax, amount due now) is frozen. If the
   price changes before payment the visitor is asked to accept again; the amount charged is always the
   amount accepted, checked against the invoice before an intent is created.
6. **Details and agreement.** Address, access and the service's own questions (with conditions).
   When the agreement rule applies, the approved template is rendered with the booking's facts and
   accepted inline by typed name (optionally drawn), with the content hash, time and IP hash kept as
   evidence. There is no production e-signature provider yet, so this is click-to-accept evidence.
7. **Payment.** A Finance invoice (with `depositCents`) and payment are created idempotently
   (`clientKey`), and Stripe is called on the company's own connected account with the payment's own
   idempotency key. The return redirect proves nothing: only the verified `payment_intent.succeeded`
   webhook (deduplicated by `providerReceipts`) moves `paymentState` to succeeded. From then on nothing
   priced can be changed on the page, and a payment only counts for the booking it paid for: the same
   invoice total and at least the amount due now.
8. **Confirmation.** `confirmationGate` checks answers, quote, agreement, payment and capacity
   independently. If the money arrived but the time can no longer be held (the hold expired and the
   slot is gone, a cleaner took time off), the session becomes `needs_attention` and a Sales task
   `booking-recovery:<id>` is opened instead of a silent double-booking.
9. **Handoff** runs once per session: customer matched by email or created, property matched or
   created, a job inserted the way `jobs.create` inserts one with a service snapshot priced from the
   saved quote, Dispatch coverage started, the invoice linked, and a confirmation email queued through
   the messaging outbox with a dedupe key. A request creates a Sales task `booking-request:<id>`.
10. **Managing it.** The confirmation email carries a fresh link token in the fragment
    (`/b/resume#bk_…`), so it never reaches a server log or a referrer. The link lasts 30 days past
    the visit and can be rotated or revoked by the customer or by the company. Changes are requests.

`/b` responses send `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`
and a `Permissions-Policy` that allows payment; only `/embed` may be framed.

## 4. Company Chat

`convex/lib/chat/bookingTools.ts` gives Chat bounded tools: list and read experiences (with what blocks
publishing and what keeps each service from an instant firm quote), create a draft of a kind from the
company's published services, and edit a draft (feature, order, hide or show services; colors or the
company's colors; step words; instant or request; a comparison built from the services' published
scope; trust statements, which stay unconfirmed until a person confirms them). Edits go through the
builder's revision-checked save, attributed "Selestial, asked by <name> in Chat", and answer with what
changed, the settings used, effects on price, payment and booking, and readiness. Chat never publishes
and never changes a price, deposit or agreement. These are workspace tools; the Sales agent is not
released, so nothing acts on its own.

## 5. Settings this uses

| Need | Comes from | Shown in the builder as |
|---|---|---|
| Prices, scope, add-ons, questions, recurring options | Services & Pricing (published versions) | "Price comes from Services & Pricing" |
| ZIP codes, business hours, timezone | Business details | "Hours come from Business details" |
| Cleaners, availability, time off, assignments | Dispatch | Capacity in the test booking and the checklist |
| Tax, invoices, Stripe connection | Finance | Payment policy and checklist |
| Agreement templates | Agreements (approved versions only) | Agreement rule and its missing answers |
| Sending policy, quiet hours, consent | Messaging | Confirmation and recovery messages |
| Roles | Members | Owner-only actions are disabled with the reason |
| Plan | Billing | Checklist blocker |

Deployment settings: `PUBLIC_FORM_SECRET` (Next and Convex), `ACTION_LINK_SECRET`, `LINK_ORIGIN`,
`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, and an email provider.

## 6. Feature parity with the reference flow

| Reference behavior | Selestial |
|---|---|
| ZIP gate, out-of-area handling | Implemented; out-of-area becomes a request |
| Sticky branded header, help links, progress | Implemented; links and colors from booking rules |
| Illustrated home-size cards | Implemented; built from the services' own price bands |
| Stacked offer cards, featured card, "most popular" | Implemented; badge and order editable |
| What's-included comparison | Implemented; rows from published scope |
| Frequency choice with discounts | Shown from the service's recurring options; booking a schedule is a request until recurring billing exists |
| Add-ons with quantities | Implemented from published add-ons |
| Calendar and arrival windows | Implemented from Dispatch supply with atomic holds |
| Single-column checkout, order summary, deposit | Implemented; deposit %, fixed, full or none |
| Property details, access, agreement | Implemented; agreement from approved templates |
| Confirmation and next steps | Implemented; states shown separately |
| Mobile bottom bar | Implemented |
| Memberships, bundles of visits, focused-area add-on pricing | Not carried over (see section 7) |

## 7. Status

### Implemented and verified

Verified by `convex/booking.test.ts` (24 tests), `convex/bookingChat.test.ts` (3 tests), the whole suite
(892 tests), typecheck, lint and a production build, and by driving the public pages and the builder in
Chromium at desktop and phone widths against the real Convex functions (screenshots in
`docs/screenshots/booking/`).

- Building, saving with revision conflicts, publishing, version pinning during a session, rollback,
  unpublish, archive, duplicate; readiness blockers with links to the setting to fix.
- Company isolation; Office cannot edit; Owner-only publishing and rules.
- Residential instant booking without payment, with a deposit through the fake Stripe including
  duplicate webhooks, and a redirect without a webhook not counting as paid.
- Simultaneous visitors at one time; confirmed visits and holds both counted (an overbooking bug found
  in the browser run is fixed and covered); hold expiry; payment after the time was lost becoming a
  recovery task.
- Price changed after acceptance requiring a new acceptance.
- Once a payment is processing or received, the ZIP, size, service, time and acceptance are locked (the
  customer is sent to the company); an unfinished card form is cancelled when the choice changes; a
  received payment that doesn't match the booking as it stands (another total, too little, or the booking
  became a request) never confirms it and opens the recovery task instead, and is never dropped.
- Commercial walkthrough requests, short-term rental turnovers, recurring requests.
- Test bookings never charge and are kept out of live analytics.
- Links: expiry, revocation, rotation; tokens only hashed; start only through the server with rate
  limits; attribution trimmed.
- Chat: create, edit, read quote blockers, refusals by role and for unpublished services, no publishing.

### Works, but needs configuration on a deployment

- Taking money: the company connects Stripe in Finance; the deployment sets the Stripe keys and webhook
  secret. Without them a page can still book with "no payment online" or send requests.
- Sending the confirmation and recovery emails: an email provider for the messaging outbox. Until then
  messages are queued and visible but not delivered.
- `PUBLIC_FORM_SECRET` on both Next and Convex (starts are refused without it), `ACTION_LINK_SECRET` and
  `LINK_ORIGIN` for links.
- The company's own agreement templates approved in Agreements, if an agreement rule is turned on.

### Not built yet, and what each waits on

| Remaining | Depends on |
|---|---|
| Booking a recurring schedule or package instantly | Recurring billing and visit generation in Finance and Dispatch |
| Bundles of several visits priced together | A multi-visit price in the services engine |
| Legally stronger signatures | An e-signature provider adapter in Agreements |
| Calendar sync for cleaners | A calendar integration |
| Custom domains for booking pages | Domain verification on the link host |
| Customer portal (history, saved cards, self-serve reschedule) | The higher-plan portal product |
| Charging the balance off-session after the visit | Saved payment methods in Finance |
| Sales agent following up on requests and recoveries on its own | The Sales agent's release; today these are tasks for people |
