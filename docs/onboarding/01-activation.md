# Activation: from onboarding to agents doing real work

**The Owner picks a focus, confirms, presses "Start my agents", and leaves. The work runs on the server, makes real records in the workspace, and tells them when results are ready.**

Built November 19, 2026. This covers phases 3 and 4 of `00-plan.md` and parts of phase 5.

## Phase 1 audit: what was missing

Inspected on `main` at `6e61eac`.

| Connection | Before | Now |
|---|---|---|
| Setup → agent work | `setup.enter` recorded entering the workspace and started nothing. | `activation.start` plans and starts a bounded batch. `setup.enter` ("Save and exit") still starts nothing. |
| Focus → tasks | Priority was saved and only changed the questions asked. | `lib/activation/plan.ts` turns focus and records into concrete tasks. |
| Background execution | Website reads used the scheduler. There was no runner for first work. | Scheduler-driven steps, with leases, watchdogs, bounded retries and a cron sweep (below). |
| Outputs | Setup made service, agreement and booking drafts on click. | The same builders run in the background and reuse those drafts. |
| Progress | None. | `activationTasks` keeps state, a status line, real steps and outputs. Home reads them. |
| In-app notifications | None. Notices were email-only rows in `messages`. | `memberNotices`: per person, with read state. Shown in the header bell. |
| Email | No activation events. | `activation_result` and `activation_summary` notices, through the existing router, outbox and templates. |
| Existing owners | Could only go through setup again. | "Start my first agent tasks" on Home. |
| Hiring role draft | `hiringNeeds` had only open, paused and closed. | A `draft` status: never matched to applicants or invited for until the Owner opens it. |
| FAQ answers | The Playbook held approved answers only. | `proposedAnswers`: Sales ignores them until the Owner approves each one. |

## How it runs

`convex/activation.ts`, `convex/lib/activation/*`. It uses the same pieces the rest of Selestial uses: scheduler, keyed rows and a cron sweep. No new agent runner and no new component.

1. **Start** (`activation.start`, Owner only) is one transaction:
   - It writes the plan (`activations` and `activationTasks`) and schedules `tick`. Nothing external happens in it.
   - **Repeat starts find the same batch:** a running batch, or the same context version, is never started twice. That covers double-clicks, two tabs and resumed setup.
2. **tick** leases up to 3 queued tasks whose dependencies have settled, and schedules `execute` for each.
3. **execute** (an action) runs `step` as one mutation.
   - If the step throws, its writes roll back and `stepFailed` retries with backoff (30s, 60s), at most 3 attempts, then marks the task failed.
   - A half-made draft can't exist.
4. **Before every step** these are checked again:
   - the batch is still running;
   - the Owner who started it is still an active Owner (if not, the rest stops and nothing more is made);
   - the company isn't suspended;
   - the agent isn't paused and its plan includes it;
   - the records still need the work;
   - the credit ceiling won't be passed.
5. **Tasks waiting on an agent's own workflow** (Sales runs, Recruiter's inbox read, Retention's reconcile) are checked again by a scheduled `check` step, never by a browser. Each check is bounded by a deadline; after it, the agent's routine finishes the work.
6. **Abandoned work:**
   - `recover` fires at each lease's end.
   - The 5-minute cron `activation.sweep` retries steps whose worker stopped, ticks running batches, and re-checks blocked work.
7. **Blocked tasks resume** when something changes: `recordEvent` calls `wakeActivation` for events such as `mailbox.connected`, `clients.imported`, `opportunity.created`, `job.created`, cleaner changes, `company.agents_paused_changed` and plan or credit changes. Setup facts being confirmed also call it.
   - The re-check runs the plan's own rules, and no model.
   - A finished task is never restarted.
8. **Cancel** stops future work. What was made is kept, and each task says so.
9. **Settle:** when nothing is queued or working, the batch is `completed` or `partial`. That is noticed once.

Because the work is on the server, closing the browser stops nothing, and another device shows the same state.

## The plan

