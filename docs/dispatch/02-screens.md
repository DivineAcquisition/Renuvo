# Dispatch: navigation and screen data contracts

Operations → Dispatch opens the overview. Its dropdown: Dispatch Board, Schedule, Offers & Coverage,
Live Jobs, Action Links, Playbook (already defined in `src/lib/app/navigation.ts`). Chat, activity,
permissions and agent controls belong to the agent workspace, not to more sidebar tabs.

**Built:** all of them — the overview, Dispatch Board, Schedule, Offers & Coverage, Live Jobs, Action
Links, Playbook, and the visit panel (`src/components/app/screens/dispatch/`, `detail-actions.tsx`). Every query takes `companyId` and goes through
the access builders. Unknown values are `null`.

| Screen | Reads | Actions |
|---|---|---|
| Overview | `dispatchViews.overview({from,to})` | links only |
| Dispatch Board | `dispatchViews.board({from,to})` | `assignments.offer`, `dispatch.takeOver`, `dispatch.handBack`, `approvals.decide` |
| Schedule | `dispatchViews.schedule({from,to})` | `jobs.reschedulePreview`, `jobs.reschedule`, `jobs.edit`, `availability.*` |
| Offers & Coverage | `dispatchViews.offersAndCoverage({from,to})`, `dispatch.candidates({jobId})` | `assignments.offer`, `assignments.release`, `assignments.recordAnswer`, `dispatchOps.reissueLink` |
| Live Jobs | `dispatchViews.liveJobs({from,to})` | `dispatchOps.confirmNoShow`, `cleanerIsComing`, `decideReport`, `jobs.reviewCompletion`, `jobs.closeWithoutReview` |
| Action Links | `dispatchViews.actionLinks({limit})` | `dispatchOps.revokeActionLink`, `reissueLink`, `revealActionLink` |
| Job record | `dispatchViews.jobRecord({jobId})`, `dispatchTools.forJob({jobId})` | all of the above, `dispatchOps.setChecklist` |
| Playbook | `dispatch.settings`, `dispatchOps.policy`, `permissions.list` | `dispatch.setSettings`, `dispatchOps.setPolicy`, `permissions.set` |

## Overview

Each number is a list of ids, so every summary links to its records: `needingCoverage`,
`awaitingApproval`, `partiallyStaffed`, `pendingOffers`, `activeDelays`, `notCheckedIn`,
`coverageSearches`, `awaitingHandoff`, and `tasks` (the agent's own work: next action, due time, open
question, trigger, escalation, and `handoffTo` for work passed to another queue). `paused` says whether
Dispatch is paused.

## A job row (board, schedule, live jobs, job record)

`status` (the job's own) · `startsAt`, `endsAt`, `arrivalEndsAt` (an arrival window is a span, never one
time) · `hardDeadlineAt` · `requiredCrew` and `acceptedCrew` (separate) · `openPlaces`, `offersOut`,
`hasLead` · `group` · `pendingApprovalIds` · `coverage[]` · `completionReportedAt` · `task` ·
`crew[]` (role, `checkedInAt`, `checkInHasPosition`, `late`, `contactStage`, `completion`) · `offers[]` ·
`ended[]` (with cause and reason).

## Schedule

