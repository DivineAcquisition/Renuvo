# Business texting: what's built, how it's verified, and what deployment needs

Companion to `00-audit.md`. Checked 2026-11-19 against the branch `claude/company-finances-workspace-5zu4io`.

## What an owner gets

`/app/texting`, "Set up business texting", opened from Settings › Privacy & messaging, the
Integrations card, agent pages, onboarding readiness and Sales checks. Six steps, saved as they go:

| Step | What it does |
|---|---|
| Your business | Prefilled from the profile, onboarding, booking page and account, each with its source. Kind of business (company, sole proprietor, non-profit, public). EIN sealed, last four shown. |
| What you'll send | Activities by audience and content, with samples. Promotions kept apart. One recommended registration (single use case, Mixed, or sole proprietor) with why. |
| Permission to text | Where people agree, with whether Selestial records consent there today. Editable drafts of consent, marketing consent, HELP/STOP/START replies, privacy policy, texting terms and opt-in description, each checked for what carriers require. Publish to company pages; links are opened and checked. Embed path for the company's own site. |
| Your number | Area-code search, real capabilities and the customer price. Nearby numbers in the same state when an area code is empty. Nothing is held. |
| Review & submit | Editable summary, every charge with when it starts and what happens on rejection, explicit authorization in exact words, then Selestial review. |
| Getting you ready | Six milestones read from the request, each with status, last update, next step and whether the owner must act. Code entry for sole proprietors, corrections that keep everything, per-agent readiness once live. |

Company pages, on the link host under the company's booking address:
`/b/<handle>/legal/privacy`, `/b/<handle>/legal/texting`, `/b/<handle>/texts` (`?embed=1` for an iframe).
Rendered on the server so carriers' reviewers see the full text.

## How it's verified

`convex/texting.test.ts` (16 tests) and `convex/booking.test.ts` (text consent on the booking page), with
Telnyx faked as a stateful API. No live number is bought and no registration is filed by any test.

| Scenario from the brief | Test |
|---|---|
| Refresh/resume | "opens one saved setup…" (same setup from every open, stale revision refused) |
| Unavailable numbers | "asks the owner to choose again when the chosen number was taken" |
| Rejection and correction | "asks for a correction in plain words…" (fields named, answers kept, only the brand refiled, fee once) |
| Duplicate submission | "files nothing until Selestial review approves…" (second submit refused) |
| Uncertain purchase outcomes | "finds a number order whose answer was lost" (one POST, found by customer reference) |
| Concurrency | "runs one provisioning pass at a time" (lease) |
| Delayed assignment | "keeps texts waiting while the number connection is pending" |
| Cross-company isolation | "keeps each company's setup, searches and requests to itself" |
| Opt-outs | "keeps a STOP in force across agents and after the texting number changes" |
| Depleted balance | correction test: $1.00 balance, fees post below zero, texting still ready |
| Agent restrictions | "stops texts that the registration doesn't cover…", "tells each agent exactly what it can text…" |
| Sole proprietor | "confirms a sole proprietor with the carriers' one-time code" |
| Callbacks | "acts on a signed 10DLC callback once, and only as a hint" |

Visual checks (temporary local preview, real data from the backend tests): desktop 1440, tablet 1024 and
phone 390 for every step and the correction and connecting states. Phone overflow was found and fixed.

## Deployment dependencies

Environment variables on the Convex backend (names only):

| Name | Needed for | Notes |
|---|---|---|
| `TELNYX_API_KEY` | every Telnyx call | Already used. The key held by the Claude development environment is rejected by Telnyx (401); the backend's own key was not checked from here. |
| `TELNYX_PUBLIC_KEY` | verifying callbacks (Ed25519) | Already used for message webhooks; 10DLC callbacks use the same signature. |
| `TELNYX_MESSAGING_PROFILE_ID` | number orders | Numbers are ordered onto this one platform profile. |
| `TELNYX_WEBHOOK_URL` (or `CONVEX_SITE_URL`) | brand and campaign `webhookURL` | Brands and campaigns are now filed with the callback address. |
| `MAILBOX_TOKEN_KEY` | sealing EINs | Already set where Gmail connections work. Without it, saving an EIN is refused, nothing is stored in the clear. |
| `LINK_ORIGIN` | company page addresses | Already used for `/c` links. |
| `PUBLIC_FORM_SECRET` | the hosted sign-up form | Already used by booking pages. Also needed by the Next.js app (Vercel). |
| `MESSAGING_BILLING=on` | charging the fees | Off by default; with it off, authorizations are recorded and nothing is charged. |

Scheduled jobs added (`convex/crons.ts`): reconcile quiet registrations every 30 minutes; check active
registrations daily for suspension. The existing 6-hourly fee job now also charges the monthly registration fee.

Before the first real company:
1. Confirm the backend's `TELNYX_API_KEY` works (a GET on `/v2/10dlc/brand`). The development
   environment's copy is rejected and should be replaced in that environment's network secrets.
2. Optional: file one Telnyx `mock: true` brand from staff tooling to see live response shapes. The client
   reads both bare and `data`-wrapped responses, but this was not observed live.
3. Staff: approve requests from the Texting page of the staff console ("Selestial review"). Raw provider
   states are shown there only.

## Known limits

- Hosted policies are drafts written from the company's details, not legal advice; the screen says so.
- A person who agrees on the booking page while matched to an existing customer by email is not recorded
  (the same rule booking already uses for email: whoever typed the address may not own the record).
- Low Volume Mixed is not offered; standard registrations are recommended so a growing company never has to
  re-register. Telnyx's cost is higher ($10 vs $1.50 a month) and is covered by the $10 retail fee.
- Toll-free verification and number transfer are separate journeys and are not offered here.
- Messaging profiles stay platform-wide; per-company profiles can be added later without re-registering.
