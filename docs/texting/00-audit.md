# Business texting: audit and plan

Phase 1 of "Set up business texting". It records what exists, what Telnyx actually requires (checked
against Telnyx's API reference and support articles on 2026-11-19), and how the guided setup is built on
top of what is already here. The outbox (`messages`), the sending policy (`checkSend`), the consent
records and `textingRequests` provisioning stay. Everything below extends them.

Checked against `main` at 0b51ef8 and the live backend (terrific-avocet-835).

## 1. What exists

| Area | Where | What it does today |
|---|---|---|
| Owner form | `src/components/app/screens/texting-setup.tsx`, inside Settings › Privacy & messaging | One long form: area-code search, brand details, consent wording, fee consent, submit. Status text after submitting. |
| Request + provisioning | `convex/texting.ts` | `searchNumbersFor` → `request` (one open request per company) → staff `approve` → `provision` loop: order number, create brand, poll, create campaign, poll, assign number, poll, `activate`. Keeps each Telnyx reference so a retry continues. |
| Telnyx calls | `convex/lib/messaging/telnyxAccount.ts` | Search, order, brand, campaign, assignment, status sets. |
| Campaign content | `convex/lib/messaging/campaign.ts` | `ACCOUNT_NOTIFICATION` campaign about cleaner work texts only. Privacy and terms links point to **selestial.io**. |
| Staff review | `src/components/staff/console.tsx` (TextingQueue, RegistrationFee, MessagingAttention) | Approve, reject, retry, charge a registration fee by hand. |
| Fees | `convex/lib/messagingBilling/{rates,wording}.ts` | Number $3.00/month from the messaging balance (rate card `msg-2026-11`), authorization wording `numberFeesWording`, registration fees charged by staff "at Selestial's actual cost". Only while `MESSAGING_BILLING=on`. |
| Sending gate | `convex/lib/messaging/policy.ts` `senderGaps` | SMS needs a sender name, a number and `registration.status === "approved"`. One flag for every kind of text. |
| Inbound | `convex/inbound.ts` | Finds the company by number (`by_sms_number`), handles STOP/HELP/START and plain-language opt-outs, routes to Sales, client conversations, reply tasks and Retention. |
| Agent readiness | `convex/lib/setup/readiness.ts` | `canText` is one yes/no for the company. |
| Consent capture | portal onboarding (cleaners, operational), applicant form (recruiting), Sales inbound text (text_reply), manual (`convex/consent.ts`) | Booking form collects email permission only. The portal's cleaner disclosure has no "Msg & data rates may apply". |
| Hosted pages | — | None. There is no company privacy policy, texting terms or sign-up page anywhere. |

Live backend on 2026-11-19: 24 companies, **0 texting requests, 0 compliance profiles with a texting
number**. No active number or approved registration exists to migrate; the code still keeps every
existing row working (see §6).

## 2. What is wrong or missing

1. **Platform privacy and terms links.** `campaignFor` files every company's campaign with
   selestial.io/privacy and /terms. Telnyx: the privacy policy "must be for the brand being registered"
   and must say mobile information is not sold or shared with third parties for marketing.
2. **Cleaner-only registration.** The campaign describes Dispatch texts only. Sales, Recruiter and
   Retention texts would be sent under a campaign that does not describe them.
3. **Hardcoded `entityType: "PRIVATE_PROFIT"`** and a required EIN. Non-profits and companies without an
   EIN cannot register honestly.
4. **Status handling.** `SELF_DECLARED` is treated as a failure (it is the normal state of a sole
   proprietor brand before its one-time code). Brand `status: REGISTRATION_FAILED` is ignored.
   `MNO_PROVISIONING_FAILED` is missing from the campaign failure set.
5. **Number orders rely on an `idempotency-key` header** that Telnyx does not declare. A retry after a
   timeout could buy a second number. The order must be looked up by `customer_reference` first.
6. **No duplicate guard on campaigns.** `referenceId` (which Telnyx documents for preventing duplicate
   campaign registrations) is not sent.
7. **No 10DLC webhooks.** Brands and campaigns are created with `webhookURL: null`; progress is polled
   every 10–30 minutes only.
8. **The EIN is stored in plain text** on `textingRequests.brand.ein`.
9. **One flag for readiness.** `registration.status === "approved"` lets every agent text every audience,
   whatever was registered.
10. **Everything on one form**, no saved draft, no sources, no preview, no step progress.
11. **Opt-in that does not exist yet.** The campaign's message flow describes consent collection that the
    company may not actually have (for example customers on the booking form).

## 3. What Telnyx requires (verified)

Sources: developers.telnyx.com API reference (create brand, submit campaign, phone number campaigns, 10DLC
event notifications, sole proprietor) and support.telnyx.com (10DLC fees, campaign compliance guide,
ISVs and 10DLC). Copies are in the session scratchpad; the live API could not be read from this session
because the Telnyx key in the session environment is rejected.

**Brand** (`POST /v2/10dlc/brand`, response unwrapped):
- Always: `entityType`, `displayName`, `country`, `email`, `vertical`. Also send `phone`, `street`, `city`,
  `state` (2 letters), `postalCode` (5 digits), `website`.
- `PRIVATE_PROFIT`, `NON_PROFIT`: `companyName` (legal name) and `ein`.
- `PUBLIC_PROFIT`: also `stockSymbol`, `stockExchange`, `businessContactEmail`.
- `SOLE_PROPRIETOR`: `firstName`, `lastName`, `mobilePhone`; no EIN. Verified by a one-time code sent to
  that mobile (`POST/GET/PUT /10dlc/brand/{id}/smsOtp`, valid 24 h). Limits: 1 campaign, 1 number,
  use case `SOLE_PROPRIETOR`, about 1,000 texts/day to T-Mobile. Name and website may not contain LLC,
  Inc, Ltd, Corp, Company or LLP.
- `vertical` has no cleaning value. `PROFESSIONAL` is the default; the owner can change it.
- One brand per EIN. `identityStatus` (`VERIFIED`, `VETTED_VERIFIED`, `UNVERIFIED`, `SELF_DECLARED`) and
  `status` (`OK`, `REGISTRATION_PENDING`, `REGISTRATION_FAILED`) are read separately. A brand can be
  fixed with `PUT /brand/{id}` and revetted.

**Campaign** (`POST /v2/10dlc/campaignBuilder`):
- `usecase`, `subUsecases` (MIXED: 2–5), `description`, `messageFlow` (40–2048 characters), `sample1–5`
  (at least one per sub use case, 3+ is safe), `helpMessage`, `optinMessage`, `optoutMessage`, keywords,
  `privacyPolicyLink`, `termsAndConditionsLink`, flags, `webhookURL`, `referenceId` (unique).
- One number belongs to one campaign. One campaign can cover operational and marketing messages under
  `MIXED` or `LOW_VOLUME` **if the opt-in names every kind of message**.
- Lifecycle is `campaignStatus`: `TCR_PENDING → TCR_ACCEPTED → TELNYX_ACCEPTED → MNO_PENDING →
  MNO_PROVISIONED` (live), with `TCR_FAILED`, `TELNYX_FAILED`, `MNO_REJECTED`, `MNO_PROVISIONING_FAILED`,
  `TCR_SUSPENDED`, `TCR_EXPIRED`. `status: ACTIVE` does **not** mean approved.
- Content fix: `PUT /10dlc/campaign/{id}`. External fix (for example the website): `POST
  /10dlc/campaign/{id}/appeal` from `TELNYX_FAILED` or `MNO_REJECTED`.

**Opt-in, privacy, terms** (compliance guide):
- The call to action names the brand and every kind of message, says message frequency varies, "Msg &
  data rates may apply", Reply STOP to opt out, Reply HELP for help, and links the terms and privacy
  policy. It must be at a public URL (or a screenshot for gated pages).
- The SMS checkbox is unchecked, optional, separate from accepting other terms, and labelled for texts.
- The privacy policy is the brand's own and says mobile information is not sold or shared with third
  parties for marketing. The terms give the program name and description, support contact, rates,
  frequency and opt-out.
- Common rejections: brand, website and samples do not match; pre-checked or required checkbox; missing
  disclosures; dead policy links.

**Number** (`POST /v2/number_orders`): `phone_numbers`, `messaging_profile_id`, `customer_reference`.
Status `pending | success | failure` (also `cancelled`, `deleted`). No idempotency header: look the order
up by `customer_reference` before ordering again. A search does not reserve anything.

**Assignment** (`POST /v2/10dlc/phone_number_campaigns`): the number must already be on a messaging
profile. `assignmentStatus`: `PENDING_ASSIGNMENT`, `ASSIGNED`, `FAILED_ASSIGNMENT`, … It can stay pending
for days after the campaign is approved (AT&T: 3–7 business days).

**Webhooks**: `10dlc.brand.update`, `10dlc.campaign.update`, `10dlc.phone_number.update`, sent to the
brand's and campaign's `webhookURL`, signed with Ed25519 like message webhooks
(`telnyx-signature-ed25519`, `telnyx-timestamp`), retried 5 times, deduplicated on `data.id`. Payloads come
enveloped (`data.payload`) or flat; both are read.

**Platform shape** (ISVs and 10DLC): one brand and one campaign per end customer under the platform's
account, numbers never shared across brands. Telnyx is the CSP for brands created through its API.
A messaging profile per customer is used in Telnyx's migration example but is not required.
**Decision:** keep the one platform messaging profile (`TELNYX_MESSAGING_PROFILE_ID`). Each company has
its own number, brand and campaign; inbound already routes by number. Per-company profiles would add
per-company spend limits and can be introduced later without touching registrations.

**Toll-free** is a separate verification flow, and number transfer (porting) is a separate journey.
Neither is offered as an option in this flow.

## 4. Fees

**Decision (owner, 2026-11-19): fixed retail fees.** Owners see Selestial's prices from
`convex/lib/texting/prices.ts` (versioned, `reg-2026-11`), never Telnyx's: $19 setup when the
registration is filed with the carriers, $15 each time a corrected registration is filed, and $10 a
month while the registration is active, starting the day texting is ready. These sit beside the
existing $3/month number fee and per-message rates on the messaging rate card.

**Telnyx's charges to Selestial (not shown to owners)**

From Telnyx's 10DLC fees article (TCR fees as of 2025-07-22): brand registration $4.50 once; campaign
review $15 per submission, including resubmissions; campaign monthly $10 (standard and MIXED), $1.50 (Low
Volume Mixed), $2 (sole proprietor), first three months billed together at approval; optional vetting
$41.50. Owners see only Selestial's customer prices, which live in the billing config (§5, step 5).

## 5. The plan

### Route and entry points
`/app/texting`, inside the workspace shell. Every entry point opens it on the saved step:
Settings › Privacy & messaging (replaces the inline form), the integrations card, agent readiness gaps,
agent permission notices, Sales inquiry checks, the Messaging money tab, and onboarding's "Your first
work" checklist.

Desktop: left step list, centre form card, right assistant panel, sticky Back / Continue / Save and exit.
Mobile: one column, compact progress, the assistant collapses into an expandable panel.

### Data
- `textingSetups` (one per company): step, business fields with their source and whether the owner
  confirmed each, entity type, the tax ID **sealed** (AES-GCM, `MAILBOX_TOKEN_KEY`, bound to the company)
  with only the last four shown, activities, where permission is collected, editable drafts, hosting
  choice and URL checks, the chosen number, assistant notes, revision.
- `textingPages`: versioned, published company pages (privacy, texting terms, sign-up). Never edited:
  a change is a new version. Served on the link host at `/b/<handle>/legal/privacy`,
  `/b/<handle>/legal/texting` and `/b/<handle>/texts` (the handle is the company's booking address;
  `legal` and `texts` become reserved page names).
- `textingSubmissions`: an immutable snapshot of each submission (version, business without the tax ID,
  activities, page versions, drafts, number, authorization).
- `textingRequests` gains `setupId`, `submissionVersion`, `entityType`, `coverage` (the activities and
  use cases filed), `taxIdSealed`/`taxIdLast4` (no plain EIN on new rows), `orderReference`,
  `campaignReference`, `milestones`, `correction`.
- `telnyxEvents`: verified 10DLC callbacks, deduplicated on event id.

### Steps
1. **Your business.** Pre-filled from the compliance profile, onboarding facts, booking settings and the
   company record, each with its source. Customer-facing name vs legal name, entity type, EIN only when
   required, address, website, support contact. "I don't have an EIN" leads to the sole proprietor path
   (owner's name and mobile; a one-time code is texted to that mobile after Selestial review; 1 number;
   lower volume).
2. **What you'll send.** Activity cards by audience with previews. Operational and marketing kept apart.
   A recommended registration: one use case if everything is one kind, otherwise one mixed registration
   (Low Volume Mixed for smaller teams, standard Mixed for larger ones), with why and what it costs.
3. **Permission to text.** Where permission is collected; editable drafts of the SMS consent line,
   separate marketing consent, texting terms, privacy policy, HELP/STOP/START replies, opt-in description
   and samples, all generated from the business's own details; a live form preview; publish to hosted
   pages or install on the company's own site, with URL checks; per-item state (drafted, published,
   needs attention). The hosted sign-up page records consent with wording version, source, time,
   recipient and scope.