These are templates with deterministic gates. No model chooses work, prices, permissions or facts. Each task records:
- agent, objective, sources (counted), expected output;
- prerequisites (met or not), authority (the permission and its current level, in words);
- estimate, priority, dependencies, completion criteria.

At most 8 tasks per batch. An inquiry task works at most 10 inquiries, and a coverage task at most 25 visits; the agents' own routines pick up the rest.

| Focus | Primary tasks | Supporting |
|---|---|---|
| Get more bookings (`sales`) | Service draft (only if none is published), inquiry follow-through, booking page, proposed FAQ answers | Dispatch coverage check |
| Hire cleaners (`recruiter`) | Role draft with application form, applicant review in the hiring inbox | Dispatch coverage, readiness checklist |
| Stop chasing cleaners (`dispatch`) | Coverage review, readiness checklist | Role draft, only when nobody is ready or visits are uncovered |
| Keep more customers (`retention`) | Retention review (reconcile), feedback and recovery setup | — |
| `pricing` / `booking` | Service draft; booking page and agreement draft | Proposed answers, booking page |

A secondary priority adds one task, not every task its agent could do.

**Marketing, Quality and Business Development** are not built as agent workflows: Marketing and Quality are unreleased in the billing catalog, and BD isn't in it at all. The review says so, and nothing is planned or sent in their name.

### What each task really does

