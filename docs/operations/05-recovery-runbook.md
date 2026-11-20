# Backup, restore and rollback runbook

For a bad release, lost or damaged data, or a provider outage. Code: `convex/restoration.ts`,
`convex/lib/environment.ts`, `scripts/build.mjs`. Tests: `convex/environment.test.ts`.

## Targets for the launch stage

| | Target | Why |
|---|---|---|
| **Recovery point (RPO)** | 24 hours at most; less around risky releases | Convex Pro scheduled backups run daily. Take a manual backup before every release that changes the schema or migrates data. |
| **Recovery time (RTO), code** | 15 minutes | Vercel keeps every production deployment; promoting the last good one is instant. |
| **Recovery time (RTO), data** | 4 hours | Restore into a new deployment, verify, reconcile providers, then switch. Most of the time is reconciliation, which must not be rushed. |

Revisit both once there are paying customers at scale (hourly backups, a warm standby).

## What exists to recover from

- **Code:** every production deployment in Vercel (`selestial-ai`), rollback candidates marked.
- **Data:** Convex backups of the live deployment `terrific-avocet-835` (Dashboard › the deployment ›
  Backups): scheduled and manual, downloadable, and restorable into a deployment. The Convex CLI can also
  export (`npx convex export --path backup.zip`) and import (`npx convex import backup.zip`).
- **Providers keep their own record:** Telnyx (messages, numbers, brands, campaigns), Resend (emails),
  Stripe (company payments, Connect accounts), Autumn (plans, credits, top-ups), Google and Gmail. After a
  restore, those are the truth about what already happened outside.

**Check before relying on it:** the live deployment is labelled *Development* in the Convex dashboard (the
build log says `[Development] … terrific-avocet-835`). Confirm in the dashboard that scheduled backups are
turned on for it and how long they are kept; Convex's backup schedule options may differ for development
and production deployments.

## Rolling back code

1. Vercel › selestial-ai › Deployments › the last good production deployment › **Promote** (or *Instant
   Rollback*). The site is back in seconds.
2. The backend is not rolled back by that. If the bad release changed Convex functions, revert the commit
   on `main` (a new pull request); the production build redeploys the backend from it. Never deploy the
   live backend by hand.
3. **When a rollback is unsafe:** Convex rejects a push whose schema does not match the data. A release
   that added a required field, removed a table, narrowed a type or migrated rows cannot simply be
   reverted. For those releases:
   - make schema changes additive first (new optional fields, new tables), ship, migrate, and remove the
     old shape in a later release;
   - take a manual backup immediately before;
   - if it has to be undone, fix forward with a new release; restore data only as a last resort.

## Restoring data

A restore must never replay what already happened outside. Rows restored from a backup can say
"queued" or "sending" for messages that went out after the backup, "reserving" for charges Autumn
already took, or "provisioning" for a number Telnyx already sold.

### 1. Restore into an isolated deployment

1. Convex dashboard: create a new deployment in the project (for example `restore-2026-11-20`).
2. It is **not production by name** (`convex/lib/environment.ts`), so from its first moment it sends email
   and texts only to `TEST_RECIPIENTS`, refuses Telnyx purchases and filings, and ignores live Stripe and
   Autumn keys. Leave `TEST_RECIPIENTS` unset unless a person needs to receive test mail.
3. Deploy `main` to it (`npx convex deploy` with that deployment's own deploy key), then restore the backup
   into it (dashboard › Backups › Restore, or `npx convex import --replace backup.zip`).
4. Immediately lock it down:

   ```sh
   npx convex run restoration:lockDown '{"reason":"Restored from the 2026-11-20 03:00 backup"}'
   # repeat with the returned lockdownId and cursor until "done": true
   ```

   Every company's outbound sending is suspended and every agent paused, with each company's previous
   settings kept so release puts back exactly those.

### 2. Verify the restored records

```sh
npx convex run restoration:verify
npx convex run restoration:status
```

- `verify` counts every company table and samples rows for references to companies that are not there.
  `problems` must be empty. Compare the counts with the source (the live dashboard's Data page, or the
  backup's own table list).
- Spot-check a few companies end to end: members, customers, jobs and their assignments, invoices and
  payments, texting requests.

### 3. Reconcile provider state before anything runs

`status` lists what may disagree with the providers. Work each group against the provider's record:

| Restored rows | Check against | Then |
|---|---|---|
| Messages `queued`, `held`, `sending` | Telnyx and Resend logs, and Gmail Sent, after the backup time | Already sent: set the row to sent or delivered in the dashboard's data editor. Not sent: leave them, and note that they will be refused anyway if no longer relevant, since every message is checked again as it goes. |
| Messages `unconfirmed` | Same | Apply the provider's outcome. Never send again without knowing. |
| AI and messaging charges `pending_*`, `unverified` | Autumn usage and balances | Confirm or release each hold. Stripe and Autumn honor idempotency keys (Stripe for 24 hours), so retries with the original key are safe. |
| Texting requests `approved`, `provisioning`, `waiting_on_carriers` | Telnyx numbers, brands, campaigns | Telnyx declares no idempotency on these endpoints: look up by the saved order, brand and campaign references before any retry. |
| Google jobs `queued`, `running`, `uncertain` | The calendar, Drive or Ads object by its key | The worker reconciles uncertain writes by key before retrying. |
| Activation tasks, agent runs | Their outputs | Work that completed is not run again (idempotency keys and tool-run receipts). |

### 4. Switch over (only when the live deployment cannot be used)

1. Add the restored deployment's name to `PRODUCTION_DEPLOYMENTS` in both `convex/lib/environment.ts` and
   `scripts/build.mjs` (a test checks they match), and point Vercel's production `CONVEX_DEPLOY_KEY` and
   `NEXT_PUBLIC_CONVEX_URL` at it. Merge to `main`; the production build deploys it.
2. Copy the live deployment's environment variables to it (provider keys, `EMAIL_FROM`, origins). Point
   provider webhooks (Telnyx, Resend, Stripe, Autumn, Google) at its `convex.site` address.
3. Release the lock-down, saying what was reconciled:

   ```sh
   npx convex run restoration:release '{"lockdownId":"…","note":"Outbox reconciled with Telnyx and Resend; Autumn holds settled; numbers checked"}'
   ```

   Companies return to exactly the suspension and pause settings they had. Nothing that was refused while
   locked down is sent later.

## Rehearsal

Not performed from the development session that wrote this. The only deploy key available to it was the
**live** deployment's (`terrific-avocet-835`), and a rehearsal must never import into, or copy personal
data out of, the live deployment. To rehearse:

1. Create a throwaway deployment and give the person rehearsing its deploy key. **Unverified:** that
   the Convex plan allows an extra deployment, and that backups can be restored into a different deployment
   than they came from.
2. Restore the latest live backup into it (dashboard). **Unverified:** the backup's age, which shows the
   real RPO.
3. Run `lockDown`, `verify`, `status` as above, time each step, and note anything `status` lists.
4. Delete the throwaway deployment.

The commands themselves are tested (`convex/environment.test.ts`, "Restoring without replaying anything").
