# Recruiter: unverified assumptions, legal review, and remaining setup

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
| Google OAuth app (Gmail read-only) and Microsoft Entra app (Mail.Read), plus a secure store for each company's refresh token | Reading a real hiring inbox. The owner said companies use both. | **Connectors not built.** Only the mock exists behind `MailboxConnector`. Choosing a label, folder or sender filter per company is supported in the record. |
| An email provider for `mail.selestial.io` (domain verified, API key, delivery and bounce webhook) | Sending. The owner chose a Selestial sending domain with replies to the company's hiring inbox. | **Adapter not built.** `EMAIL_PROVIDER=resend` answers "not built". A webhook has to call `internal.messaging.receipt`. |
| A model provider key | The owner asked for a model to identify hiring mail in mixed inboxes | **Adapter not built.** A rules reader does both jobs. Until a model is connected, mail from unknown senders is recognised only by subject keywords. |
| Google Calendar (and Microsoft) OAuth per interviewer | The owner asked for calendar integration alongside owner-entered slots | **Adapter not built.** Owner-entered slots and applicant self-scheduling work now; `CalendarProvider` is ready. |
| An e-signature provider | The owner asked to plan for one | Interface and records only. A person records completion. |
| Text provider (Telnyx is planned) | Reminders by text | Not connected (Dispatch's finding). Applicant texts go through the same outbox and the mock. |
| Convex settings: `ACTION_LINK_SECRET`, `LINK_ORIGIN` (already used by Dispatch), `EMAIL_PROVIDER`; later `RECRUITER_MODEL`, `CALENDAR_PROVIDER`, `SIGNATURE_PROVIDER` | Turning each piece on | Not set by this work. No credential was guessed or added. |

## Known limits

- Replies are matched to an application by the sender's address. A reply from a different address
  than the one on file is flagged, not matched. Because replies go to the company's own inbox, a
  disconnected inbox means replies are not seen until it is reconnected.
- A bounce is known only when the email provider reports it.
- A person answers applicant questions; Recruiter does not draft replies yet.
- `applications.list` and the overview read up to a few hundred rows per stage; pagination is needed
  before large volumes.
- The shared link error page (`src/app/c/error.tsx`) says "text message" and "the office"; applicants
  arrive from email. It was left as Dispatch wrote it.
- The other four agents named in the navigation are not built; onboarding is an owner-worked queue
  until Team Coordinator exists.
