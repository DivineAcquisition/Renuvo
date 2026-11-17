# Cleaners: the workforce workspace

**Status: Phases 1 and 2 of 4 built (November 17, 2026).** Phase 1 is the shared workforce record, the
overview, the directory, profiles, role-aware access and adding or importing workers with a duplicate
review. Phase 2 is onboarding requirements with review, documents, the cleaner portal with its sign-in,
Recruiter's onboarding reminders and the hire-to-worker link. Crews in Dispatch, performance and coaching
are Phases 3 and 4. What each phase verified is in [`01-verification.md`](01-verification.md).

The workspace answers six questions: who is ready to work, who is available for a particular job, who
needs attention, what is preventing someone from becoming ready, how each cleaner is performing, and what
Selestial is doing and what needs the owner's approval. Phase 1 answers the first four from the record.

## Boundaries

Cleaners owns the workforce directory and the ongoing relationship with each person. It reads the
shared record; it does not keep a second copy of anything.

| Workspace | Keeps | Cleaners shows |
|---|---|---|
| Recruiter | Applicants, screening, interviews, hiring offers | A hired person's record links to their application (`cleaners.applicationId`, `source: "hiring"`) and the onboarding handoff from the hire |
| Dispatch | Offers, assignments, coverage, the day of service | Upcoming and past work per person, and conflicts between accepted work and what the record now says |
| Agreements | Drafting, signing, versions | Workforce agreements linked to the person, for managers and the Owner |
| Finance | Earnings, payments (not built) | The pay arrangement and the pay each offer stated; never a payment record |

## Six things kept apart

A single "Active" flag never implies that every requirement is met.

| Concept | Where it lives | Who sets it |
|---|---|---|
| Relationship type | `cleaners.engagement`: employee, contractor, subcontracted | The Owner |
| Engagement status | `cleaners.status`: onboarding, ready (shown as **Active**), paused, ended | A manager or the Owner, with a reason for paused and ended |
| Onboarding progress | The company's requirements and each worker's review state (`onboardingRequirements`, `workerRequirements`) | The Owner sets requirements; managers review; the cleaner submits |
| Job eligibility | Computed: active and no unmet check that blocks assignments | — |
| Availability | `availabilityWindows`, `timeOff`, and work already held, asked for one stated window | The office, from what the cleaner said |
| Payout readiness | Finance's record, not built: shown as not tracked, never as ready or not ready | — |

## Readiness

`readinessOf(facts)` is a pure function. The directory, the profile, the attention list and the tests all
run it. Every check says what it blocks:

- **Blocks assignments**: marked active, a service area, weekly hours, a pay arrangement. Each of these is
  something Dispatch's own eligibility rules already refuse without (`convex/lib/dispatch/eligibility.ts`),
  so "ready" here and "can be offered" in Dispatch cannot disagree.
- **Good to know**: a mobile number, permission for work texts, skills, the supplying company's status, and
  items still outstanding from a hire's onboarding handoff. They change how work reaches a person, but stop
  nothing, and the screen says so.
- **The company's own requirements** (Phase 2) say for themselves whether they block assignments, block
  payment or are good to know. One that blocks assignments is read by Dispatch too: before ranking
  (`convex/lib/dispatch/facts.ts`) and again when an offer is accepted (`assignmentState.ts`).

"Ready for assignments" never means "available for every job": each job is still checked for skills,
area and time.

## The four counts

Each count is defined beside its number.

| Count | Definition |
|---|---|
| Ready for assignments | Active, with service areas, weekly hours and pay set. Dispatch can offer them work that fits. Not a promise they are free for any one job. |
| Onboarding in progress | Not yet made active by a person. Offered no work until then. |
| Needs attention | People with at least one verified attention item. |
| Working today | Accepted at least one visit today, on the company's clock. Not working today does not mean free. |

## Attention items

Built in code from the record (`convex/lib/workforce/facts.ts`). Each item explains the issue, names its
evidence (each piece opens the visit or the profile section), and leads to where it is fixed. Nothing in
the list was changed for the person.