4. **Your number.** Area-code search, cards with location, capabilities as Telnyx returned them and the
   customer monthly price; nearby suggestions when an area code is empty. Choosing holds nothing; the
   number is re-checked before purchase and never swapped silently.
5. **Review & submit.** Editable summary, charges from billing config, when each begins, what is still
   owed after a rejection, explicit authorization, then "Selestial review".
6. **Getting you ready.** Milestones: Submitted to Selestial, Business verification, Messaging review,
   Number purchase, Number connection, Ready to text — each with status, last update, next step and
   whether the owner must act. Corrections keep everything already filled in.

### Sending
`checkSend` gains `not_registered`: an SMS is allowed only when the company's active registration covers
the activity's audience and category (customer operational, customer marketing, cleaner operational,
applicant recruiting). STOP/HELP/START replies are always allowed on an active number. Existing approved
profiles without coverage keep their current behaviour (operational texts to cleaners), so nothing that
works today stops.

## 6. Preserving what exists
- Rows in `textingRequests` without the new fields keep provisioning exactly as before (`entityType`
  defaults to `PRIVATE_PROFIT`, coverage defaults to cleaner operational).
- A profile already approved by staff through the manual "record your registration" path keeps texting;
  its coverage is the legacy default until the company runs the new setup.
- The plain `brand.ein` field stays readable for old rows and is not written on new ones.

## 7. Deployment dependencies (so far)
- `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_WEBHOOK_URL` on the
  backend (names only).
- `MAILBOX_TOKEN_KEY` (already used for mailbox tokens) seals tax IDs.
- `LINK_ORIGIN` for hosted pages; `PUBLIC_FORM_SECRET` for the hosted sign-up form.
- The Telnyx key held by this development environment is rejected by Telnyx; live reads were not
  possible from here.
