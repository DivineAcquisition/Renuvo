# Selestial

The AI operating platform for cleaning companies. Four agents — Sales,
Recruiter, Dispatch and Retention — work inside one shared operating system.
The owner sets the standards. Selestial carries the work forward.

The source of truth is
[`docs/foundation/00-product-brief.md`](docs/foundation/00-product-brief.md).
The sidebar, the route map and the navigation rules are in
[`docs/foundation/01-navigation.md`](docs/foundation/01-navigation.md).

This repository and its Vercel project are still named Renuvo, which was the
working name.

## What is here

- The public landing page.
- **Sign-in with Clerk** and the signed-in app under `/app`: Home, Approvals,
  Schedule, Customers & Properties, Cleaners, Reports, Settings, and one shared
  detail panel for a visit, an approval or a task.
- **The sidebar**, drawn from one navigation definition: three departments
  (Growth, Operations, Team), eight agents and their work tabs. Unbuilt agents
  and tabs are listed, marked "Not built yet", and do not link anywhere.
- **The Convex backend**: companies and roles, customers and properties,
  cleaners and availability, jobs and assignments, tasks, permissions per
  action, approvals, an append-only event log.
- **Dispatch, the first agent**: it finds eligible cleaners for a visit, ranks
  them, proposes or sends the offer according to the owner's permission, tries
  the next cleaner on a decline or no answer, and hands the visit to a person
  when it cannot be covered. It is code only; no model is called.

Only Dispatch has a workflow. The other seven agents are not built, and four
of them (Marketing, Quality, Customer Care, Team Coordinator) do not exist in
the backend yet. There is no texting, so an offer is a record: someone
tells the cleaner, and the office records their answer.

## Setup

1. `npm install`
2. `cp .env.local.example .env.local`
3. `npm run dev` → http://localhost:3000

Before pushing: `npx eslint`, `npx tsc --noEmit`, `npm test`, `npm run build`.

### Early-access requests

The form saves to Convex (`convex/earlyAccess.ts`). It needs
`NEXT_PUBLIC_CONVEX_URL` on the web server and the same `PUBLIC_FORM_SECRET`
on both the web server and the Convex deployment. Until both are set, the form
tells the visitor that requests are not open. It never reports a request that
was not saved. One email keeps one row; one visitor can send five an hour.
Read them with `npx convex run earlyAccess:list` or in the Convex dashboard.

### Convex

`convex/_generated` is checked in. After changing the schema or adding a
function file, run `npx convex codegen` (needs `CONVEX_DEPLOY_KEY`; it does not
change what runs on the deployment). Tests run locally with `convex-test` and
need no deployment.

### Sign-in

Clerk signs people in; Convex checks every read and write again.

1. Web server: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
2. Clerk dashboard: turn on the Convex integration, so the session token is
   issued for Convex.
3. Convex deployment: `CLERK_JWT_ISSUER_DOMAIN`, the Clerk instance's issuer
   (`https://<name>.clerk.accounts.dev` in development). It is `none` until
   then, which means nobody can sign in.

A signed-in person with no company creates one (and becomes its Owner) or
joins one they were invited to by email.

## Rules the backend enforces

- **Every public function goes through `convex/lib/builders.ts`.**
  `convex/guard.test.ts` fails if any other file registers a query, mutation
  or action.
- **Another company's record is "Not found."**, the same as one that does not
  exist (`convex/isolation.test.ts`).
- **Roles.** Owner: everything. Manager: operations and approvals; no
  authority settings, pay or people. Office: customers, jobs, assignments and
  tasks.
- **One status list per thing** (`convex/lib/statuses.ts`). A job is covered
  only when a cleaner accepts an assignment. Nothing is inferred from payment,
  which is not built yet.
- **A cleaner's time is protected in code**: ready for work, has the skills,
  said they can work then, not on time off, not already holding that time.
- **Permissions are per action** (`convex/lib/permissionCatalog.ts`). Anything
  a customer, cleaner or applicant sees starts on Propose. Some things always
  need a person and are not settings.
- **Dispatch asks before it acts.** What it may do is read from the owner's
  permission each time. On Propose it puts one proposal in the queue, with
  exactly what approving authorizes; an approved proposal is re-checked before
  the offer goes out.
- **Every screen sentence comes from the record.** The briefing, the activity
  feed and the detail panel are built in code from events and records
  (`convex/overview.ts`, `convex/details.ts`, `convex/lib/eventWords.ts`).
  What is not connected says "not set up yet".
- **No sample data in the app.** There is no demo mode, no seeded company and
  no pre-filled form. A screen shows the company's record or says it is empty.
  An agent's "run" on a visit (`convex/lib/dispatch/run.ts`) is the steps it
  actually took, read from the record.
- **The event log is append-only.** Only `convex/lib/events.ts` writes to it.
- **Numbers come from code.** Money is whole cents; times are checked
  instants.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · coss UI on Base UI ·
Convex · Clerk · Vercel.

## Where things are

| Where | What |
|---|---|
| `src/lib/marketing/content.ts` | Every word on the public site |
| `src/components/marketing` | The page's sections and pictures |
| `src/app/globals.css` | Tokens. The owner's palette: Selestial Violet `#6838EF`, Deep Violet `#5126C7`, Cloud White page `#F8F9FC`, Deep Plum text `#211A35`. Light only on the public site |
| `src/components/ui` | Shared components |
| `src/lib/app/navigation.ts` | The one navigation definition: departments, agents, work tabs, paths, availability |
| `src/components/app/sidebar.tsx` | The sidebar, drawn from that definition |
| `src/components/app` | The signed-in app: shell, Overview pieces, detail panel, screens |
| `src/components/icons` | Phosphor icons, with the picks the Novara app uses |
| `convex/schema.ts` | The shared record |
| `convex/dispatch.ts`, `convex/lib/dispatch` | Dispatch: eligibility, ranking, pay, the cover workflow |
| `convex/overview.ts`, `convex/details.ts` | What the Overview and the detail panel read |
| `convex/lib/departments.ts` | Which agent sits in which department |
| `convex/lib` | Access builders, roles, statuses, permissions, events |
| `tests/harness.ts` | Helpers for the Convex tests |
| `docs/screenshots/landing` | The page at 1280 and 390 pixels wide |

The earlier build (Next.js 14 and Supabase) was removed on November 15, 2026
and is in git history before that date.
