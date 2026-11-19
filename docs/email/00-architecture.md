# Email and notifications: audit and architecture

Phase 1 of the email build. It records what exists today and which system owns each email, then lays out
how the rest gets built on top of what is already here. Nothing in this document replaces the shared
outbox (`messages`), the sending policy (`checkSend`) or the compliance records. Everything below extends
them.

Checked on 2026-11-18, against `main` at 6cc37d9, the live backend (terrific-avocet-835), Resend and public DNS.

## 1. What exists today

### Every path that sends

| # | Path | To | Sender actually used | Template | Outbox + policy | Delivery status |
|---|---|---|---|---|---|---|
| 1 | Member invitation (`invitations.ts:deliver`) | Invitee | `EMAIL_FROM` (mail.selestial.io) | Old `emailLayout` | No (state kept on the invitation) | None |
| 2 | Trust request (`requests.ts:notify`) | Selestial staff | `EMAIL_FROM` | Old `emailLayout`, no button | No | None |
| 3 | Sign-in codes, password and email changes, new device, lockout | Member | **Clerk** | Selestial-designed, installed by `scripts/auth-emails.mjs` | n/a | Clerk |
| 4 | Dispatch texts (offer, reminder, nudge…) | Cleaner | Company number via Telnyx | `lib/dispatch/sms.ts` | Yes / yes | Telnyx webhook |
| 5 | Applicant email (invite, decline, offer, follow-ups) | Applicant | Company Gmail if connected, otherwise `RECRUITER_EMAIL_FROM` as "{Company} Hiring Team" | `plainHtml` | Yes / yes | Resend only |
| 6 | Cleaner portal invite, sign-in code, follow-ups | Cleaner | Shared sender, **no Reply-To** | `plainHtml` | Yes / yes | Resend |
| 7 | Earnings statement | Cleaner | Shared sender, Reply-To = the member | `plainHtml` | Yes / yes | Resend |
| 8 | Invoice and payment reminder | Customer | Gmail or shared; Reply-To from finance settings | `plainHtml` | Yes / yes | Resend only |
| 9 | Client conversation | Customer / contact | Shared only | `plainHtml` | Yes / yes | Resend |
| 10 | Booking confirmation, request received, recovery | Customer | Gmail or shared | `plainHtml` (recovery adds unsubscribe and address) | Yes / yes | Resend only |
| 11 | Sales replies, quotes, proposals, signature requests, booking confirmed | Customer / prospect / signer | Gmail or shared; Reply-To is the signed `r-…@reply` address only when an opportunity is attached | `plainHtml` | Yes / yes | Resend only |
| 12 | Card payment receipt | Customer | **The company's Stripe account** (`receipt_email`) | Stripe's | No | Stripe |
| 13 | Hiring agreement envelope | Applicant | e-sign provider | — | No | **Mock only** |

What this table shows:

- **No email ever goes to an Owner or a team member about anything that happens.** Approvals, Dispatch
  escalations, billing notices and disconnected inboxes exist only as in-app tasks, the approvals queue,
  or notices on the billing screen. There are no notification preferences, no digest, and no member
  recipient anywhere.
- Every outbox email goes through `lib/messaging/email.ts`. It forces `fromAddress = RECRUITER_EMAIL_FROM`
  and `html = plainHtml(text)` for all mail, not just applicant mail. A company's invoices, bookings and
  portal invites therefore leave as unbranded plain text from the hiring sender.
- Platform mail (invitation, trust request, Clerk) uses the older `emailLayout`. Company mail uses
  `plainHtml`. Neither has a logo, dark mode or a mobile layout.

### Delivery and suppression

- The Resend webhook signature is checked properly: Svix HMAC over the raw body, a 5-minute window, and
  several `v1` signatures accepted. Retries are deduplicated by `svix-id` through `providerReceipts`.
- **Complaints are recorded as bounces** (`lib/messaging/resend.ts:65`). Bounce, complaint and failure are
  not kept apart.
- Updates only apply to messages that are `sent` or `unconfirmed`, so a complaint that arrives after
  `email.delivered` is ignored.
