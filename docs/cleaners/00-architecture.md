# Cleaners: the workforce workspace

**Status: plan written November 17, 2026, on `claude/selestial-cleaners-workspace-qpz79j`.** Each phase
below is marked as it is built and verified. This document is the source of truth for the workspace; where
it differs from `docs/foundation`, the foundation documents win until changed on purpose.

## 1. What was there before this work

Inspected on `main` at `7a375f6` (November 16).

| Area | Implemented | Not implemented, or only described |
|---|---|---|
| Cleaner record | `cleaners`: name, email, phone, `engagement` (contractor or employee), `status` (onboarding, ready, paused, ended), skills, postal-code service areas, owner-only `pay`. `convex/cleaners.ts`. | No subcontractors, no photo, no history of affiliation, no page per cleaner. The `/app/cleaners` page is one list with an add form. |
| Readiness | Dispatch offers work only to `status === "ready"`, which only a person sets (`lib/dispatch/eligibility.ts`). | No requirements on the cleaner. "Ready" is one flag standing for onboarding, eligibility and payout readiness at once. |
| Onboarding | Recruiter's `onboardingHandoffs`: a hire becomes a cleaner in `onboarding`, with a list of requirements a person ticks (`lib/recruiter/handoff.ts`). The list is the Recruiter Playbook's `onboardingRequirements` (keys and labels only). | No submissions, review states, expiry, effect on work or pay, or anything a cleaner does themselves. |
| Availability | Weekly windows and time off (`availability.ts`), read by Dispatch on the company's clock. | No date exceptions, no confirmation date, no time-away request from the cleaner, no travel limit. |
| Crews | Per-job roles (lead or support) on assignments, crew size on jobs, crew pay rules. | No permanent crews, no temporary team record. |
| Links | Signed, scoped, expiring, revocable action links for one assignment (`lib/dispatch/links.ts`); applicant links for Recruiter. A read never acts. | No cleaner-wide portal, no onboarding or availability link. |
| Messages | One outbox, one send policy (consent, opt-out, quiet hours, frequency) checked at planning and at sending (`lib/messaging`). Delivery states: queued, held, sending, sent, delivered, failed, unconfirmed, not sent. Telnyx texting is built; it needs each company's registration. | No message purpose for onboarding, availability or check-ins. No message index by cleaner. |
| Agreements | Workforce agreements with an access class per document and links to cleaners (`agreementLinks`). Signing has no production provider: drafts, approval, export and externally signed uploads work. | Nothing reads an agreement's state as a requirement. |
| Pay | `cleaners.pay` (Owner only) and the pay stated on each assignment when offered, which is the record for that job. | **Finance is not built.** There is no ledger of approved earnings, adjustments or payouts. |
| Performance | The record holds offers and answers, check-ins with time, no-shows declared by a person, drops, completion reports and returns. | No measure, score or coaching. Customer feedback (Retention) and quality review (Quality) are not built. |
| Agents | Dispatch and Recruiter workflows run; Sales and Retention are listed and not built. Team Coordinator and Quality exist only in the navigation plan. | |
| Chat | A tool registry where each tool re-checks role and authority; consequential tools wait for approval in the chat. | No cleaner tools beyond reading one record. |

A pay leak was found and is fixed in Phase 1: `onboarding.queue` returned the approved pay terms to every
role.

### What Novara shows, and what is not taken from it

Novara is a reference for what a cleaning company tracks. Its interface, policies, thresholds, score weights,
disciplinary ladder and pay tiers are not copied. Specifically avoided: its 70% supply threshold; its pulse
check, which ends a cleaner who does not answer for three days; quality issues charged to a crew's lead; a
portal that trusts a typed phone number; onboarding flags the cleaner writes directly; scores with no minimum
history.

## 2. Boundaries

Cleaners owns the workforce directory and the ongoing relationship. It shows other workspaces' records and
starts their workflows; it never keeps a second copy.

| Concern | Owner | What Cleaners does |
|---|---|---|
| Applicants and hiring | Recruiter | A hire arrives as a linked cleaner (one record, history kept). The profile links back to the application. |
| Offers, assignments, coverage | Dispatch | Reads assignments for jobs, history and conflicts. Crew assembly offers through Dispatch's own `offer` path. |
| Earnings, payments | Finance (not built) | Shows the pay arrangement and the pay stated on each job. Says plainly that approved earnings and payments are not recorded yet. |
| Documents to sign | Agreements | A requirement can point at a workforce agreement; it is accepted only when the agreement is signed. |
| Services, durations, skills | Services & Pricing | Reads the skills a job requires from the job. Equipment needs can name a service. |

Team Coordinator and Quality are not built. Their work is either done by a launch agent that already owns the
underlying workflow (section 6) or kept as a queue a person works. Nothing says either agent exists.

## 3. Records

New tables live in `convex/lib/cleaners/schema.ts`. Every table carries `companyId` and is read through an
index that starts with it.

