# Dispatch: states and permissions

## States

Each thing has its own list (`convex/lib/statuses.ts`). No list is derived from another.

**Job** `scheduled → in_progress → completed`, or `cancelled`. A cleaner's first check-in moves it to
`in_progress`. Only a person moves it to `completed`. `completionReportedAt` is a separate fact: the crew
said they are done.

**Assignment** `offered → accepted | declined | expired | cancelled`; `accepted → cancelled`.
A cancelled assignment says why (`endCause`):

| Cause | Meaning | Counts against asking the same cleaner again for this visit |
|---|---|---|
| `released` | A person took them off | yes |
| `dropped` | They said they cannot attend | yes |
| `no_show` | Declared after the contact steps | yes |
| `undelivered` | The offer text never reached them | yes, as "could not be reached", never as silence |
| `job_covered` | The last place was taken by someone else | no |
| `job_cancelled` | The job was cancelled | no |

**The day of service**, on an accepted assignment, each with its own time: `checkIn` (with position if the
phone gave one), `late` (ETA and reason), `contact` (how far the no-check-in steps have gone:
`contacted → operator_alerted → no_show_suspected`), `completion` (submitted, complete or incomplete).

**Message** `queued → sending → sent → delivered`, or `failed`, `unconfirmed`, `not_sent`.

**Action link** `active`, `expired`, `revoked` (worked out from `expiresAt` and `revokedAt`).

**Coverage request** `open → filled`, or `unresolved` (nobody could; a person has it), or `cancelled`.

**Board groups** are worked out, never stored (`boardGroup` in `dispatchViews.ts`):
needs staffing · awaiting approval · offers out · partially staffed · fully staffed · in progress ·
awaiting completion review · closed.

## The no-check-in steps

"Not checked in" is not a no-show. With the default policy, counted from the **end** of the arrival
window (or from the ETA the cleaner gave, if they gave one):

1. +10 min: the cleaner is texted a link to check in, send an ETA or say they cannot come.
2. +20 min: the operator is alerted with what is known, including whether that text was delivered.
3. +40 min: a no-show **may** be declared. Dispatch declares it only if `dispatch.declare_no_show` is on
   Execute **and** the text actually went. Otherwise it is marked suspected and a person confirms
   (`dispatchOps.confirmNoShow`), or records that the cleaner is coming (`cleanerIsComing`).

Declaring it ends the assignment, closes the cleaner's link, opens a coverage request and starts cover.
It records no consequence for the cleaner.

## Permissions

Every action has a level the Owner sets: Off, Propose, Execute and report, Execute
(`convex/lib/permissionCatalog.ts`). Anything a cleaner or customer sees starts on **Propose**.

| The brief's permission | Action key | Starts at |
|---|---|---|
| Send initial offers | `dispatch.request_acceptance` | Propose |
| Send replacement offers (after a no or no answer) | `dispatch.send_replacement_offer` | Propose |
| Run backup coverage (after a drop or no-show) | `dispatch.run_backup_coverage` | Propose |
| Broadcast | `dispatch.broadcast_offer`, and `broadcastEnabled` in the policy | Propose, and off |
| Reassign confirmed work | `dispatch.reassign_confirmed_visit` | Propose |
| Send customer updates | `dispatch.notify_running_late` | Propose |
| Request urgent hiring | `dispatch.request_urgent_hire` | Execute (it only opens a Recruiter task) |
| Apply schedule overrides | `dispatch.override_time_between_jobs` | Propose, and can never be raised |
| Reminders | `dispatch.send_reminder` | Propose |
| Declare a no-show | `dispatch.declare_no_show` | Propose |

Standard assignment and emergency cover have different permissions and different response windows
(`offerWindowMinutes` and `backupOfferWindowMinutes`). Both leave the same audit trail.

**Hard rules cannot be overridden by Dispatch.** A person offering by hand may set aside the service area,
the pay check and "already asked", and may set aside the time between jobs only by saying so, which the
event records (`personRules`). Nobody can offer time a cleaner has not said they can work, time off, an
overlapping job, a cleaner who is not ready, or a missing skill.

## Policy an Owner sets (`dispatchOps.setPolicy`)

`broadcastEnabled`, `broadcastSize`, `backupOfferWindowMinutes`, `reminderLeadMinutes`,
`contactAfterMinutes`, `alertAfterMinutes`, `noShowAfterMinutes`, `jobAccessGraceHours`,
`beforePhotosRequired`, `afterPhotosRequired`, `sendBeforePhotoLink`. Defaults and limits: `policy.ts`.
