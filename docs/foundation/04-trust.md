# Trust, privacy and compliance support

What Selestial tells the public about privacy and security, how it backs each statement, how
consent and opt-outs are enforced, and what still needs a person, a provider or a decision outside
this repository.

This is compliance support, not a certification. Nothing here says Selestial meets every law in every
place. The service is offered to cleaning businesses in the United States and Canada.

## Three layers, three owners

| Layer | Who is responsible | Examples |
|---|---|---|
| Platform | Selestial (Divine Agency LLC) | Accounts, separation between companies, staff access, providers, the public documents, the request queues |
| Cleaning company | The business using Selestial | Its legal identity, its texting registration, what its agents may do, the consent wording it shows, accepting the Terms |
| Recipient | The customer, cleaner or applicant | Their permission to be contacted, STOP / HELP / START, cookie choices on the public site |

Selestial processes a cleaning company's records for that company. Requests from a company's customers,
cleaners or applicants are routed to that company to decide, and Selestial helps it answer.

## Public pages

| Page | Address | Built from |
|---|---|---|
| Security overview | `/security` | `src/lib/trust/documents/security.ts` plus the verified, public claims in the trust record |
| Subprocessors | `/security/subprocessors` | Provider rows in the trust record (`in_use` or `connected_not_live` only) |
| Report a vulnerability | `/security/report` | Form → `requests.submit` (kind `vulnerability`) |
| Ask a security question | `/security/review` | Form → `requests.submit` (kind `security_review`) |
| Privacy notice | `/privacy` | `src/lib/trust/documents/privacy.ts` |
| Privacy requests | `/privacy/requests` | Form → `requests.submit` (kind `privacy`) |
| Terms of Service | `/terms` | `src/lib/trust/documents/terms.ts` |
| Cookie notice | `/cookies` | `src/lib/trust/documents/cookies.ts` plus the live state of each tracking tool |
| Messaging practices | `/messaging` | `src/lib/trust/documents/messaging.ts` |
| security.txt | `/.well-known/security.txt` | The verified security contact; 404 while it is unverified or expired |
| Landing page trust section | `/#trust` | Claims in the areas permissions, access, audit and messaging; a card shows only when its claim is verified and public |

Footer: a Trust group (Security, Subprocessors, Report a vulnerability, Security review) and a Legal &
Privacy group (Privacy, Terms, Cookies, Cookie preferences, Data requests, Messaging practices, Contact).

### How a statement reaches the site

1. The words of each document live in code, one file per document, with a version id
   (`convex/lib/trust/documents.ts`). A new version is a new id; old ids stay so acceptances point at the
   exact words.
2. Whether a version is shown is a row in the record (`policyPublications`). A version with no
   `published` row shows "Being finalized" instead of its text.
3. Operator details, contacts, providers and claims are rows in the record (`trustSettings`,
   `trustProviders`, `trustClaims`). The site reads them through `trust.publicSnapshot`, which goes
   through one filter (`publicView` in `convex/lib/trust/seed.ts`): a contact only when verified, a
   provider only when in use or set up, a claim only when it is both `implemented_verified` and marked
   public. Evidence, agreements, notes and review state never leave.
4. If the record cannot be reached, the site uses the same seed through the same filter.
5. Only staff admins change these rows. Each change needs a note and is logged with before and after
   (`trustChanges`), visible in the staff console.

The five documents (version `*-2026-11-16`) are published on the owner's approval of 2026-11-16, with
no outside legal review. That is recorded on each publication row.

## Cookies and tracking

- One cookie holds the choice: `selestial_consent` (version, analytics, advertising, time, GPC). Version
  1, kept 365 days, then asked again. A new version asks again.
- Nothing optional loads before a choice. Accept, Reject and Manage carry equal weight. Closing the
  banner is not a choice: it hides it for the tab only.
- A Global Privacy Control signal turns advertising off, even if everything is accepted. Analytics
  stays off under GPC unless chosen with the signal on.
- Tools: Vercel Analytics (analytics), Google Analytics 4 (analytics), Google Ads conversions and Meta
  Pixel (advertising). Each loads only when its ID is set (`NEXT_PUBLIC_VERCEL_ANALYTICS`,
  `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_GOOGLE_ADS_ID`, `NEXT_PUBLIC_META_PIXEL_ID`). None is set today.
