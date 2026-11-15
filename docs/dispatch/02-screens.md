# Dispatch: navigation and screen data contracts

Operations → Dispatch opens the overview. Its dropdown: Dispatch Board, Schedule, Offers & Coverage,
Live Jobs, Action Links, Playbook (already defined in `src/lib/app/navigation.ts`). Chat, activity,
permissions and agent controls belong to the agent workspace, not to more sidebar tabs.

**No visual screen is built.** Each screen below has the query it will read and the actions it will call.
Every query takes `companyId` and goes through the access builders. Unknown values are `null`.

| Screen | Reads | Actions |
|---|---|---|
| Overview | `dispatchViews.overview({from,to})` | links only |
| Dispatch Board | `dispatchViews.board({from,to})` | `assignments.offer`, `dispatch.takeOver`, `dispatch.handBack`, `approvals.decide` |
| Schedule | `dispatchViews.schedule({from,to})` | `jobs.reschedule`, `availability.*` |
| Offers & Coverage | `dispatchViews.offersAndCoverage({from,to})`, `dispatch.candidates({jobId})` | `assignments.offer`, `assignments.release`, `assignments.recordAnswer`, `dispatchOps.reissueLink` |
| Live Jobs | `dispatchViews.liveJobs({from,to})` | `dispatchOps.confirmNoShow`, `cleanerIsComing`, `decideReport`, `jobs.complete` |
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
