# Company onboarding (setup)

**"Tell us enough about your company. Watch Selestial prepare useful work. Review what matters. Start operating."**

Status: Phase 1 merged (#110), Phase 2a merged (#116), Phases 2b to 5 in review (#118). Phase 5 built November 19, 2026; every phase is built. Each phase is marked here as it is built and verified.

## What was there before

Inspected on `main` at `2cbf867`.

- Onboarding was one form (company name, time zone, terms) in `src/components/app/gate.tsx`. It collected
  nothing else, so no collected data went unused and there was no partial progress to preserve.
- Reusable: Services & Pricing drafts, templates and the quote engine; agreement templates and drafts;
  booking experience drafts with a test preview; the cleaners CSV import; approvals that re-check at the
  moment of approval; per-action permissions with ceilings; `companyKnowledge`; Autumn executions with
  idempotent keys.
- Missing, and so new work in later phases: any website reader; a customer import; a jobs import; a setup
  checklist on Home; funnel measurement.
- Not built in the product: Retention's own workflow (it is listed only), and connectors for Jobber,
  Housecall Pro or BookingKoala. Setup says so and never pretends otherwise.

## Decisions

- **Who goes through it.** A company made from now on starts in setup, and its Owner is taken there until
  they open the workspace. A company made before has no setup row and is never sent through it; its Owner
  can choose to. Managers and Office staff are never sent through setup.
- **Leaving early.** "Save and exit" opens the workspace at any step. Setup is never a wall.
- **Where context lives.** Setup keeps only where the owner is and what they chose (`companySetups`). A fact
  with an owner goes there: the name and clock on the company, services in Services & Pricing, and so on.
  Everything else is a `companyFacts` row with its source and whether a person confirmed it. Chat's business
  context reads confirmed facts; a fact only found somewhere is never used as confirmed.
- **Areas served** are kept in the owner's words. Postal codes in business settings restrict booking, so
  setup does not write them.
- **Readiness** is read from the record (`lib/setup/readiness.ts`): built, plan, paused, connection,
  information, in that order. Finishing setup makes no agent ready.
- **Nothing is switched on by entering.** Entering the workspace changes no permission and starts no work. Only "Start my agents" (or "Start my first agent tasks" on Home) starts the reviewed batch, within the permissions already set (01-activation.md).

## Phases

| Phase | Delivers | State |
|---|---|---|
| 1 | Resumable guided flow, priority, adaptive questions, shared facts, readiness, responsive screens | Built |
| 2a | Website reader, client import, integration guidance, service, agreement and booking drafts | Merged (#116) |
| 2b | Jobber connection (OAuth), Housecall Pro key import | Built |
| 3 | First work per built agent, with prerequisite checks | Built |
| 4 | Exact-action review, authority, safe execution, "Your first work" | Built |
| 5 | Accessibility, recovery, invited users, existing companies, funnel measurement | Built |
| Activation | "Start my agents": durable background first work, real drafts, Home progress, in-app and email notices | Built (01-activation.md) |

## Decisions made by the Owner (November 18)

| Area | Decision |
|---|---|
| Website | Selestial's own bounded reader: up to ten pages of the owner's own site, safety limits, no logins. |
| Credits | The first completed read during setup is free; a failed or stopped read does not count. Reading another site is not offered in setup yet. |
| Retention | Prepare, never send, until Retention is built (Phase 3). |
| Leaving setup | Any step. |
| Imports | Spreadsheet import recognizing Jobber, Housecall Pro and BookingKoala exports. |
| Jobber | A real OAuth connection; the Owner registers the app and adds `JOBBER_CLIENT_ID` / `JOBBER_CLIENT_SECRET` (2b). |
| Housecall Pro | API key import for MAX-plan owners, plus the spreadsheet path (2b). |
| BookingKoala | Spreadsheet only, until its API is documented. |
| First batch | One review screen in setup across agents (Phase 4). |
| Delivery | One PR per phase. |

## Phase 5: verified

- **Accessibility**: axe (WCAG 2.1 A and AA) on every setup step for a Sales-first path, at 390 and 1440 wide,
  plus "Your first work", the Home checklist and Integrations. Every setup step now passes. Fixed: step labels
  and links used a brand shade that is pale lilac on white (the light theme flips the brand scale; brand-300
  is the readable violet in both themes), hint text on selected cards was 4.4:1, "Not given yet" was 2.8:1,
  and the Schedule, Approvals and "Ask Selestial" header buttons had no name on phones, where their words
  are hidden.
  Not changed, outside setup: the sidebar's department tabs are 4.48:1 (a shared token pairing used across
  the app). The preview's stand-in avatar also failed, but it is not what production renders.
- **Phone layout**: permission rows put the choice on its own full-width line instead of squeezing the
  action's name; the Integrations page no longer runs wider than a phone (cards now shrink to the screen).
- **Recovery**: already in place from Phase 1 and checked again: a save from another tab is refused with
  "Your setup was changed somewhere else… we have loaded the latest"; failed preparation keeps what was
  done and offers to prepare again; a failed read keeps completed drafts.
- **Invited staff**: never sent to setup; opening it says "Setup is the Owner's"; they can read "Your first
  work" and the work cards but not start runs, set authority, or close the checklist.
- **Existing companies**: never sent through setup. An Owner can choose it ("Go through setup"); it is now
  marked `optedIn`, so the funnel counts these apart from new companies.
- **Progressive setup inside the product**: a compact "Left from setup" checklist on Home for the Owner, at
  most four open items read from records (decisions waiting, what blocks the priority, drafts still to
  publish or open), gone for good when closed. Integrations lists Jobber and Housecall Pro as built, with
  their real state, and links to setup's import step (`/app/setup?step=records` opens that step).
- **Funnel measurement**: Staff › Setup funnel (`setupProgress.funnel`): of setups started in 7, 30 or 90
  days, how many reached each milestone and the median time from start, with first priorities. Counts only,
  no company names. An hourly sweep records the first decision and the first agent message as they happen,
  at their real times, without making the Owner's next save stale.
- **Gaps from earlier phases, closed**: an approved Sales message whose kind the Owner has since switched off
  (or that is a person's decision) is not sent (`sendAction` re-reads authority; a pause still holds it).
  Jobber and Housecall Pro no longer show as "planned".
- **Gaps that remain, and why**: Jobber's field names are confirmed only by the first real connection after
  the app is registered. Housecall Pro hasn't been run against a live account. There is no per-message
  sending charge to show. The website reader resolves an address before fetching it, so a name that changes
  what it points to in between is not fully excluded by this runtime.
- **Tests**: `convex/setupProgress.test.ts` (4): milestones recorded later at their real times without a
  stale save, the staff funnel (opted-in companies apart, no names, staff only), the Home checklist (Owner
  only, closes for good), Jobber and Housecall Pro states on Integrations. Plus a Sales test: an approved
  message of a kind switched off is not sent.

## Phase 4: verified

Built on what already exists rather than beside it.

- **The first batch** (setup's last step, "Before anything goes out"): Sales's own first review batch
  (`ReviewQueue`, `salesActions.decideBatch`). Each message shows its recipient, channel, exact words, quote
  and what sending it does, and can be sent as written, edited, or set aside. Each is checked again as it
  goes: still current, quote still the one on the deal, consent, do-not-contact, quiet hours and pause. Work
  other agents hold waits in Approvals, which re-checks on approval (Dispatch: open place, pay, rules;
  Retention: the evidence stamp). Setup links there with the real count.
- **Authority, separately**: "How much may <agent> do on its own?" lists the priority agent's actions with the
  existing `PermissionRow` ("Ask me first", "Act and notify me", "Act automatically"), never past an action's
  ceiling; money needs limits first; person-only decisions aren't permissions at all. Approving the batch
  changes none of it.
- **"Your first work"** (`/app/first-work`, `setup.firstWork`): where setup now lands. It shows the priority,
  what was prepared (setup's drafts and each agent's review that found something), what waits for a
  decision (Sales's first batch and pending approvals), messages agents actually sent since setup began, what
  still blocks the priority's agent, and one next step: decisions first, then the priority's own next step,
  then its first blocker. Every count is read from records; nothing is estimated.
- **Milestones**: entering the workspace now records the first decision on agent work and the first message
  an agent sent, from the events and messages themselves. Both were declared in Phase 1 and never set.
- **Cost**: nothing in the batch uses AI credits to send. Selestial has no per-message charge today, so none
  is shown; Retention's own money estimates appear on its actions where it has them.
- **Known gap, unchanged**: an approved Sales message does not re-read the agent's authority level at send
  time (the person's approval is the authority); pause, consent and freshness are re-checked.
- **Tests**: `convex/setupFirstWork.test.ts` (6): empty company, prepared drafts, decisions first in the next
  step, only agent messages that actually went out counted, milestones from what happened (and none when
  nothing happened), staff can read, company isolation.
- **Rendered**: the review step at 390 wide and "Your first work" at 390 and 1440, no page errors. Found while
  rendering: the blocker said "Prepare your first service" when setup had already drafted one; it now points
  at reviewing and publishing that draft.

## Phase 3: verified

- **What runs** (`lib/setup/work.ts`, `setupWork.ts`): reaching the prepare step starts one run per agent. Each
  is a persisted `setupWork` row, shown as "preparing" with what it is doing until it runs, then its result.
  Every run only reads the company's records: it sends nothing, offers no work, drafts no message and uses
  no credits. Starting again while a run is preparing starts nothing twice. Only the Owner starts runs;
  everyone in the company can see them.
- **Each result** says what was prepared, what it used, what is still open, the real records it points at
  (each with a link), and one next decision. Counts come from records read at that moment.
  - Sales: open inquiries, follow-ups that are due, inquiries with no next step, replies waiting for review,
    and whether it can quote firmly or only take quote requests.
  - Recruiter: hiring briefs and applications waiting. "Prepare a hiring brief" saves a brief from confirmed
    facts only, **paused**: it takes no applications until the Owner opens it, and pay is left for the Owner
    to approve as on any role.
  - Dispatch: visits in the next 14 days short of people, who could cover each (Dispatch's own ranking,
    shown as a proposal; no offer is made), and cleaners without weekly hours. It does not use Dispatch's
    coverage sweep, which can send offers at higher authority.
  - Retention (built on main in #119): clients whose last completed visit is over 45 days old with nothing
    booked, open concerns, and Retention's own open cases, pointing at its pages. Setup drafts and sends
    nothing; Retention follows up from its own page within the Owner's permissions.
- **States**: the work's own state (preparing, ready for review, waiting, failed) sits beside the agent's
  readiness, which it never replaces. An agent not on the plan or paused by the Owner gets no review, only
  the reason.
- **Tests**: `convex/setupWork.test.ts` (9): preparing state and no double start, honest empty states,
  Owner only and company isolation, Dispatch coverage without any assignment, approval, sales action or
  message being created, Retention's list, Sales counts, the paused hiring brief prepared once, and plan
  and pause gating.
- **Rendered** at 1440 and 390 wide with seeded records. Found while rendering: a long next-step button
  pushed the card past the phone's width (it now wraps), and Sales said "no published service" twice.
- **Changed wording**: Dispatch's priority card said "ask cleaners for the hours"; it now says it shows
  which cleaners haven't given their hours, since nothing is sent.

## Phase 2b: verified

- **Jobber** (`lib/connectors/jobber.ts`, `connectors.ts`, route `/oauth/jobber/callback`):
  - Off until `JOBBER_CLIENT_ID` and `JOBBER_CLIENT_SECRET` are set; the card then says it is not available and
    points to the export path. To switch it on, register an app in Jobber's Developer Center with the redirect
    address `<CONVEX_SITE_URL>/oauth/jobber/callback` and read access to clients and scheduling, and set both
    values on the Convex deployment. `MAILBOX_TOKEN_KEY` must be set too (tokens are sealed with it).
  - Only the Owner connects. The sign-in state is single-use, lasts ten minutes, and only its hash is kept.
  - Jobber rotates refresh tokens, so the new token is sealed and stored before anything is read.
  - Reads clients (archived left out), each client's first property, and visits in the next 60 days, through
    read-only GraphQL queries. Jobber's encoded ids are turned into the client number its exports show, so a
    client imported earlier from a Jobber spreadsheet is recognized.
  - Written against API version `2025-04-16`. The field names follow Jobber's public schema; the first real
    connection after registration is the check that they match. If they don't, the read fails with a plain
    message and nothing is imported.
- **Housecall Pro** (`lib/connectors/housecall.ts`): an Admin's API key (Housecall Pro offers its API on the MAX
  plan). The key is sealed at once, checked against `/company` in the background, and removed if refused.
  Reads customers, their service address and upcoming jobs (cancelled ones left out), with GET requests only.
- **Both:**
  - Up to 1,000 clients per read, as with a spreadsheet; more is said plainly. Upcoming visits become a
    schedule note on the client ("Not booked in Selestial"); no job is created and no cleaner is offered work.
  - The read is kept for a day for the owner to check, then deleted (or cleared sooner). Importing goes through
    `clientImports`, so duplicates, retries, "imported before" and "no permission to contact" work as for a file.
  - A credential the other system stops accepting is deleted and the card asks to connect again.
  - Disconnecting deletes the credential and the read at once. Jobber's own record of the app is removed in
    Jobber (Settings › Apps); the card says so.
  - Credentials and reads are kept out of the data export; the connection record is exported.
- **Tests**: `convex/connectors.test.ts` (12), against stand-ins for both systems: missing configuration, Owner
  only, token rotation and sealing, read-only requests, mapping, re-import finding the same clients, a client
  from an earlier Jobber spreadsheet recognized, single-use and expiring sign-in state, an ended authorization,
  company isolation, a refused key, and disconnecting.
- **Rendered** at 1440 and 390 wide: Jobber connected with a read ready, a refused Housecall Pro key, the check,
  and an import with one row refused for its email.
- **Not changed:** the Integrations page still lists Jobber and Housecall Pro as planned; pointing it at setup is
  left for Phase 5.

## Phase 2a: verified

- **Website reader** (`lib/setup/website.ts`, `setupWebsite.ts`):
  - Reads only a public site name: no IP addresses, internal names, ports or credentials. Each host is
    resolved through a public DNS-over-HTTPS service, and any private or reserved answer stops the read.
    Redirects are followed only within the same site, at most three.
  - Up to ten pages, chosen by what they are likely about (services, pricing, areas, contact, policies);
    login, cart and file links are skipped. Each page is capped in size and time.
  - Each page is recorded as it is read, so the screen shows real progress, and the read can be stopped.
  - Rules take plain statements (structured business data, contact links, "serving X, Y and Z", a
    policy sentence in the page's own words) and services named in headings, with any advertised price
    kept as the page's words, never as a price. The model, when available, may only suggest the same
    kinds of facts, each tied to a page that was read; code checks every one.
  - Everything found is saved as found, never confirmed. A different value for something the owner
    confirmed is kept as a conflict. Found values are offered beside the field and used only if chosen.
  - Residual risk, stated: the address is resolved before it is fetched, so a name that changes what it
    points to between the two checks is not fully excluded by this runtime.
- **Client import** (`lib/clients/importing.ts`, `clientImports.ts`): check first (problems, likely
  duplicates, already imported, repeated in the file), then commit in batches of 100 under fixed keys, so a
  retry imports nothing twice; an ID from the old system is remembered so importing the same export again
  finds it. A failed row does not stop the others and is reported with its reason. Imported contacts get no
  permission to be texted or emailed.
- **Drafts** (`setup.prepareService`, `prepareAgreement`, `prepareBooking`): through the workspace's own
  paths, once each. Template prices stay marked as examples; the agreement is a draft nobody has reviewed;
  the booking page says it cannot take bookings until a service is published.
- **Tests**: `convex/lib/setup/website.test.ts`, `convex/setupWebsite.test.ts` (a stand-in website: found not
  confirmed, conflicts, private addresses, redirects off the site, failed reads not counting, model output
  checked), `convex/clientImports.test.ts`, and draft preparation in `convex/setup.test.ts`.
- **Rendered** at 1440 and 390 wide: found suggestions on the basics step, the records step with a Jobber
  export (recognized, mapped, checked, imported), and the prepared drafts.
- **Found while rendering:** found website values were pre-filled into the fields, so continuing would have
  confirmed them without the owner choosing; they are now offered beside the field. A row with a bad email
  was counted as "left as it was" instead of "not imported".

## Phase 1: verified

- **Tests** (`convex/setup.test.ts`): a new company starts in setup, each step saves and resumes; an older
  tab is refused without overwriting; changing priority keeps earlier answers; questions outside the path
  are refused; "I'm not sure" is an answer; bad input writes nothing; clearing a fact removes it; staff and
  older companies are never required and cannot change it; another company's setup is "Not found."; entering
  the workspace changes no permission and is recorded once; each agent is ready only when what it needs
  exists and Retention is "Not available yet"; each question is asked once.
- **Rendered** at 1440 and 390 wide against a local backend: every step, resuming after a reload and on a
  second device, the preview panel, and the review step.
- **Found while rendering:** selected cards were dark with unreadable text; a missing plan was labelled
  "Connection needed" (it is now "Plan needed").
- **Milestones recorded so far:** setup started, context confirmed, workspace entered. The artifact and
  action milestones have fields and are set in later phases.

## Not done yet

- Recurring schedules from an import are kept as notes on the client; turning them into recurring plans
  needs a published service.
- Help is written guidance per question. Chat inside setup is not wired.
- Home has no "continue setup" entry yet; `/app/setup` is reachable directly (Phase 4).
