# Company onboarding (setup)

**"Tell us enough about your company. Watch Selestial prepare useful work. Review what matters. Start operating."**

Status: Phase 1 built November 18, 2026. Each phase is marked here as it is built and verified.

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
- **Nothing is switched on.** Entering the workspace changes no permission.

## Phases

| Phase | Delivers | State |
|---|---|---|
| 1 | Resumable guided flow, priority, adaptive questions, shared facts, readiness, responsive screens | Built |
| 2 | Website discovery, imports, integration guidance, service, agreement and booking drafts | Not started |
| 3 | First work per built agent, with prerequisite checks | Not started |
| 4 | Exact-action review, authority, safe execution, "Your first work" | Not started |
| 5 | Accessibility, recovery, invited users, existing companies, funnel measurement | Not started |

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

## Phase 1: not done yet

- "Use my website" keeps the address only. Nothing reads the site until Phase 2.
- "Connect or upload" records the choice only. Imports and connections come in Phase 2.
- The Prepare step shows readiness; it does not prepare drafts yet (Phases 2 and 3).
- Help is written guidance per question. Chat inside setup is not wired.
- Home has no "continue setup" entry yet; `/app/setup` is reachable directly (Phase 4).
