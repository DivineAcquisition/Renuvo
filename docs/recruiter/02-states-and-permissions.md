# Recruiter: records, states and permissions

## Records

A person, their application to one role, and each message about it are three separate things.

| Concept in the brief | Record |
|---|---|
| Hiring role or requisition | `hiringNeeds` |
| Applicant | `applicants` |
| Role-specific application | `applications` |
| Source message | `sourceMessages` |
| Contact evidence | `applications.contact` (status, address, every address found with its kind and where) |
| Field-level provenance | `applications.facts` (field, value, from, where, source message) |
| Invitation | a `messages` row (`application_invitation`) plus `applications.invitationApprovalId` |
| Form session | `formSessions` |
| Attachment | `applicantAttachments` |
| Screening evaluation | `screenings` |
| Interview | `interviews`, `interviewSlots` |
| Hiring decision | `hiringDecisions` |
| Offer and agreement | `hiringOffers` (`agreement` is its own sub-state) |
| Onboarding handoff | `onboardingHandoffs`, and a `cleaners` row in `onboarding` |
| Task and approval | `tasks`, `approvals` (shared) |
| Communication event | `messages` (shared), `providerReceipts` |
| Audit event | `events` (shared), `toolRuns` |
| Mailbox connection | `mailboxConnections` |
| Applicant link | `applicantLinks` |
| Playbook | `companies.recruiter` |

## Application stages

`received → contact_needed → invitation_awaiting_approval → invited → application_started →
application_submitted → screening → interview → decision_pending → offer_sent → accepted →
onboarding_handoff`, and `withdrawn` or `closed` from any of them. Allowed changes are in
`STAGE_CHANGES` (`convex/lib/recruiter/schema.ts`); anything else is refused.

- **Delivery is not a stage.** A message has its own status: queued, sending, sent (provider accepted),
  delivered (provider confirmed), failed, unconfirmed, not sent, and `bouncedAt`. Nothing records
  "opened" or "read". An application becomes `invited` only when the provider accepted the email.
- **Closure reasons** are stored: requirement not met, not selected, role closed, duplicate, no contact
  possible, offer declined, no response (a person's choice only), hired, other.
- **Every active application has a next action** with who owes it (recruiter, owner, applicant) and a
  due time where one applies.

### Contact status

| Status | Meaning | Can be written to |
|---|---|---|
| `direct` | An address labelled as the applicant's, found in their resume, typed by them on the form, or entered by a person | Yes |
| `relay` | A job board's forwarding address, and the Owner confirmed that board's forwarding | Yes |
| `relay_unverified` | The same, not confirmed | No: contact needed |
| `notification_only` | Only a no-reply or job-board system address | No |
| `conflict` | More than one address could be the applicant's | No: a person chooses |
| `missing` | Nothing clearly the applicant's | No |

### Deduplication

| Situation | Result |
|---|---|
| Same provider message seen again | Ignored (`sourceMessages` by connection and message id) |
| Same job-board application id | Filed under the existing application as a duplicate notification |
| Same person (email, relay address, or phone and name) and same role, application still open | Same application |
| Same person, different role | Second application, same applicant |
| Same name, nothing else | Two applicants; flagged, with a task to check |
| Same person and role after the earlier application ended | New application, flagged for a person |
| Invitation asked for again (retry, repeat notification, tool call) | One message, by `dedupeKey` |

## When reminders stop

Checked in one place, `sendProblem`, when a message is planned and again when it is claimed for
sending: submitted; withdrawn; closed; do-not-contact; address bounced; role paused or closed; a person
took over; the applicant's question is unanswered; link expired or revoked; limit reached. When the
limit is reached or the link closes, a person is asked what to do. Silence never closes an application.

## Permissions

| Action | Starts at | Most the Owner can grant |
|---|---|---|
| `recruiter.send_invitation` Email the application link | Propose | Execute (also needs "automatic" mode in the Playbook, and every item in `autoEligible`) |
| `recruiter.follow_up` Remind about an unfinished application | Propose | Execute |
| `recruiter.acknowledge_and_collect` Ask for missing details | Propose | Execute |
| `recruiter.run_interview` Coordinate interviews | Propose | Execute |
| `recruiter.decline_fixed_requirement` Decline on a published fixed requirement | Propose | Execute and report |
| `recruiter.send_offer` Send an offer | Propose | **Propose** |
| `recruiter.urgent_outreach` Contact applicants about an urgent need | Propose | **Propose** |
| `recruiter.advance_candidate` Move a candidate forward, mark ready | Propose | **Propose** |

Automatic invitation requires all of: Playbook mode "auto"; permission above Propose; a job board's
own notification (not a forward or direct email); one settled address; a clear name; no possible
duplicate; no flagged message; role open.

### Who may do what

| | Owner | Manager | Office |
|---|---|---|---|
| Open, change, pause, close a role; approve pay | Yes | | |
| Playbook; connect or disconnect the inbox; permissions | Yes | | |
| Complete an onboarding handoff | Yes | | |
| Decide approvals; decide on applicants; close; resolve contact; map role | Yes | Yes | |
| Interview slots, scheduling, feedback; draft offers; record requirements | Yes | Yes | |
| Read applicant files; remove applicant data | Yes | Yes | |
| Read lists and applications; mark a reply answered | Yes | Yes | Yes |

## Agent tools

`list_hiring_messages`, `inspect_application_message`, `extract_applicant_details`,
`resolve_applicant_contact`, `find_existing_application`, `create_application_record`,
`issue_application_link`, `prepare_invitation`, `request_approval`, `send_approved_invitation`,
`inspect_application_progress`, `request_missing_information`, `evaluate_configured_criteria`,
`propose_interview_slots`, `schedule_approved_interview`, `prepare_candidate_summary`, `prepare_offer`,
`create_onboarding_handoff`.

Each is called through `internal.recruiterTools.run` with an idempotency key, checks permission at that
moment, and is logged in `toolRuns`. There is no tool that decides, changes pay, sends an offer, marks
anyone ready, reads the mailbox directly, or returns a link token. `create_application_record` returns
the application intake already made for a message and refuses otherwise: records are created from a
message that was read and checked, not from an agent's words.
