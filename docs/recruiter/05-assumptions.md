# Recruiter: unverified assumptions, legal review, and remaining setup

## Unverified provider shapes

| Assumption | Basis | If wrong |
|---|---|---|
| Resend accepts `POST /emails` with `from`, `to`, `reply_to`, `subject`, `text` and an `Idempotency-Key` header, and answers `{ id }` | Resend's public documentation as remembered; not checked against the live API | The send fails with a plain-words problem and the application goes to a person; nothing is sent twice |
| Resend signs webhooks with Svix (`svix-id`, `svix-timestamp`, `svix-signature`; HMAC-SHA256 over `id.timestamp.body` with the `whsec_` secret) and events carry `type` and `data.email_id` | The same | Every webhook is refused with 401: bounces are not recorded, and nothing else changes |
| Gmail API: `users.getProfile` gives `historyId`; `users.history.list` with `historyTypes=messageAdded` and `labelId` lists new mail and answers 404 when the start point is too old; `users.messages.get` with `format=metadata`/`full`; `users.messages.send` takes a base64url RFC 5322 `raw` | Google's public documentation as remembered; tested against a stand-in (`tests/fakeGoogle.ts`) only | Reading fails with a provider problem shown on the inbox; a 404 falls back to a dated scan, so nothing is skipped |
| Google's token endpoint answers `invalid_grant` when an authorization was revoked or expired | The same | The inbox shows "Reconnect" instead of a provider hiccup |
| Claude structured output with `fallbacks: "default"` on the beta endpoint | The SDK's types and the API reference in this session | The model gives no answer and the rules reader answers instead |

## Unverified job-board formats

**No real Indeed or ZipRecruiter notification was available for this build.** The owner has said
redacted samples will be supplied. Until they are checked, every item here is an assumption. They live
in one place, `BOARDS` and the patterns in `convex/lib/recruiter/mail.ts` and `interpret.ts`.

| Assumption | Basis | If wrong |
|---|---|---|
| Indeed mail comes from `indeed.com` or `indeedemail.com` | Novara's working query for `indeedemail.com`; general knowledge for `indeed.com` | Mail is treated as from an unknown sender and judged by subject |
| Indeed application subjects contain "New application" or "applied to/for" | Novara parses "New application for …" | Filed as a promotion and not opened |
| A non-system `@indeedemail.com` address is a per-applicant relay | Novara sends to it in production | Classified notification-only or unknown |
| **Mail to an Indeed relay reaches the applicant, with what limits** (expiry, attachment and link rules, rate limits) | Not verified. Novara's use suggests it works; its limits are unknown | This is why relays start unverified and need the Owner's confirmation per board |
| ZipRecruiter mail comes from `ziprecruiter.com`; applications say "New candidate" | General knowledge only. Novara has no ZipRecruiter code | Not recognised as applications |
| ZipRecruiter relays are `@reply.ziprecruiter.com` | **A guess.** | Relay not recognised; applications become "contact needed" |
| Notifications label fields as `Email:`, `Phone:`, `Location:`, `Experience:`, `Application ID:` / `Candidate ID:` | Assumed for the synthetic tests | Fields are not extracted; the application is still recorded |
| "Suggested candidate" and promotional mail can be told apart by subject | General knowledge | A suggestion could be read as an application: it would wait for approval, not be sent automatically |
| Resume text is available | The connector must supply it. **No PDF or Word parsing is built.** | An address only in a resume is not found; "contact needed" |

What I need to verify these: for each board, two or three redacted notifications of each kind (new
application, applicant message, suggested candidate, promotion) with full headers.

## Needs legal review before sale

1. **Automatic decline on a fixed requirement.** Built, off by default. Rules on automated hiring
   decisions differ by state.
2. **The wording guard** (`fairness.ts`) refuses minimum-age and work-authorization questions outright.
   Some forms of those are lawful. Counsel should set the wording and the stage at which they are asked.
3. **Retention** (default 365 days) and what a deletion request removes. Record-keeping duties vary.
4. **The decline email** and whether a reason must be offered in some places.
5. **SMS consent wording**, and texting generally (TCPA, carrier registration).
6. **Contractor versus employee** offers: the same offer page serves both, with no classification advice.
7. **Background checks.** Nothing is built. If a provider is added, disclosure, authorization and
   adverse-action steps must be designed with counsel.
8. **Applicant email sent by an automated system** on a company's behalf: the footer says so; confirm
   that is sufficient.

## Remaining external setup

