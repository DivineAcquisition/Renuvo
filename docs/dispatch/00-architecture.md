# Dispatch: architecture and responsibility

Dispatch works inside Operations. It owns one outcome:

> Every scheduled job has an appropriate, accepted crew, clear service instructions, and a tracked path
> to completion, or a clearly escalated exception.

This document says what is built, where it lives, and what Dispatch will not do. The states and
permissions are in `01-states-and-permissions.md`, the screens' data in `02-screens.md`, the cleaner's
texts and pages in `03-cleaner-links.md`, and what was tested in `04-verification.md`.

## What Dispatch does, and where the code is

| Responsibility | Code |
|---|---|
| Find jobs that need staffing, per place, not per job | `convex/lib/dispatch/workflow.ts` (`coverJob`), `crew.ts` |
| Filter by hard rules, rank with reasons | `eligibility.ts`, `facts.ts` |
| Propose, or offer when allowed | `workflow.ts`, `convex/approvals.ts` |
| Make an offer: record, link, text | `offers.ts` (`placeOffer`) |
| Take an answer, re-checking everything | `assignmentState.ts` (`answerOffer`) |
| Plan, send and track texts | `convex/lib/messaging/`, `convex/messaging.ts`, `delivery.ts` |
| Links a cleaner acts through | `links.ts`, `linkQuery` / `linkMutation` in `convex/lib/builders.ts`, `convex/links.ts` |
| Reminder, check-in, delay, drop, no-check-in steps, completion | `live.ts`, `convex/dispatchOps.ts` (`monitor`) |
| Cover a place that lost its cleaner | `coverage.ts`, `workflow.ts` |
| Hand work to other agents' queues | `handoffs.ts` |
| The agent's bounded tools | `tools.ts`, `convex/dispatchTools.ts` |
| What each screen reads | `convex/dispatchViews.ts` |

## What Dispatch does not do

It does not hire, change a customer's price, approve a refund or adjustment, decide a consequence for a
cleaner, treat a complaint as resolved, release a payout, or overwrite a customer's scope or a cleaner's
availability. No function exists through which it could: there is no code path from Dispatch to a
cleaner's status or pay, to a job's price, or to any payment.

When its work reaches one of those, it opens a task in that agent's queue (`handOff`):

| Queue | When | Example |
|---|---|---|
| Recruiter | Nobody has the capacity; cover cannot be found | "Staffing gap…", "Urgent hire…" |
| Team Coordinator | A cleaner cannot be reached | "Check how to reach Lena: a text did not go through" |
| Customer Care | The customer needs to hear something; a scope request | Delay notice draft; add-on request |
| Quality | The crew reported completion | "Review the completed visit…" |
| Finance | Not used yet: Dispatch produces no financial facts today | |

Recruiter is an agent the record knows, so its tasks are filed under it. The other four are not built.
Their tasks are filed under Dispatch with `handoffTo` set and are **held for a person from the moment
they open**, so nothing waits on an agent that does not exist. The backend knows four agents
(`convex/lib/statuses.ts`); the sidebar lists eight. This work added none.

## Records

Bookings, assignments, offers, completion review and money are separate, and none is inferred from another.

| Record | Table | Notes |
|---|---|---|
| Business | `companies` | `dispatch` (offer window, time between jobs, look-ahead) and `dispatchPolicy` (everything in `policy.ts`) |
| Customer, property | `customers`, `properties` | Access instructions live on the property |
| Job | `jobs` | Status is about the service only. `requiredCrew`, `arrivalWindowMinutes`, `hardDeadlineAt`, `instructions`, `completionReportedAt` |
| Cleaner, availability | `cleaners`, `availabilityWindows`, `timeOff` | Only people change these |
| Assignment and offer | `assignments` | One row is one offer of one job to one cleaner; `accepted` is the only confirmation. Carries role, offer kind, and the day's facts: `checkIn`, `late`, `contact`, `completion` |
| Coverage request | `coverageRequests` | One per assignment that left a place empty |
| Checklist, evidence | `checklistItems`, `evidence`, `jobReports` | One checklist per job, shared by the crew, each item says who marked it |
| Action link | `actionLinks` | The token is not stored |
| Task, approval | `tasks`, `approvals` | A task has an agent, about, `trigger`, state, next action, due time, completion condition and `escalation` |
| Communication | `messages`, `providerReceipts` | Delivery only. Nothing records "opened" or "read" |
| Audit | `events` (append-only), `toolRuns` | |