`timezone` (every time is on the company's clock), `travelBufferMinutes`, the job rows, and per ready
cleaner: weekly `windows`, `timeOff`, and `commitments` (accepted and offered, with role).
Not there yet: travel time between properties (no geocoding exists), and expected duration is only the
job's own start and end.

## Live Jobs

Per crew member `arrival` is one of `not_due`, `due`, `checked_in`, `late_with_eta`, `not_checked_in`,
`cleaner_asked`, `operator_alerted`, `no_show_suspected`. A confirmed no-show is not a state of someone
on the crew: it is in `noShows`. Also `drops`, `affectedLaterJobs` for a late cleaner, checklist counts,
photo counts against what is required, open reports, and each text's delivery.

## Action Links and the job record

One row per link: `recipient`, `jobId`, `assignmentId`, `purpose`, `allowed`, `status`, `issuedAt`,
`expiresAt`, `revokedAt` and why, `messages` (each text that carried it, with what the provider
reported), `lastAction` and `lastActionAt`, `response`, `deadline`, `nextAction`.

`opened` is always `null`. Page views are not recorded, so the screen must say "not tracked", not "not
opened". A text's `delivered` means the provider confirmed the handset got it, and nothing more.

## Rules the screens and queries share

- **One staffing count.** `staffing()` and `coverageOf()` in `convex/lib/dispatch/crew.ts` are the only
  place required crew is compared with accepted crew. `dispatch.candidates`, `overview.*`, `details.get`,
  `jobs.*` and `dispatchViews.*` all read through them, and `convex/dispatchCore.test.ts` checks that a
  three-cleaner job reads the same at 1 of 3 and 2 of 3 on each.
- **The visit panel** opens from the address, `?open=job:<id>` (also `approval:` and `task:`), on any page
  under `/app`. It lists every accepted cleaner with their role and keeps offering available while any
  place is open. A cleaner already on the visit is not offered as a candidate for its other places.
- **Closing a visit.** There is no "mark complete". `jobs.reviewCompletion` (Owner or Manager) closes a
  visit the whole crew reported done, or sends it back, which clears the crew's reports so they can
  submit again. `jobs.closeWithoutReview` is the override: it needs a reason, stores
  `completionReview.decision = "closed_without_review"` and records `job.closed_without_review`. Neither
  touches money. Photos are counted in the panel; viewing them there is not built.
- **Moving a visit.** `jobs.reschedulePreview` says what the move does; `jobs.reschedule` does exactly
  that in one transaction and is refused if the visit changed since (`version`). Open offers are
  withdrawn, everyone who had accepted is asked again for the new time at the pay they accepted, and a
  cleaner who cannot work it is told and their place reopens. These assignments end with cause
  `job_moved`, which does not count against asking the same cleaner again.
- **Lists and totals.** The Dispatch Board loads visits a page at a time (`dispatchViews.boardPage`) and shows "N of total" from `dispatchViews.rangeTotal`, which counts from the index (exact up to 4,000, then "more than"). The other screens still read up to 200 visits and, when they reach that, say how many there are in all.
- **Crew pay** is the Owner's setting in Playbook (`dispatchPolicy.crewPayMode`, `leadPremiumPercent`):
  a cleaner on a share gets their share of the whole price (the default) or that share split across the
  cleaners the visit needs, with an optional lead premium. Pay is worked out for the role the offer
  carries and rounded once. Hourly pay is never split.
- **Checklist templates** (`checklistTemplates`) are versioned per service. A new visit copies the
  current version (`jobs.checklistTemplate` records which), so a change never alters a checklist a
  cleaner already has.
- **Live Jobs actions:** `dispatchOps.askCleaner` texts a cleaner who has not checked in, at most once a
  quarter hour. `dispatchOps.recordCannotAttend` records a drop-out a person was told about; it opens
  the place and cover exactly as the cleaner's own link would.
- **Photos** in the review are read through `dispatchViews.jobPhotos` (the company's own access check).
  The addresses are the stored files' own and do not expire; expiring addresses are still to do.

## Texting through Telnyx

`MESSAGING_PROVIDER=telnyx` with `TELNYX_API_KEY` sends real texts (`convex/lib/messaging/telnyx.ts`),
from the company's texting number, with an `Idempotency-Key` per message and the deployment's own
`/webhooks/telnyx` as each text's `webhook_url`. `/webhooks/telnyx` verifies Telnyx's Ed25519 signature
against `TELNYX_PUBLIC_KEY` and refuses anything older than five minutes. Delivery reports update the
message once per event. Incoming texts go through the same STOP / HELP / START handling; any other text
from a cleaner or customer on record becomes one task per number for a person to read. Nothing acts on
what a text says, and a text is never taken as an answer to an offer. Texts coming in arrive at the
number's messaging profile webhook, so the company's number needs a profile pointed at this deployment.

## Cleaner replies

A text to the company's number from a number that belongs to exactly one cleaner becomes a task for a
person, and is also read against that cleaner's own open offers and visits that have not ended
(`convex/dispatchReplies.ts`, reader in `convex/lib/dispatch/replyReader.ts`). The reader sees the
visits only as short labels (V1, V2…) and can name only one of them; the text sits inside tags and is
never an instruction. `DISPATCH_MODEL=claude` with `ANTHROPIC_API_KEY` uses Claude (structured JSON,
low effort, server-side refusal fallback); anything else, or any failure, uses the rules reader, which
answers only when one visit and the words leave no doubt.

The reading is checked against the record as it is now. A clear "running late" (with a time), "can't
come" or "no" to an offer is carried out by Dispatch only when the Owner sets "Act on a cleaner's text"
to Execute and report (it starts on Propose). Taking a job by text always needs a person. Anything
unclear changes nothing. A person applies or dismisses a reading on the reply task; applying runs the
same functions as the cleaner's link, so every check runs again. One number gets at most ten readings
an hour. The Claude reader has not been run against the live API in this build: no key was available.
