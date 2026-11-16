# Recruiter: navigation and screen data contracts

The owner-facing pages are **not built**. This is what each will read and which actions it will call.
All functions exist and are tested. Arguments omit `companyId`, which every call takes.

**Sidebar:** Team → Recruiter. Clicking Recruiter opens the overview. Tabs: Hiring Needs · Applicants ·
Screening · Interviews · Offers & Agreements · Playbook (already in `src/lib/app/navigation.ts`). Agent
chat, activity, approvals and settings come from the shared workspace header.

## Overview — `recruiter.overview`

`openHiringNeeds`, `newApplications`, `contactNeeded`, `invitationsAwaitingApproval`,
`incompleteApplications`, `incompleteNeedingFollowUp`, `awaitingScreening`, `awaitingInterview`,
`decisionsAwaitingOwner`, `offersOut`, `awaitingOnboardingHandoff`, `inOnboarding`; `inbox[]` (address,
provider, status, problem, last read, whether the connector is built); `inboxConnected`; `failures`
(messages not delivered, flagged messages, unread inboxes); `connections` (links, email, texting,
calendar, signing, reader: each a name or null, so the screen can say "not set up yet"); `paused`.
Every number is counted from records when asked.

Also: `recruiter.staffingRequests` (Dispatch's open requests), `recruiter.urgentRequest(taskId)` (who is
in the pipeline, each with qualification gaps and readiness gaps), `recruiter.prepareUrgentOutreach`.

## Hiring Needs — `hiringNeeds.list`, `hiringNeeds.get`

Per role: title and aliases, responsibilities, service types, location, coverage areas, required
availability, skills, experience, equipment or transportation, worker type, approved pay (who and
when), openings, target start, application questions, screening criteria, interview process, status,
the Dispatch request it came from, and counts of applications (all, active, hired). `get` adds the
application form as applicants will see it.

Actions (Owner): `create`, `update`, `setCompensation`, `setStatus`.

## Applicants — `applications.list({ stage?, needId? })`, `applications.get`

List row: person, role (and the role as the notification named it), source, stage, contact (status,
plain-words meaning, address, bounced), completion (invited, started, submitted times), next action
(what, by whom, due), with a person, waiting on a reply, closure.

Detail adds: contact evidence, facts with provenance, the form (answered of required, answers),
attachments (`verified: false`), the conversation (outbound with purpose, channel and delivery status;
inbound with classification, subject, excerpt, flag), reminders sent, screening, interviews, offers,
handoff, decisions.

Actions: `addManually`, `resolveContact`, `assignRole`, `takeOver`, `handBack`, `inviteAgain`,
`revealLink`, `markReplyAnswered`, `askApplicant`, `recordWithdrawal`, `setDoNotContact`, `close`,
`removeApplicantData`, `attachmentUrl`; `recruiter.inboxMessages` for what the inbox run saw;
`recruiterTools.forApplication` for the agent's actions.

## Screening — `applications.screeningQueue`

Each submitted application with its latest screening: per criterion the outcome (meets, does not meet,
needs clarification, not applicable), the answer quoted as evidence, its source and whether it is a
fixed requirement; missing information; contradictions; the summary (experience, availability, met,
concerns, suggested next step); and the recommendation (advance, clarify, review requirement). There
is no score.

Actions: `applications.decide` (interview, hold, offer, reject with reason), `rescreen`, `askApplicant`.

## Interviews — `interviews.board`

Interviews by status (awaiting slots, proposed, reserving, confirmed, completed, no-show, cancelled)
with applicant, time, interviewer, reschedules, reminder, feedback, whether it is in a calendar; open
and booked slots; how many times can be offered; which calendar is connected; the time zone.

Actions: `addSlots`, `removeSlot`, `schedule` (set a time by hand), `cancelTime`, `feedback`.

## Offers & Agreements — `hiringOffers.board`, `onboarding.queue`

Per application from decision onwards: the role's approved terms, each offer (status, terms, approval,
sent, expires, responded, agreement status), the handoff (status, outstanding requirements, due), next
action; which signing service is connected. The onboarding queue shows approved terms, what the
applicant told us, each requirement with who recorded it, the responsible person, next action, due
date, the worker's status and `dispatchReady`.

Actions: `hiringOffers.draft`, `requestSend`, `withdraw`, `sendAgreement`, `recordAgreement`;
`onboarding.record`, `onboarding.complete` (Owner). Sending happens only in `approvals.decide`.

## Playbook — `recruiter.playbook`

Invitation mode, reminder hours and limit, sending hours and days, time zone, sender name, reply
address, confirmed job-board relays, link and offer lifetimes, retention days, interview length and
reminder lead, decision window, onboarding requirements, and the Owner's own recruiting rules,
communication policy and escalation rules.

Actions (Owner): `updatePlaybook`, `connectMailbox`, `reconnectMailbox`, `disconnectMailbox`;
`readInboxNow` (Manager); `permissions.set` for approval boundaries.

## Applicant pages (built)

| Page | Address | Functions |
|---|---|---|
| Application | `/c/apply/<token>` | `applicantPages.application`, `saveDraft`, `fileUploadUrl`, `attachFile`, `removeFile`, `submit`, `withdraw` |
| Interview time | `/c/interview/<token>` | `applicantPages.interview`, `pickTime`, `cancelTime` |
| Offer | `/c/hiring-offer/<token>` | `applicantPages.hiringOffer`, `acceptOffer`, `declineOffer` |

Served on the link host with the cleaner pages (owner's earlier decision: `link.selestial.io` under
`/c`). Screenshots: `docs/screenshots/recruiter/`.
