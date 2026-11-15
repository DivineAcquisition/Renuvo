# Recruiter: architecture and responsibility

**Status: built November 15, 2026, on `claude/selestial-recruiter`.** Backend, applicant pages and
tests are in place. The owner-facing screens are not built; their data contracts are in
`03-screens.md`. Nothing here has run against a real mailbox, email service, calendar or model.
`05-assumptions.md` lists what is unverified and what setup remains.

## What Recruiter owns

Every genuine application reaches a documented next step, and the owner receives suitable candidates
with enough information, each piece with its source, to make a hiring decision.

Recruiter reads the hiring inbox, identifies real applications, works out which address (if any) an
applicant can be written to, invites them to the company's application, follows up, screens the
submitted application against the role's criteria, coordinates interviews, drafts offers, and hands an
accepted hire to onboarding.

## What Recruiter never does by itself

| Never | How the code enforces it |
|---|---|
| Decide to hire or reject | `hiringDecisions` rows are written only by `applications.decide` (Owner or Manager). The one exception is below. |
| Change pay | An offer's pay is copied from `hiringNeeds.compensation`, which only `hiringNeeds.setCompensation` (Owner) writes. If it changed after a draft, the draft is withdrawn at approval time. |
| Send an offer | `recruiter.send_offer` has a ceiling of Propose. `sendOffer` is reachable only from a person's approval and re-checks that approval. No agent tool sends an offer. |
| Treat a document as verified | Attachments are returned with `verified: false`. Handoff information is labelled "told, not verified". |
| Declare a background check passed | There is no background-check field. It can only be an onboarding requirement a named person records. |
| Make anyone dispatch-ready | A hire becomes a `cleaners` row in `onboarding`. Dispatch offers work only to `ready`, which only a person sets, on the worker's record. Completing the handoff does not set it. |
| Apply consequences | No function does. |

**The one exception, off by default.** A decline on a *published fixed requirement* (a yes/no or a
minimum number the Owner marked `fixed`) is proposed to a person. The Owner may raise
`recruiter.decline_fixed_requirement` to "execute and report", after which such a decline is carried
out and recorded as `automatic`. This is the owner's decision of November 15 ("a person decides every
decline, with the owner able to change that"). It needs legal review before it is offered to customers.

## The workflow, and where each step lives

```
hiring inbox ──list headers──▶ classify (sender+subject) ──only hiring mail──▶ fetch body
     │                                                                            │
     │                                              interpret → checked() → ingest (one transaction)
     │                                                                            │
     ▼                                                                            ▼
 cursor saved after the page is filed                 applicant · application · source message
                                                                                  │
                                         routeApplication: role? open? contact? permission?
                                                                                  │
                             approval (review first) ──approved──▶ one invitation email + link
                                                                                  │
                    applicant page: save draft · return · submit ──▶ screening ──▶ owner review
                                                                                  │
                        interview (slots, reservation) ──▶ decision ──▶ offer (approved) ──▶ accept
                                                                                  │
                                                             onboarding handoff (worker: onboarding)
```

| Step | Code |
|---|---|
| Mailbox connector interface, mock inbox | `convex/lib/recruiter/mailbox.ts` |
| Sync run, checkpoint, failure handling | `convex/recruiterInbox.ts` |
| Sender/subject classification, job-board profiles | `convex/lib/recruiter/mail.ts` |
| Reading a message into facts; the checks every reading passes | `convex/lib/recruiter/interpret.ts` |
| Model interface (none connected) | `convex/lib/recruiter/model.ts` |
| Contact resolution | `convex/lib/recruiter/contact.ts` |
| Deduplication and record creation | `convex/lib/recruiter/intake.ts` |
| Invitation decision, sending, reminders | `convex/lib/recruiter/invitations.ts` |
| The send gate and planning a message | `convex/lib/recruiter/outbox.ts` |
| What delivery means for an application | `convex/lib/recruiter/delivery.ts` |
| Message wording | `convex/lib/recruiter/words.ts` |
| Applicant links | `convex/lib/recruiter/links.ts`, builders in `convex/lib/builders.ts` |
| Applicant pages (functions / UI) | `convex/applicantPages.ts`, `src/components/applicant/*`, `src/app/c/{apply,interview,hiring-offer}` |
| Form definition | `convex/lib/recruiter/form.ts` |
| Screening | `convex/lib/recruiter/screening.ts`, `fairness.ts` |
| Decisions and declines | `convex/applications.ts` (`decide`), `convex/lib/recruiter/decisions.ts` |
| Interviews, calendar interface | `convex/lib/recruiter/interviews.ts`, `calendar.ts`, `convex/interviews.ts` |
| Offers, signing interface | `convex/lib/recruiter/offers.ts`, `signature.ts`, `convex/hiringOffers.ts` |
| Onboarding handoff | `convex/lib/recruiter/handoff.ts`, `convex/onboarding.ts` |
| Urgent requests from Dispatch | `convex/lib/recruiter/urgent.ts` |
| Carrying out approved proposals | `convex/lib/recruiter/approvals.ts` |
| Retention and deletion | `convex/lib/recruiter/retention.ts` |
| Agent tools | `convex/lib/recruiter/tools.ts`, `convex/recruiterTools.ts` |

