# Services & Pricing: verification and status

What was checked, how, and what is and is not end to end. Date: November 17, 2026.

## Automated tests

| File | What it covers |
|---|---|
| `convex/lib/services/engine.test.ts` (39) | Determinism (same inputs in any order give the same quote); totals equal the lines shown across a grid of inputs; half-away-from-zero rounding and float noise; sub-cent area rates; band boundaries (999.99 vs 1000, top band to walkthrough); overlap, gap, drop and jump checks; hourly per cleaner vs per crew, minimums and increments; priced extras' time never billed hourly; included extras never charged; quantity caps; best-only vs stacked discounts; discount limit; unapproved or out-of-date promotions; discounts on cleaning only; minimum then rounding; recurring schedules (52.18 a year, months of 4 and 5, month-end clamping); monthly package per-visit average; demand (larger trigger, cap, off means off, needs a cap and a trigger); walkthrough and incomplete outcomes; turnover laundry, restocking billed later, window and laundry capacity warnings; profitability (margin vs markup, each pay model, floor solve with proportional costs, missing costs never zero, overhead) |
| `convex/lib/services/templates.test.ts` (24) | Every category has at least three templates; each template validates, prices once questions are answered, is marked illustrative and blocks publishing until confirmed; specialized work lists its requirements unconfirmed; the move-out template never charges included extras |
| `convex/lib/services/imports.test.ts` (6) | CSV quoting; price reading to the tenth of a cent; hourly never assigned to cleaner or crew; source references; duplicate and existing-name flags; pasted text; unclear values held as illustrative |
| `convex/services.test.ts` (23) | Company isolation; Office cannot draft; Managers cannot approve; costs and profitability only for the Owner; autosave revisions and stale-save conflict naming who saved; recovery at the saved step; malformed amounts refused; blockers stop submission; editing after approval returns the change; approval refused when the live version moved; scheduled publish at the start date, and cancelled by a later edit; rollback writes a new version; specialists' notes and applying a suggestion; visits priced from the live version, keeping their version, quote and price after a new version is published; stale screen price refused; missing facts and walkthroughs refused unless a price is typed; archived services refused for new visits; Settings migration once, keys kept, visits still resolve; Chat edits the same draft and a stale tab is refused; Chat submits only after approval in chat and never publishes; Office is not offered drafting tools; failed imports create nothing; drafted rows carry their source into review; free research brief with a range only from three comparable prices; web research blocked without a model says why and charges nothing; web research (with a stand-in for the search call) drops a claim citing a page it did not retrieve and charges exactly one brief; setup research starts on its own |
| `src/components/app/services/services.test.tsx` (15) | The four ways to start shown to Owners and Managers only; current tab and waiting count; the three first-time choices; Office's empty state; template amounts labeled illustrative; units beside every typed amount; breakdown lines and calculation order; walkthroughs never shown as firm; customer, team and costs views; "net profit" never used as a label; switches with `role="switch"` and state in words; named stepper buttons; the builder reopening at its saved step; a Manager sees that only the Owner approves |
| `src/lib/app/navigation.test.ts`, `settings.test.ts` | The new Company entry and its pages; every page accounted for; the old Settings page is a written-down redirect; the Settings catalog without services |

Full suite: `npx vitest run`, 64 files, 727 passed, 19 skipped (the same 19 as before this change: live-provider evaluation tests that need API keys).

`npx tsc --noEmit` passes. `npx eslint .` shows no errors; its one warning is in an existing file
(`convex/googleBusiness.ts`). `next build` compiles every route.

## In a browser

The screens in `docs/screenshots/services/` were rendered from the real components in Chromium at
1440 × 2 and as an iPhone 13. A temporary page fed them fixture data through a stand-in Convex client,
because this environment has no Convex deployment or sign-in service; the page was not committed. These
checks were scripted in that browser:

- No page errors on any screen.
- No horizontal scrolling at phone width on Services, the builder, a change review or Pricing Studio.
- From the Basics step, Tab reaches Scope and Enter opens it; the current step carries `aria-current="step"`.
- The demand-pricing switch toggles with the keyboard (Space) and reports `aria-checked`.
- Pricing Studio's one-time vs recurring comparison shows real yearly visit counts and labeled annual
  estimates.

Screenshots found and fixed three problems before this commit:

1. A too-narrow editing column at 1440.
2. Fields overflowing the Time & Team step.
3. Example jobs in a review showing "Walkthrough" when a required question was simply unanswered. Sample
   jobs now answer required questions neutrally, and the screen says what is missing.

## What works end to end

- All nine pricing methods, every modifier, recurring schedules and short-term rental turnovers, in the
  engine, the builder preview, Pricing Studio, Chat and visit creation.
- Drafting with autosave and conflict handling. Review, approval bound to the exact version, scheduling,
  publishing, returning, withdrawing, archiving and restoring, and rollback.
- The move out of Settings, with the redirect.
- Visits priced from published versions, keeping the version and quote. Checklist templates following
  published scope.
- Templates, imports, research briefs (free parts), and Chat's drafting tools.

## What is not verified or not built

- **The live web search call.** No Anthropic key was available. The request follows the installed SDK's
  types for `web_search_20260209`, and the code around it was tested with a stand-in.
- **Autumn.** No key was available. Research billing was exercised against the existing fake Autumn.
  Production needs `BILLING_RATE_CARD=2026-11b` for research briefs to have a rate; under `2026-11` they are
  refused with that reason.
- **Codegen.** `convex/_generated/api.d.ts` was regenerated locally to match codegen's output. Run
  `npx convex codegen` against a deployment before publishing the backend.
- **Not built:**
  - a customer booking flow, a customer portal and payments;
  - sync to outside systems: none is connected, so no sync status is shown or claimed;
  - repricing existing recurring customers, as its own workflow;
  - property-specific price overrides as separate records (a turnover's scope and price are per service
    today);
  - reading PDFs or photos of price lists;
  - Sales and Retention contributions, which wait for those agents.
- Dark mode was not reviewed: the app ships light only.
