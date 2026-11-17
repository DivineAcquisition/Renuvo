# Services & Pricing: verification and status

What was checked, how, and what is and is not end to end. Date: November 17, 2026 (property prices added the same day).

## Automated tests

| File | What it covers |
|---|---|
| `convex/lib/services/engine.test.ts` (46) | Determinism (same inputs in any order give the same quote); totals equal the lines shown across a grid of inputs; half-away-from-zero rounding and float noise; sub-cent area rates; band boundaries (999.99 vs 1000, top band to walkthrough); overlap, gap, drop and jump checks; hourly per cleaner vs per crew, minimums and increments; priced extras' time never billed hourly; included extras never charged; quantity caps; best-only vs stacked discounts; discount limit; unapproved or out-of-date promotions; discounts on cleaning only; minimum then rounding; recurring schedules (52.18 a year, months of 4 and 5, month-end clamping); monthly package per-visit average; demand (larger trigger, cap, off means off, needs a cap and a trigger); walkthrough and incomplete outcomes; turnover laundry, restocking billed later, window and laundry capacity warnings; profitability (margin vs markup, each pay model, floor solve with proportional costs, missing costs never zero, overhead); a starting price only for methods that have one; a property's own base price replacing only the base line (extras, rush, discounts, minimum and rounding unchanged), its time, and how it settles a size or walkthrough, an hourly service and a monthly package |
| `convex/lib/services/templates.test.ts` (26) | Every category has at least three templates; each template validates, prices once questions are answered, is marked illustrative and blocks publishing until confirmed; specialized work lists its requirements unconfirmed; the move-out template never charges included extras; the prices still exactly the template's are named and drop out once changed, and included extras are never listed |
| `convex/lib/services/imports.test.ts` (6) | CSV quoting; price reading to the tenth of a cent; hourly never assigned to cleaner or crew; source references; duplicate and existing-name flags; pasted text; unclear values held as illustrative |
| `convex/propertyPrices.test.ts` (7) | A property price prices visits only once the Owner approves it, replaces only the base, and the visit form reads the same price; Office cannot propose, Managers cannot approve or end; bad amounts, dates and reasons refused; it keeps its price through a catalog change, whose impact and review list it; a newer proposal replaces an older one for the same property only; approval refused when the property's price changed since; an archive request leaves proposals alone; a visit on the end date uses it and the day after does not; one reminder task two weeks before, never twice, and the price marked ended after its end date; a draft service or another company's property refused |
| `convex/services.test.ts` (27) | Company isolation; Office cannot draft; Managers cannot approve; costs and profitability only for the Owner; autosave revisions and stale-save conflict naming who saved; recovery at the saved step; malformed amounts refused; blockers stop submission; editing after approval returns the change; approval refused when the live version moved; scheduled publish at the start date, and cancelled by a later edit; rollback writes a new version; specialists' notes and applying a suggestion; visits priced from the live version, keeping their version, quote and price after a new version is published; stale screen price refused; missing facts and walkthroughs refused unless a price is typed; archived services refused for new visits; Settings migration once, keys kept, visits still resolve; Chat edits the same draft and a stale tab is refused; Chat submits only after approval in chat and never publishes; Office is not offered drafting tools; failed imports create nothing; drafted rows carry their source into review; free research brief with a range only from three comparable prices; web research blocked without a model says why and charges nothing; web research (with a stand-in for the search call) drops a claim citing a page it did not retrieve and charges exactly one brief; setup research starts on its own; every Chat reply carries the business, the person and the conversation's first question, still there after 44 more messages push it out of the history; a Manager's prompt leaves out the Owner's margins; research started from Chat waits for approval, links to the conversation, posts "Research ready" when it finishes, and is read with `read_research_brief`; Office can read research but not start it; Chat proposes a property price only after the person approves, never approves it, and quotes at the property with its approved price while a price the model makes up is refused as input |
| `src/components/app/services/services.test.tsx` (39) | The four ways to start shown to Owners and Managers only; current tab and waiting count; the three first-time choices; Office's empty state; template amounts labeled illustrative; units beside every typed amount; breakdown lines and calculation order; walkthroughs never shown as firm or as $0 ("From", "Set after a walkthrough"); the total first, the price at a glance, and the lines folded; customer, team and costs views; "net profit" never used as a label, with margin, markup and contribution explained behind named tips; the price split's accessible name and the margin meter; margin standing in words against the floor and target; tips named "About …", closed until asked, and outside the label; pricing method cards with examples, the rest one tap away, and the selected one always shown; "A usual job" worked out from the typed rate; each adjustment as a labeled switch with what it does; switches with `role="switch"` and state in words; named stepper buttons; the builder reopening at its saved step; a Manager sees that only the Owner approves; a change shown as old and new values, with unchanged prices folded and what approving does listed; change lines parsed into label, old and new; extras folded into rows showing price or "Included"; the setup checklist's steps and ring; the research price strip's accessible name and the starting-price marker; template prices grouped on Review with a way to change them; steps marked as having nothing to fix, and phone progress; research opening on Chat's own composer, centered, telling Chat the page, with starter ideas; research chats listed and briefs saying where they started; Office seeing briefs without the box; a property price review with the property, the price now struck through, one approve button, and no approval while the property's price moved; a catalog review listing properties that keep their own price; the Property prices panel for each role, and its empty state |
| `src/lib/app/navigation.test.ts`, `settings.test.ts` | The new Company entry and its pages; every page accounted for; the old Settings page is a written-down redirect; the Settings catalog without services |

