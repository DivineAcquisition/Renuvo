# Cleaners: the workforce workspace

**Status: Phase 1 of 4 built (November 17, 2026).** Phase 1 is the shared workforce record, the overview,
the directory, profiles, role-aware access and adding or importing workers with a duplicate review.
Onboarding requirements, the cleaner portal, Dispatch integration of crews, performance and coaching are
Phases 2 to 4. What each phase verified is in [`01-verification.md`](01-verification.md).

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
| Onboarding progress | Computed (`convex/lib/workforce/readiness.ts`); configurable requirements arrive in Phase 2 | — |
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

## Not built yet

Each of these is labelled "not built yet" on screen.

- Phase 2: configurable onboarding templates by worker type, with each requirement's review state
  (not started, submitted, awaiting review, accepted, needs changes, expired) and what it blocks;
  documents with expiry; the mobile cleaner portal and its sign-in; onboarding reminders; a Recruiter
  hire that matches an existing worker instead of creating a second record.
- Phase 3: date-specific availability exceptions, travel limits, confirmed qualifications, temporary
  teams, crew recommendations, subcontractor lead access, upcoming-job impact previews for every change.
- Phase 4: performance measures, the explainable score, coaching, idle-worker check-ins, agent action
  cards and Chat actions for the workspace.
- Finance: approved earnings, adjustments and payments.
