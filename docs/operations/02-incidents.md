# Incidents and monitoring checks

Code: `convex/lib/operations/` (catalog, detectors, incidents, schema) and `convex/operations.ts`.
Tests: `convex/operations.test.ts`.

## What an incident is

A problem someone has to track, not every error. One row per condition, named by a **key** (for example
`mailbox_reconnect:<connection id>`, or `message_unconfirmed:<company id>` for all of a company's uncertain
messages). It records:

| Field | Meaning |
|---|---|
| `companyId` | The affected company. Absent for a platform incident (Selestial or a provider). |
| `parentId` | A company incident that is part of a shared provider incident. |
| `kind`, `area`, `check` | What it is, which staff view shows it, which check finds it. |
| `impact`, `nextAction` | The business activity it blocks, and the next thing that should happen. |
| `severity`, `state` | See below. |
| `related` | The records that show it (up to 25), each one re-read before it can resolve. |
| `occurrences`, `recoveryAttempts` | How many records show it now; retries seen on those records. |
| `firstSeenAt`, `lastSeenAt`, `lastCheckedAt` | When it began, was last found, was last confirmed. |
| `assignedTo` | The staff member working it. |
| `resolvedAt`, `resolvedBy`, `resolution`, `evidence` | How it ended and what showed it ended. |

`incidentUpdates` keeps its history: opened, reopened, state and severity changes, recovery attempts seen,
grouping, assignment, notes, resolution. A run that finds nothing new writes nothing.

## States

| State | Means | Who acts next |
|---|---|---|
| investigating | Found; the provider or Selestial is still retrying | Selestial (automatic) |
| recovering | An automatic recovery is running for it, on the record's own evidence (a retry scheduled, a receipt awaited) | Selestial (automatic) |
| waiting_owner | The owner's move: reconnect, correct details | Owner |
| waiting_provider | The provider's move: carriers reviewing a suspension | Provider |
| needs_staff | Automatic recovery is done or stopped; a person must act | Selestial staff |
| resolved | Its records were checked again and none shows the condition | Nobody |

A group of records takes the state that most needs a person. Severity is the worst of its records; a shared
provider incident is one step more serious than its companies'.

## Resolution

- **Verified, not clicked.** When a check no longer finds an open incident, it re-reads every record the
  incident names with the same test that found it. Only if none still shows the condition is it resolved,
  with the time and number of records checked as evidence. Retrying something does not resolve anything;
  the next check does, once the retry worked.
- **Re-check now** (staff) runs that verification immediately after a fix.
- **Resolve by hand** is refused while the condition is still there, except for kinds whose record ends in
  a final state (`agent_task_failed`, `google_job_failed`, `texting_failed`): a failed job stays failed, so
  staff close those with a written reason, recorded as the evidence with their name.
- **Reopen.** The same key found again within 24 hours of being resolved reopens the same incident.
- **Shared incidents.** Three or more companies with the same provider and kind, all seen in the last
  30 minutes and opened in the last 2 hours, are grouped under one platform `provider_outage`. Each company
  keeps its own incident and impact. Waiting-for-owner incidents (an expired authorization) are never
  grouped: each company's reconnect is its own. The shared one resolves when none of its companies' is open.

## The checks

One cron (`operations checks find and verify incidents`, every 5 minutes) starts each check whose interval
has passed, each in its own transaction. Every check reads through an index with a bound, calls no provider
and no model, and tells normal waiting apart from failure.

| Check | Every | Finds | Not an incident |
|---|---|---|---|
| agent_work | 5 min | A step whose lease ended 20+ min ago (the activation sweep retries after 30 s); work that failed after its retries in the last 7 days | A lease that ended moments ago |
| chat_runs | 5 min | A chat response still running or queued with no heartbeat for 15 min (the chat sweep closes them at 3) | A response waiting for approval or input |
| uncertain_messages | 10 min | Business messages marked `unconfirmed`, one incident per company; recovering for the first hour (a delivery report settles it), then needs staff | Member notices (own check) |
| owner_notices | 15 min | 3+ failed notices to one member in a day with none delivered since | One bounce |
| stuck_sends | 5 min | Any message still `sending` after 20 min: the stuck-send job has stopped | — |
| inbound_processing | 5 min | 3+ provider callbacks to one route that verified but failed to process in 30 min; needs staff at 10 | Callbacks with bad signatures (rejected 401, not ours to fix) |
| mailboxes | 10 min | An expired inbox (owner reconnects); reads failing 3+ times (recovering), 6+ or `error` (needs staff) | A mailbox a person disconnected |
| google | 10 min | Expired Google connections; failed jobs (7 days); writes uncertain for an hour | A write uncertain for less than an hour (reconciled by key) |
| connectors | 15 min | Expired Jobber or Housecall Pro connections | — |
| texting | 15 min | Needs the owner (correction, code, number); interrupted by carriers; failed; provisioning stalled 2 h with nothing running; registration unchecked for 12 h; campaign approved an hour ago with no number attached | Waiting for the carriers' review while it is being checked |
| ai_billing | 10 min | AI charges `unverified` after every retry (per company); settlements due an hour ago (platform: the sweep stopped) | Settlements waiting on their backoff |
| messaging_billing | 10 min | The same, for messaging charges | Same |
| messaging_attention | 10 min | Open `messagingAttention` items (overdraft floor, inbound spike) | — |

## Monitoring the monitoring

`monitorChecks` records when each check last started and last finished. The overview shows each check as:

- **ok**: finished within three of its intervals;
- **stale**: has not finished for three intervals (the cron or the scheduler stopped);
- **failing**: started more than 10 minutes after its last finish (it throws, so nothing it did is kept);
- **never run**.

`monitoringHealthy` is false unless every check is ok, so a quiet overview is never mistaken for a healthy one.

## What is never stored

No secrets, tokens, message bodies or full addresses. Mailbox and member addresses are masked
(`j•••@alpha.example`). A webhook failure keeps its path and the first line of the error, never the request.
Incidents are Selestial's records about the service, so they are not in a company's data export (the
company's own records and events are).