Full suite: `npx vitest run`, 77 files, 884 passed, 19 skipped (the same 19 as before this change: live-provider evaluation tests that need API keys).

`npx tsc --noEmit` passes. `npx eslint .` shows no errors; its four warnings are in existing files
(`convex/googleBusiness.ts`, `convex/portal.ts`, `src/components/app/cleaners/crews.tsx`). `next build` compiles every route.

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

The interface pass that cut configuration copy (tips, method cards, adjustment cards, the animated price, the
price split and margin meter, the change diff) was driven in the same way, at 1440 × 2 and as an iPhone 13:

- The method cards show examples. "More ways to price" expands and reports `aria-expanded`.
- Typing a new base price moves the total, shows "+$25.00" beside it, and updates "A usual job".
- A tip opens on click and from the keyboard (Enter), closes with Escape, and stays on screen at phone width.
- The breakdown opens. The Costs view shows the price split (its accessible name lists every part) and the margin
  meter ("55.7%. At or above your 45% target.").
- Turning on Rush with the keyboard (Space) opens its fields. Demand pricing shows its cap tag.
- The change review shows old values struck through and lists what approving does.
- No sideways scrolling at phone width on the builder, the Extras step or the change review. No console errors.

A second pass (extras as rows, the step rail, template prices, the setup checklist, the version timeline,
the research price strip) was driven the same way:

- Extras are folded rows, and one opens its fields.
- The step rail marks clean steps.
- Review lists the template's prices without the one the owner changed, and "Change in Pricing" jumps there.
- The first visit shows "0 of 4 done".
- Versions read as a timeline.
- The research strip's accessible name lists every price and the starting-price marker.
- On a phone, the progress bar reads "Step 3 of 6".
- No sideways scrolling at phone width on the builder, Extras, Review, the first visit, a live service or a
  brief. No console errors.

Research in Chat was driven the same way:

- The composer sits exactly centered across the page and in view without scrolling, and has focus.
- It is Chat's own composer, with send and attach.
- A starter idea fills it, and Enter opens the new conversation at `/app/chat/<id>`.
- Research chats link to their conversations, and briefs say where they started.
- It fits at phone width with no sideways scrolling, and there are no console errors.

Property prices were driven the same way:

- The panel lists properties with their own price. A due review stands out, and a price that kept its
  price through a service change says so.
- What waits for the Owner links to its review.
- The form prices the service's example job at the property and elsewhere. A date field appears for a
  review or end date. Sending without a reason says what is missing, and the base price's tip opens.
- The review names the property and customer and shows one approve button, with no customer-notice
  details that do not apply. A replacement shows the current price struck through.
- A catalog change's review lists the properties that keep their own price.
- The visit form says the property has its own base price, and the breakdown uses it.
- No sideways scrolling at phone width on the service page, the form or the review. No console errors.

That pass found the review-or-end date field sharing its name with the "Review date" option, which a
screen reader would announce twice. The date field is now "Day to review it" or "Last day at this price".
It also moved Change and End beside each other on phones.

That pass also found sideways scrolling on phones, caused by the step rail's screen-reader labels sitting
outside a positioned parent inside its scrolling list. The step buttons are positioned now.

Screenshots also found and fixed:

- a squeezed set of stat tiles in the narrow preview column (they now follow the column's width);
- pale violet text, because the light theme reverses the brand scale (`text-brand-300` is used throughout now);
- extras' fields crowded four to a row in the builder column;
- a missing React key in the cost table.

Before the first commit, screenshots found and fixed three problems:

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
- Property prices: proposing (workspace and Chat), the Owner's approval, visits and Chat quotes using
  them, keeping them through catalog changes, ending them, and the review and end reminders.

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
  - a property's own scope or extras (a property price changes only the base price);
  - property prices on the property's page under Customers & Properties (they are on the service, in
    Changes, and in the visit form);
  - reading PDFs or photos of price lists;
  - Sales and Retention contributions, which wait for those agents.
- Dark mode was not reviewed: the app ships light only.
