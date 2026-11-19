# Retention: what was verified, and how

Verified with controlled test data against the real backend functions (`convex-test`), never against a
customer's records. `convex/retentionAgent.test.ts` holds the scenarios; `tests/retentionHarness.ts`
builds the company. Run with `npx vitest run convex/retentionAgent.test.ts`.

| Scenario | What the test shows |
| --- | --- |
| Feedback → case → proposed action → approval → Dispatch handoff → verification | One flow end to end: a five-star rating with a described issue still opens a case; the correction is proposed with its cost, booked only on approval, handed to Dispatch, and the case closes only when the customer confirms. |
| Repeated complaints across visits | The second report is recognised as a repeat (a fact), one signal is raised, and the history says the first correction was never completed. |
| Duplicate feedback submissions | Three submissions, one record, one case. A person recording the same visit joins the open case. |
| Active plan without a schedule | One high-priority signal however often the records are read; cleared when a visit is booked. |
| Paid, with no service | Raised as high priority; a Manager cannot approve the refund; the Owner's approval hands it to Finance and moves no money. |
| Service pause while billing remains active | The preview and the result both say billing was not paused; the open invoice is untouched and raised. |
| One-time completion mistaken for churn | 120 days later: no signal, not a re-engagement candidate, feedback request closed as "no response". |
| Seasonal short-term rental inactivity | 90 days with no turnover: no signal. |
| Multiple properties with different statuses | One paused and two served properties: the account stays active, each site has its own status. |
| Unavailable correction slots | No visit is proposed or promised; Dispatch is asked. An approved visit whose time filled is not booked. |
| Insufficient messaging funds | Selestial has no messaging balance. Tested instead: a sender that is not ready leaves the message unsent and the case says so; with no AI credits the rules read and nothing is charged. |
| Human takeover | A held conversation stops the agent's message; taking a case over withdraws its drafts. |
| Expired customer links | Shows nothing private and refuses every change. A tampered token opens nothing. |
| Tenant isolation | Another company's member gets "Not found." from every function, and an empty workspace. |
| Repeated jobs and webhooks | A completion run again, a text delivered twice, and two sweeps in one window each do the work once. |
| Recovery completed without customer confirmation | Closed as "correction completed, not confirmed", never as confirmed. |

Also covered: serious concerns go to a person with no remedy; spending limits; a stale approval is not
carried out; a link is limited to its purpose; Retention paused does nothing and resumes; renewals from
real agreement dates; measures with denominators; a customer's text cannot instruct the AI reader.

The whole suite: 100 files, 1,100 tests passing (1,070 before this work, plus 30).

## Screens

`docs/screenshots/retention/` was made from a temporary, uncommitted preview page that rendered the real
components over what the real queries returned for a sample company ("Brightside Cleaning Co.") built
through the same harness. Chromium at 1440 wide and at 390 wide. No Convex backend could be run locally
in this environment, so the screens were not exercised against a live deployment.

## Not verified

- A live deployment: schema push, the cron, and real text and email delivery.
- The Claude reader against the live API.
- Company Chat choosing Retention's tools in a real conversation (the tools themselves are the tested functions).
