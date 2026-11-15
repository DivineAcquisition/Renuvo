# Dispatch: what was verified, and what was not

No real text was sent, nobody was charged or paid, and nothing was deployed. Tests use synthetic records
and the mock text provider.

## Automated tests (`npm test`)

`convex/dispatchFlow.test.ts` and `convex/dispatchDay.test.ts` run the real functions in `convex-test`.

| Scenario from the brief | Test |
|---|---|
| A one-cleaner job is staffed | "staffs a one-cleaner job…" |
| A multi-cleaner job stays partial until all places are accepted | "keeps a two-cleaner job partially staffed…" |
| Simultaneous acceptances cannot overfill | "lets only one of two simultaneous acceptances take the last place" |
| A cleaner cannot accept conflicting work | "refuses an acceptance that conflicts…" |
| Expired or revoked links do nothing | "stops an expired or revoked link…" |
| A decline advances or escalates by policy | "moves on or asks first after a decline…" |
| A delivery failure is not silence | "does not count a failed delivery as the cleaner's silence" |
| Reassignment keeps context, withdraws old access | "reassigns after a cleaner drops…" |
| A delay identifies downstream work | "tells a communicated delay from silence…" |
| Completion is not approval or payout | "goes from the offer text to the owner's review queue…" |
| Tenant boundaries hold | "keeps one company's records and links out of another's reach" |
| Retries do not duplicate | "retries a text…", "runs the same workflow step and the same tool call twice…" |
| Nobody can cover | "marks coverage unresolved…" |
| Not checked in is not a no-show | "does not call a missing check-in a no-show…" |
| Pause | "stops new autonomous actions when Dispatch is paused, and nothing else" |
| Tools cannot bypass hard rules | "does not let a tool offer a job to a cleaner who fails a hard requirement" |

The earlier suite (`convex/dispatch.test.ts`, `assignments.test.ts`) still passes. Two of its expectations
changed on purpose: the next offer after a decline is now its own permission.

One limit of these tests: `convex-test` runs mutations one after another. The simultaneous-acceptance test
proves the second acceptance re-reads and is refused; that two truly concurrent transactions cannot both
commit rests on Convex's serializable mutations, which is the platform's guarantee and was not load-tested.

## The pages, in a real browser

`tests/e2e/cleaner-pages.mjs` drives the actual pages at phone size against a **local** Convex backend
(the one `convex dev` runs with no account), with real file uploads to local storage. 28 checks: offer
text → offer page (fetching and reloading it accepts nothing) → accept → job page with the address →
check-in with position → before photo → checklist (done, skipped with reason, photo-required) → add-on
request → after photo → "Submitted for review" → the owner's review queue; then decline, delay, cannot
attend, a spent link, a made-up link and a revoked link. Screenshots: `docs/screenshots/dispatch/`.

To run it (never against a real deployment: the script removes `CONVEX_DEPLOY_KEY` from its own environment):

```
env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous npx convex dev      # local backend, leave running
npx convex env set ACTION_LINK_SECRET <any 32+ characters>
npx convex env set MESSAGING_PROVIDER mock
npx convex env set LINK_ORIGIN http://localhost:3100
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.selestial.test
npx next dev -p 3100
node tests/e2e/cleaner-pages.mjs
```

It is not part of `npm test`: it needs a running backend and a browser.

## Not verified

- **A real text provider.** No Telnyx call, no webhook endpoint, no real delivery report. `messaging.receipt`
  is the function a webhook will call; the HTTP route and signature check are not written.
- **A real phone.** The pages were driven in desktop Chromium at phone size. Camera capture, iOS Safari
  and a poor connection were not tried.
- **Real concurrency and load**, as above.
- **The schedules running on their own.** Each scheduled function was called directly in tests. The cron
  entries exist in `convex/crons.ts` and were accepted by a local backend, but were not left to run.
- **A model.** No AI is connected; the tools were called directly.

## Remaining work

1. The six owner screens (deliberately deferred). Their queries and actions exist.
2. Telnyx: the provider, the delivery webhook, opt-out (STOP) handling and sender registration.
3. The model loop over the tools: reading replies, summaries, drafting, proposing the next tool.
4. Texts to customers. Today every customer update is a draft in Customer Care's queue for a person.
5. Travel time between properties. Today "travel" is only the company's time between jobs.
6. Checklist templates per service type. Today a person sets each job's checklist.
7. Closing a visit on clean evidence (`dispatch.close_visit`), which is Quality's review once it exists.
8. Extra verification on sensitive link actions, and rate limits on the link endpoints.
9. Day-before confirmation with the customer; capacity reports to Sales and Recruiter.
10. Inbound texts ("running late" typed as a reply) need the model and the provider.

Set on the Convex deployment before any of this can run for real: `ACTION_LINK_SECRET`, `LINK_ORIGIN`
(the host the link pages are served on, planned as `https://link.selestial.io`; it falls back to `SITE_ORIGIN`),
`MESSAGING_PROVIDER`.