| Needed | Why | Status |
|---|---|---|
| Google OAuth web client with the Gmail API (scopes `gmail.readonly`, `gmail.send`, `openid`, `email`), redirect URI `https://<deployment>.convex.site/oauth/google/callback`; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MAILBOX_TOKEN_KEY` on the deployment | Reading the hiring inbox and, when the Owner allows it, sending applicant email from it. The owner chose Gmail first on November 16. | **Gmail connector built** (`convex/lib/recruiter/gmail.ts`, `convex/recruiterMailbox.ts`), tested against a stand-in only. Not run against Google: no client exists. `gmail.readonly` is a restricted scope: before companies outside the test users can connect, Google's app verification and an annual security assessment (CASA) are needed. In Google's "testing" status, authorizations expire after about seven days. |
| Microsoft Entra app (Mail.Read, Mail.Send) | Companies on Microsoft 365 | **Not built.** Planned after the owner screens and calendar. |
| Resend for `mail.selestial.io`: verify the domain, create an API key, add a webhook to `https://<deployment>.convex.site/webhooks/resend` for delivered, bounced, complained and failed | Sending, and knowing about bounces. The owner chose Resend on November 16. | **Built.** Applicant email goes through the shared Resend connection (`convex/lib/email/provider.ts`, also used for member invitations), extended with a per-company sender name and Reply-To. Signed delivery/bounce webhook in `convex/http.ts`. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (an address on the verified domain) and `RESEND_WEBHOOK_SECRET`. Tested against stand-ins only. |
| An Anthropic API key | The owner chose Claude on November 16 to recognise and read hiring mail | **Adapter built** (`convex/lib/recruiter/claude.ts`), Claude Opus 5.5 at low effort with structured output and server-side fallback on a refusal, tested against a stand-in. Set `RECRUITER_MODEL=claude` and `ANTHROPIC_API_KEY`. Not yet run against the API. Any failure falls back to the rules reader. |
| Google Calendar (and Microsoft) OAuth per interviewer | The owner asked for calendar integration alongside owner-entered slots | **Adapter not built.** Owner-entered slots and applicant self-scheduling work now; `CalendarProvider` is ready. |
| An e-signature provider | The owner asked to plan for one | Interface and records only. A person records completion. |
| Text provider (Telnyx is planned) | Reminders by text | Not connected (Dispatch's finding). Applicant texts go through the same outbox and the mock. |
| `RECRUITER_EMAIL_FROM=noreply@mail.selestial.io` | The owner's decision: applicant email comes from noreply@mail.selestial.io under the company's name until the company connects its own inbox | Built; used only when it is on `EMAIL_FROM`'s verified domain. |
| Convex settings: `ACTION_LINK_SECRET`, `LINK_ORIGIN` (already used by Dispatch), `EMAIL_PROVIDER`; later `RECRUITER_MODEL`, `CALENDAR_PROVIDER`, `SIGNATURE_PROVIDER` | Turning each piece on | Not set by this work. No credential was guessed or added. |

## On the shared sending policy

Since November 16, applicant email and texts pass the shared sending policy (`convex/lib/messaging/policy.ts`)
when planned and again at the moment of sending, as well as Recruiter's own gate. Its checks apply to
applicants: company suspended, Recruiter paused (a person can still send), sender setup unfinished,
suppressed address, no recorded permission, quiet hours (held, then sent) and the weekly recruiting limit.

What counts as permission (`convex/lib/recruiter/consent.ts`):

| Channel | Permission | Recorded when |
|---|---|---|
| Email, recruiting | Applying for the job (source `job_application`, the owner's decision of November 16) | The application is filed, with the notification as evidence. Never over an earlier withdrawal. |
| Text, recruiting | The applicant's own tick on the form, with the exact wording (source `applicant_form`) | They tick it; unticking withdraws it. A phone number on a resume or notification is not permission. |

Asking not to be contacted withdraws both. A bounce adds the address to the shared do-not-send list.
Inbound STOP and email unsubscribe find applicants by phone and email.

**Legal review:** whether applying counts as permission to email about that application, in every place
the product is sold.

## Known limits

- Replies are matched to an application by the sender's address. A reply from a different address
  than the one on file is flagged, not matched. Because replies go to the company's own inbox, a
  disconnected inbox means replies are not seen until it is reconnected.
- A bounce is known only when the email provider reports it. Email sent from a company's Gmail has no
  bounce webhook: a bounce arrives in that inbox as a mailer-daemon message, which Recruiter files as
  unrelated. Reading those notices back into the application is not built.
- Disconnecting an inbox deletes Selestial's sealed authorization; removing Selestial's access at
  Google is the Owner's own step in their Google account.
- A person answers applicant questions; Recruiter does not draft replies yet.
- `applications.list` and the overview read up to a few hundred rows per stage; pagination is needed
  before large volumes.
- The shared link error page (`src/app/c/error.tsx`) says "text message" and "the office"; applicants
  arrive from email. It was left as Dispatch wrote it.
- The other four agents named in the navigation are not built; onboarding is an owner-worked queue
  until Team Coordinator exists.