- Tools run only on the public marketing pages (`src/lib/consent/pages.ts`). Never in the workspace,
  sign-in, request forms, task links (`/c/...`), invitations, or any address carrying a token. They are
  told the path only, never the query string.
- Withdrawing clears the optional cookies and reloads, so nothing keeps running.
- Server-side events use `serverEventAllowed` (`src/lib/consent/server.ts`), which reads the same cookie
  and the `Sec-GPC` header.

## Messaging consent and the sending policy

One check, `checkSend` (`convex/lib/messaging/policy.ts`), runs when a message is planned and again at
the moment it is handed to the provider. In order, the first failure answers:

| Code | Meaning |
|---|---|
| `company_suspended` | Selestial suspended this company's sending |
| `agent_paused` | The sending agent is paused (a person can still send) |
| `sender_not_ready` | Sender name, number, email address or carrier registration missing |
| `no_address` | No usable address on this channel |
| `suppressed` | The address opted out (STOP, unsubscribe, or a manual block) |
| `no_permission` | No recorded permission for this channel and category (work, marketing, recruiting) |
| `quiet_hours` | Inside the company's quiet hours; can go when they end |
| `frequency` | The weekly limit for this person and category is reached |

- Permissions are records per person, channel and category, pointing at the exact consent wording
  version they saw (`consentDisclosures`). Imported permissions do not count for texting.
- Opt-outs are kept by address, not by provider, so switching providers cannot route around one.
- Inbound texts (`convex/inbound.ts`): STOP and its synonyms, HELP, START, and plain-language opt-outs
  ("stop texting me", "unsubscribe") are honoured. A STOP that arrives after a message was planned still
  stops it, because the check runs again at sending time.
