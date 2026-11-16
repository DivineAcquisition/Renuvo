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

REGISTER_TABLES

## Launch readiness

LAUNCH_READINESS

## Unresolved decisions

UNRESOLVED