There is no "crew" table: a job's crew is its accepted assignments. Required and accepted are two numbers
(`staffing()`), and a job is fully staffed only when they are equal.

## How the agent executes

Code decides eligibility, scheduling limits, capacity, expiry, permissions, state changes and acceptance.
`coverJob(jobId)` and `watchJob(jobId)` read the record and do only what is still missing, so each can run
any number of times.

AI is meant to interpret messages, summarize, explain, draft and propose the next tool. **No model is
connected yet.** What exists is the layer a model will be confined to: eleven tools (`TOOL_NAMES` in
`tools.ts`), callable only through the internal `dispatchTools.run`. Each tool re-reads the record, applies
the hard rules, checks the Owner's permission at that moment, and is recorded in `toolRuns` with its
authorization, input, outcome and the records it touched. A tool cannot offer a job to a cleaner who fails
a hard rule, and cannot remove a confirmed cleaner (`propose_reassignment` only ever asks a person).

## Reliability

| Risk | What prevents it |
|---|---|
| Duplicate event, repeated run | `coverJob`/`watchJob` are idempotent; tasks, handoffs and coverage requests are opened by key |
| Repeated webhook | `providerReceipts` keeps each report's id; a repeat is a no-op |
| Simultaneous acceptance, overfilled crew | `answerOffer` is one transaction that counts the job's accepted places before taking one. Convex runs mutations serializably, so the second acceptance reads the first |
| Overlapping assignments | Dispatch will not offer time a cleaner holds; acceptance re-checks accepted work and time off |
| Duplicate texts | `messages.dedupeKey`; `queueMessage` returns the existing row |
| Duplicate coverage searches | One coverage request per lost assignment; one offer per open place unless broadcast is on |
| Worker crash mid-send | A send is claim → send → settle. One that never settles becomes `unconfirmed` and is **not** sent again |
| Partial transfer on reassignment | Ending an assignment and closing its links is one function (`endAssignment`), in the same transaction as opening the coverage request |
| Repeated tool call | `toolRuns.idempotencyKey`: the second call returns the first answer |

Planned, attempted and verified are different states of a text: `queued` → `sending`/`sent` → `delivered`.

## Pause

Pausing Dispatch (`companies.setPausedAgents`) stops **new autonomous actions**: no new proposals or
offers, no reminders, no "are you coming?" text, no tool that changes anything. It does not stop:

- owners reading every screen, offering by hand, deciding approvals already raised (an approved offer is
  still refused if Dispatch is paused at that moment), or working any task;
- a cleaner using a link they already hold: answering an offer, checking in, reporting a delay, the
  checklist, photos, submitting;
- the texts that are a direct result of a cleaner's own action (the confirmation after they accept);
- records for people: the no-check-in alert to the operator, coverage requests, the handoff to Quality;
- deadlines: offers still expire.

While paused, the cover task says "Dispatch is paused. Resume Dispatch, or offer this visit to a cleaner
yourself." A reminder that came due during a pause goes out on resume if the job has not started.

## From Novara

Used as a reference for behaviour, not as truth. Kept: the offer / accept / expire flow, crew roles, the
late → alert → no-show ladder, one-tap ETA, the shared checklist with skip reasons, photo upload from the
phone, completion going to review. Deliberately different:

| Novara | Selestial |
|---|---|
| Address and notes shown before acceptance | The offer shows city and postal code; the address is on the job page only |
| Accept, decline, ETA and cancel fire on GET | Reads never change anything; every action is a button and its own request |
| Check-in and completion take a cleaner id | Only a signed link acts; no id in the arguments is trusted |
| One never-expiring token per assignment, stored in clear | Two links with separate lives; the token is signed, not stored |
| Broadcast acceptances can both win | One transaction counts places |
| Latitude and longitude dropped at check-in | Stored as given, and absent means "not given" |
| Job-level check-in | Per cleaner |
| Two status vocabularies | One list per thing in `statuses.ts` |
| Offers behind a default-off switch | Per-action permission levels, starting on Propose |
| "…so the office can release your payout" | "Submitted for review." Nothing implies approval or payment |

None of Novara's numbers were copied. Selestial's defaults are in `settings.ts` and `policy.ts` and are
each company's to change.
