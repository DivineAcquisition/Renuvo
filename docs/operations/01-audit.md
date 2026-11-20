# Operations audit: what exists, and what this work adds

Audited November 20, 2026 against the code on `main` (after #123, business texting). Decisions are in
[00-decisions.md](00-decisions.md); the incident model is in [02-incidents.md](02-incidents.md).

The short version: Selestial already recovers well from most failures. Each subsystem has a bounded,
idempotent sweep that fixes or honestly marks what it can. What is missing is **one place where those
outcomes are seen together**, a record of problems that persist, and a way to tell when a recovery job
itself has stopped. This work builds that layer on top of the existing sweeps. It does not add a second
retry system.

## What exists

| Area | Records | Automatic recovery already in place | Gap |
|---|---|---|---|
| Staff console | `staff` (admin, reviewer), `/staff/*` pages: requests, trust, companies, setup funnel, texting, messaging money, agent requests, people, AI models | n/a | No operations view; staff have no access to any company's records (by design until support sessions, Phase 2) |
| Staff authorization | `staffQuery` / `staffMutation` in `convex/lib/builders.ts`; non-staff get "Not found." | n/a | Two roles only; no per-capability grants (Phase 2) |
| Agent first work | `activations`, `activationTasks` with `leaseUntil`, `attempts` | `activation.sweep` every 5 min retries a step 30 s after its lease runs out, then fails it | Nothing notices if the sweep itself stops; failed tasks are seen only by the owner |
| Company Chat runs | `chatRuns` with `heartbeatAt` | `chatRuns.sweep` every 2 min closes runs silent for 3 min | Same: no signal if the sweep stops |
| Agent tasks and takeover | `tasks` (`withPersonSince` = a person holds it), `approvals`, `toolRuns` (idempotency keys) | `approvals.expireDue` every 15 min | Takeover is per task; no conversation-level takeover control (Phase 4) |
| Messaging outbox | `messages` (`dedupeKey`, `status`, `attempts`, `holdReason`), `providerReceipts` (dedupe by event id, early receipts kept) | `messaging.sweepStuck` every 5 min marks a send that never finished `unconfirmed` and never resends it | Unconfirmed messages are not surfaced anywhere for follow-up |
| Inbound | `inboundMessages`; webhooks through `providerWebhook` | Providers retry on a 500 | A callback that verifies but throws left no record at all |
| Owner notifications | `memberNotices` (in-app), `member_notice` messages (email), `lib/notify` catalog, preferences, digest, unsubscribe | Suppression after bounces (`lib/notify/delivery.ts`) | Repeated failures to reach an owner are not seen by staff |
| Telnyx texting | `textingSetups`, `textingRequests` (status, `needs`, `diagnostics`, `leaseUntil`, attempt timestamps for create calls), `telnyxEvents` | `texting.reconcile` every 30 min reads quiet registrations back; `checkAllActive` daily | Stalled provisioning and "approved but number not attached" are only visible on the Texting staff page |
| Gmail / Outlook inboxes | `mailboxConnections` (`status`, `failures`, `syncLeaseUntil`, `watchExpiresAt`) | Inbox sweeps every 10 min; watches renewed daily; `inbox_reconnect` owner notice | No cross-company view of expired or failing inboxes |
| Google tools | `googleConnections`, `googleJobs` (`uncertain` reconciled by key before retry) | `googleWork.tick` every minute | Failed and long-uncertain jobs are not surfaced |
| Jobber / Housecall Pro | `connectorConnections` (`expired`) | n/a | Not surfaced |
| AI credits (Autumn) | `aiExecutions` (`settlement`, `settleAttempts`, backoff, `unverified` when retries run out) | `billing.sweep` every 5 min | `unverified` settlements need a person and nothing tells one |
| Messaging money | `messagingCharges`, `messagingTopUps`, `messagingAttention` (staff items: overdraft floor, inbound spike) | `messagingBilling.sweep` every 5 min | `messagingAttention` is the only existing staff attention queue; now mirrored into incidents |
| Pause controls | `companies.pausedAgents` (owner), `companies.suspendedAt` (staff); both checked in `lib/messaging/policy.ts` at send time | n/a | No staff UI to suspend, no reason or actor recorded on suspension (Phase 4) |
| Audit history | `events` (append-only, guard-tested), `trustChanges` | n/a | Events have no `staff` actor kind yet (Phase 2) |
| Deployment | `scripts/build.mjs`: only Vercel production deploys the live Convex backend | n/a | Previews read the live backend (Phase 4: point them at the test backend) |
| Billing isolation | Autumn's environment is taken from the key (`am_sk_test_` → sandbox) and stored on every billing row | n/a | Telnyx and Resend have no equivalent test guard (Phase 4) |
| Backups | None in the repository | n/a | No runbook or rehearsal (Phase 4) |

Owner notices are already free of the messaging balance: `member_notice` is in the included purposes
(`lib/messagingBilling/classify.ts`). Phase 3 keeps it that way for every new operational notice.

## Outdated notes found

- `docs/ai/02-status.md` step 6 says "Run `npx convex deploy`". Since the deployment split
  (`docs/foundation/06-deployments.md`), the live backend is deployed only by Vercel's production build.
  The deployment doc already says so; the status note is a description of what a deploy does.
- `docs/foundation/04-trust.md` and `convex/lib/trust/staffSchema.ts` say "being staff gives no access to
  company records". True today. Phase 2 (support sessions) changes it on purpose; both, and the public
  trust pages, are updated in that phase, not before.

## What Phase 1 adds

- `incidents`, `incidentUpdates`, `monitorChecks`, `opsSignals` (`convex/lib/operations/schema.ts`).
- Thirteen checks (`convex/lib/operations/detectors.ts`), run by one cron every 5 minutes, each on its own
  interval and in its own transaction.
- Deduplication by key, reopening within a day, verified resolution, and grouping of one provider failing
  for several companies (`convex/lib/operations/incidents.ts`).
- Staff reads and actions (`convex/operations.ts`): overview, list by area, incident detail, assign, note,
  re-check now, and resolve by hand only where the source record ends in a final state.
- `providerWebhook` now records a verified callback that throws (path and the error's first line only) and
  answers 500, so the provider still retries.
- Status indexes on `mailboxConnections`, `googleConnections`, `connectorConnections`, and a
  `by_state_updated` index on `activationTasks`, so no check scans a table.

## What Phase 2 adds

- The staff Operations workspace (`/staff/operations`): Overview, Needs attention, Agent work,
  Communications, Connections, Billing and Activity, with an incident side panel (history, records,
  diagnostics; take, note, check again, resolve, open the company workspace) and each check's freshness.
- Admin Support Sessions ([03-support-sessions.md](03-support-sessions.md)): staff roles `admin`,
  `support`, `reviewer` and per-person capability grants; sessions enforced in the company builders;
  the Selestial Support member; hidden message content; Settings › Support access for the owner.
- Existing staff functions that predate the capability catalog (for example
  `messagingFunds` balance adjustments and `compliance.setSuspended`) still check only that the caller is
  staff. Phase 4 gates them with `billing.adjust` and an emergency-suspension capability.

## What Phase 3 adds

Owner recovery cards on Home and beside the affected work, notices to the company (in the app, and one
email per problem when the Owner must act or an interruption is critical), grouped staff alert email, and
a Contact support handoff ([04-owner-recovery.md](04-owner-recovery.md)).

## Not yet built

Pause, takeover, suspension and
safe-retry controls, preview isolation, and the backup runbook (Phase 4). Nothing has been deployed.