| Task | Uses | Never |
|---|---|---|
| Service draft | `createDraft` (Services & Pricing), template prices flagged as examples | Publishes, or sets a price as approved |
| Booking page | `createExperience`, flagged "takes no bookings until published with a live service" | Publishes |
| Agreement draft | `createAgreement`, flagged "nobody has reviewed these terms" | Sends for signature |
| Proposed answers | Confirmed facts only (areas, categories, contact) into `sales.proposedAnswers` | Becomes an approved answer without the Owner (`salesInquiries.decideProposedAnswer`) |
| Inquiry follow-through | `enqueueRun` (Sales' own workflow) for open inquiries due for Sales with no run going; counts `salesActions` | Sends beyond `routeAction` (first-batch review, permission levels) |
| Role draft | `draftNeed` (status `draft`), questions and person-reviewed criteria, pay unset | Opens the role, sets pay, invites anyone |
| Applicant review | `recruiterInbox.sync` on connected hiring inboxes; counts `applications` filed | Claims applicants without reading an authorized inbox |
| Coverage review | `coverJob` (Dispatch's authority, eligibility and offers) | Offers outside Dispatch's permission |
| Readiness checklist | One open `tasks` row per real gap (cleaners, availability, texting), reused by key | Messages a cleaner |
| Retention review | Retention `enqueueRun` reconcile; counts open signals and cases | Contacts a customer |
| Feedback and recovery | Reads retention settings; opens `tasks` for a missing guarantee or review link | Writes a guarantee for the Owner |

Every output is a real row, linked to where it opens. A task that found an existing draft reports `created: false` and leaves it exactly as the Owner left it, so a retry or a changed context never makes a second draft.

### Incomplete context

Each task is in one of these states:
- `queued`;
- `waiting_info`, with the smallest specific blocker (for example "There are no upcoming visits in the next two weeks… Add a visit");
- `waiting_connection` (for example "I prepared your hiring application. Connect your hiring inbox to identify applicants who should receive it.");
- `paused`;
- `unavailable` (not on the plan).

The review shows all of these before Start.

## Budget

Every planned task costs **0 AI credits**:
- drafts come from templates and confirmed answers;
- the manual Sales runs read no new customer message, so `sales_message_reading` is not opened;
- Retention's reconcile is rules;
- the Recruiter inbox read is its routine reading, charged per AI-read email exactly as the 10-minute check is.

The review says this, and says plainly that **no separate setup allowance exists** in the billing catalog. Whether to add one is an open product decision.

The ceiling is enforced anyway: a task with an estimate is stopped before it would pass `budget.ceilingCredits`, and the agents' own `openExecution` controls still apply. The detail view reads real charges back from `aiExecutions`.

## Notifications

- **In-app** (`memberNotices`):
  - Kinds: first result, asset created, approval required, task completed, needs information, needs connection, failed, and batch finished.
  - Recipients: Owners and Managers, one row each. Office staff get none.
  - Deduplicated per task and kind.
  - `notifications.inbox` returns only the caller's own rows, and drops a link whose record no longer belongs to the company. `markRead` refuses another person's notice.
- **Email**, through `notifyMembers` (preferences, night hours, suppression, dedupe):
  - `activation_result` goes 2 minutes after the first result, so results finishing close together share one email.
  - `activation_summary` goes when the batch settles. It isn't sent if the first email already covered everything and nothing is blocked or failed.
  - Both are written at send time from the records (`compose.ts`, `activationEmail`): actual outputs and states, decisions, blockers, and one button to the work behind sign-in.
  - No customer or applicant details are included.
  - They are member notices, so the company's messaging balance is never charged.
  - A failed email is its own `messages` row; the task is never touched.

## Ongoing routines

These are the agents' existing event triggers and reconciliation crons:
- a new inquiry leads to a Sales run, plus `salesAgent.sweep`;
- a hiring inbox is read every 10 minutes;
- `dispatch.sweep` runs every 15 minutes, and `coverJob` runs on job creation;
- `retentionWork.sweep` runs every 10 minutes, and runs on service completion.

Home's "What keeps running after this" lists each one, with its sending permission and whether the agent is paused, and links to pause it. No model runs over the whole database: changes are detected by events and indexes.

## Untrusted content

Imported records, websites and messages never grant authority:
- Plans read counts and confirmed facts.
- Facts found on a website are shown in the context as "found, not confirmed" and never used as facts.
- Every send goes through the agent's own permission, consent and policy checks at the moment it goes.

## Verified

`convex/activation.test.ts` (10 tests) runs on convex-test with mock text and email providers and the rules reader. Covered:

| Area | Scenarios |
|---|---|
| Starting | Double-click start; resumed or repeated start with the same context gives the same batch; a changed context gives a new batch with no duplicate drafts |
| Running | Background completion with fake time and no client; Owner-edited booking page reused untouched |
| Blocked work | Missing integration (exact blocker words), then resumed by connecting an inbox, re-checked once; missing inquiries resumed by a new inquiry |
| Failures | Bounded retries to failed, with nothing half-made; partial batch where one task fails and the others finish; retry; worker lease expiry recovered by the sweep |
| Authority and money | Revoked authority (the starter removed) stops the batch; cancel; credit ceiling |
| Isolation | Cross-company read, retry and cancel refused; manager versus office notices; another person's notice refused |
| Notifications | Notification delivery failure leaves tasks intact; first-result email held overnight, then delivered with real outputs, a link and no customer data |
| Other entry points | An existing Owner with no setup |
| Plan rules | Focus priority, bounded supporting work, paused and off-plan tasks |

Full suite: 106 files pass. Typecheck and lint are clean.

**Rendered:** the real components, at 1440 and 390 wide, with query results captured from the test scenario. `docs/screenshots/onboarding/activation-*.png` shows:
- setup's review step;
- Home mid-run and settled;
- the task detail;
- the bell;
- the start dialog for existing owners;
- routines;
- Playbook proposals.

## Not verified with real services

- **No real Resend, Telnyx, Gmail or model.** Every send went through the mock providers; the email path is the same outbox and templates as other notices.
- **No live Convex deployment, and no signed-in browser session.** Clerk wasn't available here, so screens were rendered from real query results rather than a live session.
- **Duplicate provider callbacks** rely on the existing outbox and receipt deduplication; activation itself never sends.
- **Readiness on setup** says "Plan needed" until billing has synced a plan. Activation treats an unknown plan the way `openExecution` does: the agent's own billing decides.

## Open product decisions

- A free setup allowance for AI work: none exists, so none is shown.
- Whether Managers should also get the activation emails. In-app, they get notices; by email, only the Owner does.