| Kind | When |
|---|---|
| Conflict with accepted work | Time off now overlaps an accepted visit; two accepted visits overlap; or weekly hours no longer cover an accepted visit |
| Holds work while not active | A paused or ended person still holds accepted upcoming visits |
| Active but cannot be offered work | Active, with an unmet check that blocks assignments |
| Onboarding overdue | A hire's onboarding handoff is past its due date with items outstanding |
| Supplying company not active | The person's subcontractor is paused or ended while they are active or onboarding |

Phase 2 adds documents nearing expiry and availability needing confirmation. Phase 4 adds unanswered
check-ins and coaching awaiting review.

## Subcontractor companies

The company (`subcontractors`), its authorized contact (fields on that row, not a worker), and the people
it supplies (`cleaners` with `engagement: "subcontracted"`) are separate. A job is only ever assigned to a
named person. `workerAffiliations` keeps which company supplied each person and over what period; moving
a worker closes the open row and opens a new one, so history is never rewritten.

## Crews

`crews` and `crewMembers` hold permanent crews with one lead. Leaving a crew closes the membership row and
keeps it. Being on a crew says nothing about being free: a crew is always read through its members' own
readiness and availability. Temporary teams for one job, crew recommendations and Dispatch use of crews
are Phase 3.

## Access

Checked in Convex on every read and write (`convex/lib/workforce/access.ts`), never only by hiding part
of a screen.

| Who | May |
|---|---|
| Everyone in the company | Read the directory, contact details, skills, areas, availability, crews, jobs and readiness; record time off and weekly hours |
| Managers and the Owner | Add, import and edit workers; subcontractors; crews; engagement status and its reasons; personnel notes; hire onboarding items; workforce agreements |
| The Owner only | Pay, the Pay section, and the relationship type (classification) |

Readiness may say that pay is set; it never says what it is. The status reason is returned as `null` to
office staff, with a note that one exists. Chat's `get_record` already returns pay to the Owner only.

## Adding and importing

- **Add** (`workforce.add`) checks the person against everyone on record by normalized phone, email and
  name. A possible match returns the matches instead of adding anyone; adding anyway needs each match
  acknowledged. Nothing is merged. The browser's `addKey` makes a double submit one record.
- **Import** (`workforce.previewImport`, `workforce.commitImport`) reads a CSV in the browser, maps
  columns by their headers, and checks every row on the server: problems (no name, an unreadable worker
  type, an unknown or inactive subcontractor), matches with people on record, and matches with earlier
  rows in the same file. A blank worker type is filled only by the person's explicit choice. The commit
  checks every row again, refuses rows with problems, and requires "a different person" for every
  possible duplicate. The import's `key` makes the same import sent twice add nobody the second time.

Everyone added starts in onboarding.

## Navigation and deep links

- `/app/cleaners`: the workspace. The search, every filter, the view (cards or table), the availability
  window (`avail=date,from,to`) and the open quick-view panel (`cleaner=<id>`) live in the address, so
  opening and closing a profile never loses the list and a link can be shared.
- `/app/cleaners/[id]?section=<section>`: one person's page. Sections: overview, availability, onboarding,
  skills, performance, pay, activity. "Cleaners" leads back to the list exactly as it was left.

## Onboarding requirements (Phase 2)

The Owner sets the company's requirements (`convex/requirements.ts`), each with: what kind it is (a document
to upload, a statement to agree to, a signed agreement, payment setup, training, equipment, another step),
which worker types it applies to, what it blocks, whether a person reviews submissions, who may review or
set it aside (a manager, or the Owner only), how long an accepted document stays valid, and whether its
files are the Owner's alone (tax and payout). Starting points are offered; nothing is added until the Owner
chooses it.

Each worker's state on a requirement is one of: not started, submitted (started, not complete), awaiting
review, accepted, needs changes, expired. Expired is read from the clock. The rules:

- An upload is never a verification: a file always waits for a person.
- Viewing an agreement is never signing it: an agreement requirement is met only by a linked workforce
  agreement whose signing is complete in Agreements.
- Starting payment setup is never completing it: the cleaner can say they started; a person confirms it.
- Only the cleaner can agree to a statement, to the exact words in force. Changing the words is a new
  version, and an agreement to the old words no longer counts.
- Setting a requirement aside for one worker needs a reason, and is shown as set aside, never as accepted.
- Sending something back needs words the cleaner will see. Internal notes are never shown to them.

Files are stored privately (`workerDocuments`); their size and type are read from storage, never from the
caller. Managers and the Owner open them; an Owner-only file is the Owner's alone, and the others see only
that one exists.

## The cleaner portal (Phase 2)

`/c/portal/<token>`, on the link host, on a phone. Sign-in is the link plus a code (the decision recorded
on November 17: no accounts or passwords for cleaners, consistent with every other cleaner and applicant
link in Selestial).

- **The link** (`portalLinks`) is signed under its own words, so it never opens a job and a job link never
  opens it. It works for 14 days. A new invitation closes the earlier link and its sessions. Opening it
  changes nothing and shows only the company and a first name.
- **The code** is texted to the phone on the cleaner's record through the one send gate. It is worked out
  from the deployment's secret, the code row's id and a nonce, when it is sent and when it is checked: it is
  never stored, not even in the message body. It works for 10 minutes and 5 tries; 5 codes an hour.
- **The session** (`portalSessions`) is a random token kept on the phone; only its hash is stored. It lasts
  30 days. Pay needs a code confirmed in the last 15 minutes.
- **Access policy**: ending an engagement closes every link and session at once; a paused cleaner keeps
  their portal. The office can end access at any time.
- **What the cleaner can do**: work their onboarding (agree, upload a photo or file, say they started or
  finished), set the hours they can work, add or remove time away, open their accepted jobs and offers
  (through the existing job and offer links), see the pay each offer stated, and ask the office for help.
  Changing hours or adding time away never changes an accepted visit: the affected ones are listed back to
  the cleaner and appear under Needs attention for the office.
- **Invitation states** are shown as they are: being prepared, held, sent, delivered, not sent (with the
  send gate's reason), and acted on (a code was confirmed). Opening a link is never recorded.

When a text cannot go (no permission for work texts, no number, texting not set up), the office records
the permission the cleaner gave, or copies the link and gives it to them directly. The code still goes to
the phone on record: without texting, nobody can sign in, and the page says so.

## Onboarding reminders (Phase 2)

Recruiter sends them (brief, section 14), under the permission `recruiter.onboarding_reminder`, which
starts on Propose. A reminder is due after the company's days without progress (default 2 and 5; the
list's length is the most sent), counted from the invitation, the worker's own last submission, or the
last reminder. Before it is proposed, sent, or carried out after approval, everything is checked again:
the worker is onboarding or active, has items only they can do, has a working portal link, has no open
question for the office, and is under the company's limit; and it is inside Recruiter's sending hours.
Each reminder is named `onboarding.reminder:<worker>:<attempt>`, so the sweep, an approval and a person's
"Remind now" can never send it twice. When reminders run out, nothing happens to the person: silence is
never read as a refusal.

## A hire becomes one worker

When an accepted hiring offer is handed to onboarding, a worker already on record with the same phone or
email is linked to the hire instead of a second record being made (a name alone never links). A returning
worker whose engagement had ended goes back to onboarding; their history, pay and documents stay.

## Not built yet

Each of these is labelled "not built yet" on screen.

- Phase 3: date-specific availability exceptions, travel limits, confirmed qualifications, temporary
  teams, crew recommendations, subcontractor lead access, upcoming-job impact previews for every change.
- Phase 4: performance measures, the explainable score, coaching, idle-worker check-ins, agent action
  cards and Chat actions for the workspace.
- Finance: approved earnings, adjustments and payments.
- Email as a second channel for portal invitations and codes.