## What was reused, and the changes to shared files

Recruiter is built on the foundation and on Dispatch's work, which was already in the starting commit.
No second token-link system, message layer or delivery log was built.

| Foundation | How Recruiter uses it |
|---|---|
| Access builders (`companyQuery`, `managerMutation`, `ownerMutation`) | Every public function. Two builders were added for applicant links: `applicantQuery`, `applicantMutation`. |
| Tasks (`openTask`, `setTaskState`) | Every question for a person is a Recruiter task held for a person, keyed so it opens once. |
| Approvals and permissions | Seven Recruiter proposal kinds; `approvals.decide` hands them to `afterRecruiterDecision`. Four actions added to the catalog. |
| Events | New subjects and an `applicant` actor. Still append-only, still no message text. |
| Action-link tokens | Same token scheme, secret (`ACTION_LINK_SECRET`), origin (`LINK_ORIGIN`), `/c` pages and expiry/revocation rules. Applicant links are rows in `applicantLinks` because `actionLinks` rows require a cleaner, job and assignment. A cleaner's token opens no applicant page and the reverse. |
| `messages` table and `messaging.claim / deliver / settle / receipt / sweepStuck` | Applicant email and text are rows in the same table and go through the same three-step send. Added: `channel`, `subject`, `replyTo`, applicant references, `bouncedAt`, nine purposes, and a "bounced" receipt. |
| `toolRuns` | Recruiter's tool uses, with an optional `applicationId`. |
| File storage | Applicant uploads, private, served only through a manager-only query. |

Shared files changed, all additively: `convex/schema.ts`, `convex/lib/events.ts`,
`convex/lib/permissionCatalog.ts`, `convex/lib/builders.ts`, `convex/messaging.ts`,
`convex/approvals.ts`, `convex/crons.ts`, `convex/_generated/api.d.ts`. No Dispatch behavior changed;
all 142 earlier tests still pass.

## Where a model may act, and where it may not

A model has two jobs, both in the inbox run: say from **sender and subject only** whether a message not
from a known job board looks like hiring mail, and read the body of mail that does. It has no tools in
that step, its answer is data, and `checked()` drops any value that does not appear in the message,
any classification that is not on the list, and any attempt to call a job board's mailbox "the
applicant". Unrelated mail is never opened, and only its provider id and that verdict are stored.

Everything else is code: permissions, the send gate, deduplication, stage changes, scheduling, tenant
boundaries, every sentence sent to an applicant, and every number.

**No model is connected in this build.** `RECRUITER_MODEL` is unset and a rules reader does both jobs.
The owner asked for a model to identify hiring mail; the interface is ready and the adapter is listed
as remaining work in `05-assumptions.md`.

## Security and privacy

- **Tenant isolation.** Every table carries `companyId`; every id from a caller goes through `owned`.
  A link whose records left its company opens nothing. Tested in `recruiterHiring.test.ts`.
- **Tokens.** 128 random bits plus an HMAC signature, never stored, never in an event, a tool result or
  a message row (the body is stored with `{link}`). A manager can reveal a live link; the reveal is an
  event.
- **Opening is not acting.** Applicant queries change nothing. Submit, pick a time, accept and decline
  are separate requests; the UI puts a confirmation in front of the last three.
- **Expiry and revocation.** Application and interview links last `linkTtlDays` (14), offers
  `offerTtlDays` (7). Closing or withdrawing revokes every link. An expired or revoked page shows a
  state and none of the applicant's answers.
- **Attachments.** PDF, Word, text, JPG, PNG; 10 MB; three per application. Type and size are read
  from storage, not from the browser. File names are stripped to safe characters. Files are stored as
  bytes and never parsed or executed.
- **Untrusted content.** Email and attachment text is stripped of markup and control characters,
  capped, and returned to tools under an `untrusted` key.
- **Retention.** `retainUntil` is set when an application ends without a hire (default 365 days, the
  Owner's setting). A daily job, or a manager's deletion request, removes contact details, answers,
  files, message text, screening and interview notes, and leaves a row with stage and closure reason.
