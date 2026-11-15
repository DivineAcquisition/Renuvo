# Selestial

The AI operating platform for cleaning companies. Four agents — Sales,
Recruiter, Dispatch and Retention — work inside one shared operating system.
The owner sets the standards. Selestial carries the work forward.

The source of truth is
[`docs/foundation/00-product-brief.md`](docs/foundation/00-product-brief.md).

This repository and its Vercel project are still named Renuvo, which was the
working name.

## What is here

- The public landing page.
- The Convex backend's shared foundation: companies and roles, customers and
  properties, cleaners and availability, jobs and assignments, tasks,
  permissions per action, approvals, and an append-only event log. No agent
  logic and no signed-in screens yet. Dispatch is next.

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

Sign-in is not connected. Identity always comes from the session token
(`ctx.auth`); when Clerk is set up, add its issuer to `convex/auth.config.ts`.

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
- **The event log is append-only.** Only `convex/lib/events.ts` writes to it.
- **Numbers come from code.** Money is whole cents; times are checked
  instants.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · coss UI on Base UI ·
Convex · Vercel. Clerk arrives with the signed-in product.

## Where things are

| Where | What |
|---|---|
| `src/lib/marketing/content.ts` | Every word on the public site |
| `src/components/marketing` | The page's sections and pictures |
| `src/app/globals.css` | Tokens. Brand teal `#2CC5A8`, light only on the public site |
| `src/components/ui` | Shared components |
| `convex/schema.ts` | The shared record |
| `convex/lib` | Access builders, roles, statuses, permissions, events |
| `tests/harness.ts` | Helpers for the Convex tests |
| `docs/screenshots/landing` | The page at 1280 and 390 pixels wide |

The earlier build (Next.js 14 and Supabase) was removed on November 15, 2026
and is in git history before that date.