| Table | What it is |
|---|---|
| `cleaners` (extended) | One person. `engagement` gains `subcontractor`. `status` is the **engagement status** only (onboarding, active — stored as `ready` for compatibility — paused, suspended, ended). New: photo, `subcontractorId`, preferred areas, travel limit, `availabilityConfirmedAt`, `hiredFrom` (application). |
| `subcontractors` | A company that supplies its own cleaners: name, status, the authorized contact, areas, owner-only pay arrangement. |
| `workerAffiliations` | Which subcontractor a cleaner worked through, from when to when. A job's affiliation is read from the dates, so history survives a move. |
| `requirementDefinitions` | The company's onboarding template: one row per requirement, with kind, effect (blocks assignments, blocks payment, or informational), the worker types it applies to, who reviews it, how long it stays valid, and for equipment who provides it and for which services. |
| `workerRequirements` | One requirement for one cleaner: not started, submitted, awaiting review, accepted, needs changes, expired, or waived (with who and why). Evidence is a file, an agreement or a note. |
| `availabilityExceptions` | A date the cleaner can or cannot work, outside their weekly pattern. |
| `skillClaims` | A skill a cleaner says they have, waiting for a person to confirm. Dispatch reads only confirmed skills. |
| `crews`, `crewMemberships` | Permanent crews with a lead, and temporary teams for one job. Membership has dates; a temporary team keeps its members whatever happens to the permanent crew. |
| `portalLinks`, `portalCodes` | A cleaner's or subcontractor contact's portal access and focused task links. Same token scheme as action links. A one-time code unlocks pay, tax and personnel records. |
| `followUps` | One routine follow-up: what it is about, the agent responsible, when it is due, its message, and why it stopped. One open follow-up per cleaner and topic, across every workspace. |
| `coachingNotes` | Manager notes, coaching, training recommendations and shared feedback, with evidence, agreed actions, follow-up dates and the cleaner's response. Internal and shared are separate. |
| `recordDisputes` | A cleaner or manager disputes a performance record. Open disputes are excluded from the score. |
| `personnelRequests` | Pay changes, disciplinary actions, suspension, ending an engagement, rehire restrictions and destructive changes. Requested by a person, decided by an authorized person. No agent can create one. |
| `payArrangements` | Each compensation arrangement with its effective date. The current one is copied to `cleaners.pay`, which Dispatch already reads. |

## 4. Readiness

Six things are kept apart and each has its own words on screen:

1. **Relationship type**: employee, independent contractor, subcontractor worker.
2. **Engagement status**: onboarding, active, paused, suspended, ended. Set by a person. A subcontractor
   worker whose company's working relationship has ended takes no work, whatever their own status, until they
   are moved to another company or engaged directly.
3. **Onboarding progress**: each requirement's state.
4. **Job eligibility** ("Ready for assignments"): active, and every requirement that blocks assignments is
   accepted and current. Equipment and skill requirements tied to a service only block that service.
5. **Availability**: weekly pattern, exceptions, time away, existing commitments, for a given window.
6. **Payout readiness**: every requirement that blocks payment is accepted.

Readiness is one pure function (`lib/cleaners/readiness.ts`) used by the directory, the profile, Dispatch's
eligibility rules, the portal, Chat and the follow-up engine. It returns the exact unmet requirements.
An upload is "submitted", never "accepted". Viewing an agreement is not signing it. Starting payment setup
is "submitted" until a person or provider confirms it.

## 5. Access

| What | Office | Manager | Owner | Cleaner (portal) | Subcontractor contact (portal) |
|---|---|---|---|---|---|
| Directory, profile overview, availability, crews, onboarding states | read | read, change | read, change | own | their workers |
| Document files, internal notes, coaching | — | read, write | read, write | shared feedback only | — |
| Pay arrangement, job pay, pay requests | — | — | read, change | own, after a code | their company's, after a code |
| Sensitive personnel requests | — | request | request, decide | — | — |
| Templates, follow-up rules | read | read | change | — | — |

The same checks run in Chat tools, search, exports and messages, not only on screens.

## 6. Agents

Until Team Coordinator exists, routine follow-ups are run by the launch agent that already owns the
underlying work, under new catalog actions that start on Propose like every action a cleaner sees:

| Follow-up | Agent | Action |
|---|---|---|
| Onboarding reminders | Recruiter (brief, section 14: "chase what is stale") | `recruiter.onboarding_reminder` |
| Availability confirmation, idle-worker check-ins | Dispatch (it reads availability) | `dispatch.availability_check_in` |
| Coaching drafts, score explanations | No agent. Selestial prepares them in code for a person to review. | — |

Before any send: the follow-up is checked again (still unresolved, cleaner still active, not already
contacted about the same thing by any workspace in the company's window, message policy). Silence is never
read as resignation or misconduct; an unanswered check-in becomes a task for a person.

## 7. Phases

| Phase | Delivers | Gate |
|---|---|---|
| 1 | Records, directory (cards and table, search, filters, kept in the address), overview counts with definitions, attention list, profile page and drawer with sections, role-aware access, add and import with duplicate review. | An owner adds or imports a worker, finds them, opens a full profile and understands their status; restricted details are refused to other roles. |
| 2 | Templates, requirement review, readiness, portal and focused links, documents and agreements, onboarding reminders, Recruiter handoff into the same requirements. | An invited cleaner completes a supported onboarding journey, the owner reviews it, readiness updates. |
| 3 | Availability exceptions, time away with impact, skills confirmation, permanent and temporary crews, leads and subcontractor access, Dispatch eligibility on readiness. | The owner assembles an eligible crew for a job from real availability and requirements, with conflicts visible. |
| 4 | Measures, versioned score, coaching, idle check-ins, recommendations, Chat tools, Pay. | An owner inspects a finding, sees its records, reviews a coaching draft and carries the authorized action through. |