- A bounce adds a suppression only for applicant mail. The suppression reason `complaint` is never
  written, and `email.suppressed` (Resend's own suppression list) isn't handled.
- No email carries a `List-Unsubscribe` header. Only booking recovery has an unsubscribe link.
  `inbound.emailUnsubscribe` exists, but only tests call it.
- If a message is planned for Gmail and the mailbox disconnects before sending, it goes out through Resend
  while `provider` still says `"gmail"`. Its delivery webhook then can't find it.
- A `verification_code` message that is held or retried is rescheduled without its code
  (`messaging.ts:69`, `:219`). It would go out with a literal `{code}`.

### Connected Gmail (Recruiter only today)

**What is solid:**
- OAuth `state` is hashed and single-use.
- Tokens are sealed with AES-256-GCM (`MAILBOX_TOKEN_KEY`).
- Pub/Sub push is checked by JWT.
- Sync is incremental from a history cursor.

**Gaps:**
- Disconnect doesn't revoke the Google grant, and revoking it can't be done safely while two features
  share one grant.
- A Gmail 403 is treated as an authentication failure.
- There is no lock around token refresh.
- The watch is renewed only by the daily cron and isn't started at connect.
- There is no index by address.
- Pub/Sub signing keys aren't cached.
- **Sends carry no `In-Reply-To`, `References` or `threadId`**, so replies don't land in the thread.
- A Gmail 5xx can lead to a resend.
- The "can this mailbox send" lookup is copied in five places.
- Booking messages marked "gmail" actually go through Resend.
- An expired inbox still shows "ready".
- The integrations screen has a label bug (`integrations.tsx:44`).
- There are no purpose or agent fields, and unrelated mail is thrown away.
- Google verification is still needed: `gmail.readonly` is a restricted scope and `gmail.send` a sensitive one.

### Settings

- There is no Notifications page and no per-member preference table.
- Members have no time zone of their own, so the company's zone is used.
- Brand data already exists: the booking profile has the logo and `brandColor`, and compliance messaging
  has `senderName`. `emailFromAddress` exists but is only used as a gate.
- Microsoft Outlook and OneDrive cards are already listed as `planned` in `src/lib/app/integrations.ts`.

## 2. Three kinds of email

| Kind | Who it's from | Looks like | Sent by |
|---|---|---|---|
| **Platform notification** | Selestial, to the people who use it | Selestial header, violet action, footer with the reason and settings | Resend, `notify.selestial.io` |
| **Company communication** | A cleaning company, to its customers, applicants or cleaners | The company's logo and accent; footer says "sent via Selestial" | Resend, `mail.selestial.io`, under the company's name |
| **Connected-inbox conversation** | A person at the company, from their own Gmail | Plain, written like a person, short signature, no template, no branding | Gmail API, in the existing thread |

Rules that apply to all three:

1. **One route per message.** A message records its route (`gmail` or `resend`) when it is claimed. If
   that route isn't available at send time, the message waits and says why. It does not fall back to the
   other route quietly.
2. **One owner per event** (catalog below). Clerk owns sign-in mail, the company's Stripe owns card
   receipts, Google owns calendar invitations. Selestial doesn't send a second copy of any of these.
3. **A link never acts.** Every button opens a page where the person decides. Links use a signed, expiring,
   single-purpose token: the existing `actionLinks`, `applicantLinks` and `portalLinks`, plus the app's own
   pages behind sign-in.
4. **Only real facts.** Numbers, names and statuses come from the records at the moment of rendering. A
   missing value is left out, never guessed. Nothing claims delivery, revenue or activity that the records
   don't show.
5. **Essential notices cost nothing.** Sending a notification doesn't use AI credits. The weekly digest is
   built from counts, not written by a model.

## 3. Sender ownership map

| Identity | From | Reply-To | Used for | Domain status |
|---|---|---|---|---|
| Selestial | `Selestial <notify@notify.selestial.io>` | `PLATFORM_REPLY_TO` (a monitored Selestial inbox) or none | Every platform notification: welcome, security, approvals, escalations, digest, billing, inbox problems, member invitations | Verified |
| Company, via Selestial | `"{Company} via Selestial" <COMPANY_EMAIL_FROM>` (one configured address on `mail.selestial.io`) | Company's reply address, or a signed `r-…@reply.selestial.io` when the reply should come back into Selestial | Bookings, proposals, quotes, invoices, portal invites, statements, applicant mail when no Gmail is connected | Verified |
| Replies into Selestial | `r-{128-bit key}@reply.selestial.io` (receiving only) | — | Sales today; client and finance threads next | Verified; receiving MX present |
| Selestial marketing | `Selestial <news@updates.selestial.io>` | — | Product news, opt-in only, never mixed with notices | Verified (not used yet) |
| Auth | `auth.selestial.io` | — | **Not used.** Clerk keeps sending sign-in mail with Selestial's design. | Verified (kept for later) |
| Company's own Gmail | The connected address | Itself | Conversations in a real thread, by purpose (Sales, Hiring, Care, Operations) | Per company, OAuth |
| Company's own domain | — | — | Later: a company verifies its own domain in Resend | Not started |

Rules the sender registry (Phase 3) enforces:

- A From is **built** from a verified domain and a fixed pattern. It is never typed in or taken from a
  record. The display name is the company name, cut to one line, with "via Selestial" added.
- If a company's identity is incomplete (no name, a suspended company, the domain not configured), its
  mail is **held with a reason the Owner can read**. It is never sent from a different identity instead.
- Platform mail never uses a company identity, and company mail never uses `notify`.

## 4. Domains

Resend (checked through the API today): `selestial.io`, `mail`, `notify`, `updates`, `auth` and `reply`
are all **verified for sending**. Only `reply` has receiving turned on.

Each sending subdomain `<sub>` has these records, all present and verified:
- `resend._domainkey.<sub>`: TXT, the domain's own DKIM key (as shown in Resend).
- `send.<sub>`: CNAME `send.forge.rmta.net`.
- `rsend.<sub>`: CNAME `rsend.forge.rmta.net`.

On top of those, `reply.selestial.io` has MX 10 `receive.forge.rmta.net` (present).

The root `selestial.io` MX belongs to Google Workspace and must not change.

**Must fix: DMARC.** `_dmarc.selestial.io` publishes **two** TXT records (`v=DMARC1; p=none;` and
`v=DMARC1;p=none;`). When there is more than one record, receivers apply no DMARC policy at all. That
means `mail`, `updates` and `auth`, which inherit the root policy, currently have **no DMARC**. Gmail and
Yahoo require DMARC from bulk senders. The fix is at GoDaddy (DNS is on `domaincontrol.com`):

1. Delete both TXT records at `_dmarc`.
2. Add one: `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:dmarc@selestial.io; adkim=r; aspf=r`
   (use any mailbox you read for `rua`).
3. After two weeks of clean reports, move to `p=quarantine`.

`_dmarc.notify.selestial.io` has its own valid record and needs no change.

## 5. Event catalog

**Priority:**
- `critical`: sent at once, any hour.
- `high`: sent at once, inside the member's working hours, otherwise at the start of the next one.
- `normal`: sent at once and may be grouped within 10 minutes.
- `digest`: appears only in the weekly summary.

**Channels:**
- **In-app** always exists: the task, the approval and the record already appear in the product. Email is
  layered on top.
- No texts go to members until a member phone number and consent exist.

**Preference categories:**
- `security`: always on.
- `account`: always on for the Owner.
- `approvals`
- `escalations`
- `activity`
- `digest`
- `product`: opt-in marketing.

### Platform notifications (Selestial → members)

| Event | Trigger | Recipient | Template | Data used | Opens | Priority | Default | Category | Dedupe | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `welcome` | `company.created` | The new Owner | Welcome | Company name; setup steps from records | `/app` | normal | email | account | `welcome:{member}` | Selestial | Build now |
| `member_invited` | `member.invited` | The invitee | Invitation (rebuilt) | Company, inviter, role, expiry | `/invite/{token}` | high | email | — (transactional) | Existing per-link key | Selestial | Rebuild on kit |
| `security_change` | `member.role_changed`, `member.removed`, `mailbox.connected`, `stripe.updated` (payout account), `company.deletion_requested`, `export.ready` | Owner(s) and the affected member | Security | What changed, who, when | Record or settings page | critical | email | security | `security:{event id}` | Selestial | Build now |
| Sign-in, password, new device | Clerk | Member | Clerk template | — | — | — | — | — | — | **Clerk** | Keep in Clerk |
| `approval_needed` | `approval.requested` where the agent's authority is **Ask me first** | Members who can decide | Agent approval | Agent, what it wants, why, what approving authorizes, what happens if nobody decides, deadline | `/app/approvals?open={id}` (signed in) | high | email | approvals | `approval:{id}` | Selestial | Build now |
| `approval_expiring` | Approval still pending 2 h before `decideBy` | Same | Agent approval (reminder) | Same plus time left | Same | high | email | approvals | `approval-expiring:{id}` | Selestial | Build now |
| `agent_acted` | Agent action with authority **Act and notify me** | Members watching that agent | Activity recap (one email for up to 10 min of actions) | What was done, to which record, and how to undo it if possible | The record | normal | email | activity | `acted:{event id}`, grouped per member per 10 min | Selestial | Needs agents to write `agent.acted` events (Phase 5) |
| (authority **Act automatically**) | — | — | — | — | — | — | Digest only | digest | — | — | By design: no per-action email |
| `dispatch_escalation` | `assignment.no_check_in_alerted`, `assignment.no_show_suspected`, `dispatch.handed_back`, a coverage request unfilled within 2 h of start | Owner and office members | Dispatch escalation | Visit, customer, area, start time, cleaner, what Dispatch already tried, what's needed | `/app/dispatch?job={id}` | critical | email | escalations | `escalation:{assignment}:{kind}` | Selestial | Build now |
| `weekly_digest` | Monday 07:30 company time | Each member with the digest on | Weekly digest | Counts from records: visits done/cancelled, approvals decided/expired, invoices paid (sum), applicants, bookings; open decisions | `/app` | digest | email | digest | `digest:{member}:{ISO week}` | Selestial | Build now |
| `plan_payment_failed` | Autumn/Stripe subscription `past_due` (`billing.updated` with pastDue) | Owner | Payment failure | Plan, amount due if known, what keeps working, what stops and when | `/app/settings/billing` | critical | email | account | `plan-past-due:{period}` | Selestial (Autumn creates the customer without an email, so Stripe sends nothing) | Build now |
| `credits_exhausted` | `billing.zero_balance` | Owner | Alert | What paused, what keeps working | `/app/settings/billing` | high | email | account | 1 per 24 h (as in-app today) | Selestial | Build now |
| `customer_payment_failed` | `payment.failed` / `payment_intent.payment_failed` | Owner and finance members | Alert | Customer, invoice, amount, Stripe's reason in words | Invoice | high | email | activity | `pay-failed:{payment}` | Selestial (Stripe sends the customer nothing for a failed one-off) | Build now |
| `retention_serious` | `retention_case.opened` with a serious concern | Owner and managers | Alert | Customer, case, the kind of concern (never the customer's words) | Case | critical | email | escalations | `notice:retention_serious:{case}` | Selestial | Built |
| `retention_attention` | `retention_case.needs_attention` with no approval waiting; `retention_signal.raised` (commitment overdue) | Owner and managers | Alert | Customer, case, what is needed, deadline | Case | high | email | escalations | `decision:{event}` or `overdue:{dueAt}` per case | Selestial | Built |
| `retention_outcome` | `retention_case.closed` (not routine follow-through) | Owner and managers, except whoever recorded it | Alert | Customer, case, the recorded outcome | Case | normal | email | activity | `notice:retention_outcome:{case}` | Selestial | Built |
| `inbox_reconnect` | Mailbox becomes `expired` or `error`, or `mailbox.sync_failed` 3 times | The member who connected it, plus the Owner | Gmail reconnection | Address, purposes affected, what's paused, when it stopped | `/app/settings/integrations?tool=gmail` | critical | email | account | `inbox:{mailbox}:{status}:{day}` | Selestial | Build now |
| `booking_request` | `booking.requested` (needs a person) | Office members | Alert | Customer, service, requested time | Booking | high | email | approvals | `booking-req:{id}` | Selestial | Phase 5 |
| `proposal_answered` | `proposal.accepted`, `proposal.declined`, `proposal.changes_requested` | Proposal owner | Activity | Customer, total, answer, note | Proposal | normal | email | activity | `proposal:{id}:{answer}` | Selestial | Phase 5 |
| `agreement_signed` | `agreement.completed` | Agreement owner | Activity | Agreement, parties | Agreement | normal | email | activity | `agreement:{id}:done` | Selestial | Phase 5 |
| `applicant_ready` | `application.screened` passing, Recruiter **Ask me first** | Hiring members | Activity | Applicant, role, screening result | Applicant | normal | email | approvals | `applicant:{id}:screened` | Selestial | Phase 5 |
| `product_news` | Manual broadcast | Members who opted in | Marketing | — | — | — | off | product | per broadcast | Selestial (updates.selestial.io) | Later |

### Company communications (company → its people)

These already exist and go through the outbox (§1). This build changes the template, the sender identity
and threading, not who owns them.

| Event | Owner | Recipient | Template | Dedupe (existing) | Route | Change |
|---|---|---|---|---|---|---|
| Booking confirmation | **Booking** (`lib/booking/messages.ts`) for booking pages; **Sales** (`booking_confirmed`) for Sales-made bookings | Customer | Booking confirmation | `booking:{session}:confirmation`, `booking-confirmed:{id}` | Gmail thread if Sales/Care inbox connected, else company via Selestial | Branded template; one owner per booking (Sales doesn't confirm a booking-page booking) |
| Proposal delivery | Sales (`proposals.ts`) | Customer | Proposal delivery | `proposal:{id}:v{n}` | Same | Branded; link opens review page (`/p/{token}`), never accepts |
| Signature request | Agreements via Sales outbox | Signer | Proposal delivery variant | `sign:{req}:{email}` | Same | Branded |
| Applicant invitation | Recruiter | Applicant | Applicant invitation | `invite:{app}` | Hiring Gmail if connected, else company via Selestial | Branded on Resend; plain + threaded on Gmail |
| Invoice / reminder | Finance | Customer | Company notice | `finance:{draft}` | Same | Branded |
| Card receipt | **Stripe (company account)** | Customer | Stripe | Stripe | — | No Selestial copy |
| Portal invite / code | Cleaners | Cleaner | Company notice | `portal.invite:{link}` | Company via Selestial | Branded; add Reply-To |
| Earnings statement | Finance | Cleaner | Company notice | `statement:{link}:{ch}:{now}` | Same | Key fix: one per statement period |
| Calendar invitations | **Google Calendar** | — | — | — | — | No Selestial copy |

## 6. Gaps to close, by phase

**Phase 3, infrastructure:**
- `member` as a recipient kind.
- Notification preferences.
- A `notifications` purpose family on `messages`, with the recipient being a member.
- A sender registry: build the identity, hold the message when it isn't ready.
- Bounce, complaint, failure, suppressed and delivered kept distinct.
- Complaints accepted after delivery.
- Suppression written for every kind of mail (not just applicants).
- `List-Unsubscribe` and `List-Unsubscribe-Post` on mail a person can opt out of.
- The `verification_code` retry bug.
- The `provider` mismatch.
- Branded HTML instead of `plainHtml` for company mail.

**Phase 4, connected inbox:**
- Purposes and agents per mailbox.
- Revoke on disconnect when no other feature uses the grant.
- 403 handled separately from 401.
- A refresh lock.
- A watch started at connect.
- An address index.
- Cached Pub/Sub keys.
- `threadId`, `In-Reply-To` and `References` on every send.
- No resend after a 5xx (the message becomes `unconfirmed`).
- One shared "can this mailbox send".
- "Expired" shown as such.
- A Microsoft "Coming soon" card.
- Recruiter's behavior preserved.

**Phase 5, wiring:**
- The events marked "Build now" and "Phase 5" above.
- `agent.acted` written by agents running at Act and notify me.

**Configuration (not code), live backend terrific-avocet-835:**
- `APP_ORIGIN` and `LINK_ORIGIN` are **not set**. Member invitations are currently recorded as
  "not sent: no app address". Links fall back to `https://selestial.io`, which redirects twice before
  reaching `link.selestial.io`.
- `SALES_REPLY_DOMAIN` is **not set**, so Sales replies go to the company's support email instead of
  coming back into Selestial.
- The Resend webhook points only at `stoic-gazelle-731` (unused by the site). Add a second endpoint for
  `terrific-avocet-835` with its own signing secret.

## 7. Decisions taken

| Question | Answer |
|---|---|
| Resend webhook | Both deployments |
| Sign-in email | Clerk sends, Selestial design (`auth.selestial.io` unused for now) |
| Company From | "{Company} via Selestial" from `mail.selestial.io`; company-owned domains later |
| Gmail scopes | Read + send only (`gmail.readonly`, `gmail.send`); no modify or compose; drafts are reviewed in Selestial |

## 8. Plan

1. **Phase 2:** visual system.
   - `convex/lib/email/kit.ts` (blocks and frame).
   - Ten representative templates in `convex/lib/email/templates/`.
   - A preview gallery at Settings › Notifications › Email previews with desktop, mobile, dark, subject,
     preheader and plain text.
   - PNG agent avatars for email.
   - The invitation moved onto the kit.
2. **Phase 3:** notification infrastructure.
   - Catalog in code (`convex/lib/notify/catalog.ts`).
   - Preferences table and settings page.
   - Routing from events to members.
   - Member notices through the `messages` outbox.
   - Sender registry.
   - Webhook outcomes split.
   - Suppression on bounce and complaint for all mail.
   - Unsubscribe headers and page.
3. **Phase 4:** connected inbox.
   - Shared Gmail connection with purposes, agents, label, history window and send permission.
   - First-findings review.
   - Hardening from §6.
   - Microsoft card.
4. **Phase 5:** wire the events above, mark what each depends on.
5. **Phase 6:** verification.
   - Tenant isolation, permissions, opt-outs, rendering, threading, duplicates, retries, disconnected
     inboxes, expired links and webhook authenticity, checked in tests.
   - Live sends only to controlled test addresses.