- Dispatch sends only through this policy. The Recruiter (PR #77) has been asked to adopt it.

## Settings → Trust & Compliance

`/app/settings/compliance`. Readiness per operation, each with its own blockers and a link to fix
them: Ready for SMS, Ready for email, Agents can send, Contact permissions on file, Terms accepted,
Business details complete. A gap blocks only the operation it affects. Then: business identity,
messaging (sender, number, from-address, quiet hours, weekly limits), carrier registration (the Owner
records "submitted"; only staff mark it approved or rejected), consent wording versions, agent authority,
data (export, erase a customer or cleaner, ask for the company to be deleted), and agreements.

The Terms are accepted at workspace setup (in the same transaction as the company) and again from
`/app/settings/agreements` when a new version is in force.

## Requests and data rights

- Public forms save the request first, then tell Selestial's inbox, retrying up to five times. The
  person sees "Received" with a reference only after the record saved it. Rate limits per visitor
  (hashed), per email (hashed) and overall. A hidden field drops bots without telling them.
- Nothing is exported or deleted from a public form. A person verifies identity, routes the request
  to the business or keeps it, and closes it with an outcome and any limitation.
- A vulnerability report needs no business name and no marketing consent.
- The Owner can download a full export (link valid 24 hours, three a day), erase a customer's or
  cleaner's details (typed confirmation; refused while they have open visits), and ask for the whole
  company to be deleted, which becomes a privacy request for staff.

## Staff

Selestial staff are rows in the record (`staff`), roles `admin` and `reviewer`, separate from any
company membership; being staff gives no access to company records. `STAFF_BOOTSTRAP_EMAIL` makes one
confirmed email an admin only while no active admin exists. The console is `/staff` (requests, trust
records, companies, staff); to anyone else it reads "Not found.".

## Control and disclosure register

The full register with evidence is `src/lib/trust/register.ts`. Statuses: **verified** (built and
proven by a test or check here), **unverified** (built, not yet proven live), **planned**, **external**
(needs a provider, carrier or dashboard), **decision** (needs a legal or business decision).

#### Platform

| Item | Responsible | Provider | Status | Public | Evidence |
|---|---|---|---|---|---|
| Accounts and sign-in | Selestial | Clerk | verified | yes | src/components/auth/*, tests/e2e/auth.mjs (33 browser checks), docs/foundation/03-authentication.md |
| Business records are separated by workspace | Selestial | Convex | verified | yes | convex/lib/builders.ts, convex/lib/access.ts, convex/isolation.test.ts, convex/guard.test.ts |
| Roles: Owner, Manager, Office | Selestial | — | verified | yes | convex/lib/roles.ts, convex/isolation.test.ts |
| Activity log | Selestial | Convex | verified | yes | convex/lib/events.ts, convex/lib/guard.ts (eventLogViolations), convex/guard.test.ts |
| Selestial staff access | Selestial | — | verified | no | convex/lib/builders.ts (staffQuery/staffMutation), convex/staff.test.ts |
| Website hosting and request logs | Provider | Vercel | external | yes | Vercel project; provider's own terms |
| Database and file storage | Provider | Convex | verified | yes | convex/schema.ts |
| Where providers process data | Selestial | Clerk, Convex, Vercel | external | no | Needs each provider's region settings and data processing terms checked. |
| Data processing terms with providers and customers | Selestial | — | decision | no | — |
| Encryption at rest and in transit | Provider | Convex, Vercel, Clerk | external | no | Needs each provider's security documentation reviewed and recorded. |
| Backups and restoration | Provider | Convex | external | no | — |
| Second factor for Selestial staff | Selestial | Clerk | planned | no | — |
| Security certification (SOC 2, ISO 27001) | Selestial | — | decision | no | — |
| Independent security assessment | Selestial | — | decision | no | — |
| Personal information is not sold | Selestial | — | decision | no | Privacy notice privacy-2026-11-16, approved by the owner 2026-11-16 |
| Privacy and security requests | Selestial | — | verified | yes | convex/requests.ts, convex/requests.test.ts, src/lib/trust/requests.test.ts, tests/e2e/trust.mjs (a privacy request and a vulnerability report saved from a real browser) |
| Export and deletion | Cleaning company | Convex | verified | no | convex/dataRights.ts, convex/dataRights.test.ts (every company table is exported or left out with a reason). Not tested on a very large company. |
| Selestial subscription charges | Selestial | — | decision | yes | No payment code in the repository. |
| Customer payments to cleaning businesses and cleaner pay | Cleaning company | — | planned | yes | convex/lib/dispatch/pay.ts |
| AI model providers | Selestial | — | planned | yes | convex/lib/dispatch/*, PR #77 convex/lib/recruiter/model.ts |
| Model training on customer data | Selestial | — | decision | no | — |
| Use of business records across companies | Selestial | — | decision | no | — |

#### Cleaning company

| Item | Responsible | Provider | Status | Public | Evidence |
|---|---|---|---|---|---|
| Business identity | Cleaning company | — | verified | no | convex/compliance.ts, convex/compliance.test.ts |
| What each agent may do | Cleaning company | — | verified | yes | convex/lib/permissionCatalog.ts, convex/authority.test.ts |
| Texting sender and carrier registration | Cleaning company | Telnyx (planned) | external | no | convex/lib/messaging/policy.ts and tests |
| Terms acceptance | Cleaning company | — | verified | no | convex/agreements.ts, convex/companies.ts (accepted in the same transaction as the company), convex/compliance.test.ts |

#### Recipient

| Item | Responsible | Provider | Status | Public | Evidence |
|---|---|---|---|---|---|
| Permission to message, per person, channel and category | Cleaning company | — | verified | no | convex/consent.ts, convex/compliance.test.ts |
| One server-side check before every text | Selestial | — | verified | yes | convex/lib/messaging/policy.ts, convex/messaging.ts (checked again in claim), convex/compliance.test.ts, the Dispatch tests |
| STOP, HELP, START and plain-language opt-outs | Selestial | Telnyx (planned) | external | no | convex/inbound.ts, convex/compliance.test.ts |
| Cookie and tracking choices | Selestial | Vercel Analytics, Google Analytics 4, Google Ads, Meta Pixel (none switched on) | verified | yes | src/lib/consent/*, src/components/consent/*, src/lib/consent/consent.test.ts, tests/e2e/trust.mjs (14 browser checks with fake tool ids and every tracker request intercepted) |
| Cleaner task links | Selestial | — | verified | no | convex/lib/dispatch/links.ts, convex/linkAudit.test.ts (11 checks) |
| Recruiter inbox and applicant records | Cleaning company | Gmail (planned) | external | no | PR #77 |

## Launch readiness

Checked on 2026-11-16 on branch `claude/selestial-trust`: eslint, both type checks, 293 unit and
record tests, the production build, and `tests/e2e/trust.mjs` (14 browser checks against the dev
record, with fake tool ids and every tracker request intercepted). Nothing was deployed to
production and no tracking tool is switched on.

### Ready in this repository

- The ten public pages, the footer groups and the landing trust section (three cards today:
  permissions, access, audit; the messaging card waits for its claim to be verified and public).
- The five documents, version `*-2026-11-16`, published on the owner's approval with no outside legal
  review, recorded on each publication row.
- Cookie choices: banner, preferences, withdrawal, GPC, versioning and expiry; tools load only after a
  choice, only on public pages, and are told the path only.
- Public request forms that save before anyone is told, with references, rate limits and a bot trap;
  the staff queue with verification, routing, due dates, notes and outcomes.
- Settings → Trust & Compliance with per-operation readiness; Terms accepted at workspace setup.
- One sending policy, checked at queueing and again at sending, wired into Dispatch.
- Owner export (24-hour link), erasure of a customer or cleaner, and company deletion through staff.
- The staff console (`/staff`): requests, operator details and contacts, providers, claims,
  publications, change log, carrier registrations and suspensions, staff list.

### Needs a person or a provider before launch

1. **Production record.** Deploy the Convex functions to production, run `npx convex run trust:seed`
   there once, set `STAFF_BOOTSTRAP_EMAIL`, sign in with that address and add the real staff. Until the
   seed runs, the site shows the same seed facts.
2. **Request notifications.** `EMAIL_PROVIDER`, `RESEND_API_KEY` and `EMAIL_FROM` on Convex, and working
   privacy@ and security@selestial.io mailboxes. Without them a request is still saved and visible in
   `/staff`, and its "our inbox told" line says why the email did not go.
3. **Tracking tools.** Each turns on only when its id is set on Vercel (`NEXT_PUBLIC_VERCEL_ANALYTICS`,
   `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_GOOGLE_ADS_ID`, `NEXT_PUBLIC_META_PIXEL_ID`). Then mark each one
   in use on the Subprocessors list.
4. **Providers.** Check where Clerk, Convex, Vercel and Resend process data, their data processing
   terms, encryption and backups, and record each in the staff console. The Subprocessors page says
   "not yet verified" until then.
5. **Texting.** A Telnyx account and number, carrier registration for each company (US 10DLC; Canadian
   carrier requirements), and a web route for inbound texts, which is **not built**: STOP handling is
   tested in the record but does not yet run on real texts.
6. **Sign-in service dashboard.** The development instance still requires a phone number and username at
   sign-up (see `03-authentication.md`), and staff second-factor sign-in is not enforced.
7. **security.txt** expires 2027-11-15. Renew it in the staff console before then.

### Known gaps in the code

- An offer the sending policy refuses stays open until its deadline, then expires as if the cleaner were
  silent. Sent to the Dispatch session to change.
- The Recruiter (PR #77) does not use the sending policy yet, and applicants are not yet recipients the
  consent records can find. Sent to the Recruiter session.
- Finding the company and person for an inbound text scans up to 2,000 rows per status: there is no
  index on phone or email. Fine now; needs an index before volume.
- The export builds the whole file in memory. Not tested on a very large company.
- The staff console has not been driven in a browser yet (it is covered by type checks and the record
  tests behind each function).

## Unresolved decisions

Each of these needs the owner's answer. Nothing here was guessed into the documents or the site.

1. **Messaging claim.** Show "Texts go out only after checking…" on the site once texting is live, or now?
   (The check is built and tested; texting itself is not live.)
2. **AI claim.** Show "No AI model provider is connected…" in public? It is true today and changes the
   day the Recruiter connects a model.
3. **Model training and cross-company use.** What will Selestial say about training models on, or
   learning across, companies' records?
4. **"Does not sell personal information."** The Privacy notice says it; should it also appear as a
   claim on the Security page?
5. **Retention.** How long records, requests, exports and deletion records are kept. Nothing is stated.
6. **Data processing terms** for cleaning companies, and with each provider.
7. **Billing.** Price, billing cycle, cancellation and refunds (the Terms say they will be shown before
   any fee).
8. **Service levels.** Availability, support hours and response times. None promised.
9. **Researchers.** Offer a safe-harbour statement for good-faith security research? Not offered today.
10. **Assessment.** Whether and when to get an independent security test or a certification.
11. **Messaging defaults.** Quiet hours 21:00–08:00 with work texts excluded, and a shared number needing
    every person's permission: keep both?
12. **Human-only actions.** List in the Security overview and Terms the actions that always need a person
    (consequences for a cleaner, decisions after a background check, pay runs, price and policy changes)?
13. **Terms additions to confirm:** companies must tell cleaners what is recorded (check-ins, location,
    photos), and features may stop if a provider stops a service.
