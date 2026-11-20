# Bring your business to Selestial: guided migration

**An owner moving from Jobber, Housecall Pro, BookingKoala, a spreadsheet or another system uploads CSV exports, confirms how Selestial reads them, reviews every record, imports in the background, verifies the result, and releases the imported schedule when ready.**

Built November 20, 2026. This covers phases 1–4 of the brief: audit, the guided workspace with uploads and templates, mapping/preview/duplicates/corrections, and customer, property, recurring and upcoming-booking imports. Phases 5–7 (more record types, assisted-migration tools, undo, the full activation review) are listed under "Not yet".

## Product decisions (from the owner, November 20)

| Question | Decision |
|---|---|
| Scope of this pass | Phases 1–4, then review |
| Staff help | An Admin Support Session system is being built in another session; this work leaves the hook (`migrations.assistedBy`) and doesn't duplicate it |
| Excel | CSV only. An `.xlsx` upload is refused with "Save as CSV" steps |
| AI cost | Free during assisted migrations. This pass uses no model at all (see "AI") |
| Imported recurring price | Proposed as the property's own price, for the Owner's approval |
| Entry points | Settings › Business card, Clients empty state, onboarding, and a Home banner until the migration is released |
| Jobber / Housecall Pro connectors | CSV first; the read-only connection is mentioned only when it is configured |
| Assistance panel | Step guide plus live findings |

## Phase 1 audit: what existed

Inspected on `claude/youthful-bohr-rtj6ng` at `19614f1`.

| Area | Before | Now |
|---|---|---|
| Client import | `clientImports.check/commit`: one CSV of clients, keyed batches, `importedRecords` for repeat detection, no consent | Kept as the quick path in onboarding. The migration writes `importedRecords` too, so neither path copies the other's records |
| Column recognition | `lib/clients/importing.ts`: Jobber, Housecall Pro and BookingKoala headers | Reused for "looks like a … export"; `lib/migration/rules.ts` adds field catalogs for four record kinds |
| CSV parser | Browser only (`src/lib/app/csv.ts`) | Moved to `convex/lib/csv.ts`; files are parsed on the server. The browser module re-exports it |
| Connectors | Read-only Jobber (OAuth, needs app credentials) and Housecall Pro (API key) | Unchanged. Source cards mention them only when `connectors.status` says available |
| Recurring plans | `servicePlans` + `bookAhead`, priced by the engine | Imported plans are written `setup` + held; released plans use the same `bookAhead` |
| Visits | `createVisit` checks area/hours and calls Dispatch's `coverJob` immediately | Imported visits are written directly, held. Dispatch, the day-of-service watcher and ad conversions skip held visits |
| Property prices | `proposePropertyPrice` → Owner approval | Used for every imported recurring price |
| Consent | `suppressions`, `contactPermissions`; imports never consent | Imported documented opt-outs become suppressions (`reason: manual`, note naming the export). No permission is created |
| Background work | Activation's leased scheduler steps and cron sweep | Same pattern for import runs |
| In-app notices | `memberNotices` via `noticeInApp` | "Your import is ready to review" on completion |
| Staff support sessions | Not in this branch | Being built elsewhere; see "Not yet" |

## Verified against official provider documentation

| Provider | What was checked | Result |
|---|---|---|
| Housecall Pro | [How to import/export jobs and customers](https://help.housecallpro.com/en/articles/6797101-how-to-import-export-jobs-and-customers), [Price Book import/export](https://help.housecallpro.com/en/articles/7173129-price-book-import-or-export-services-and-materials) | Verified: Customers › Actions › Export and Jobs › Actions › Export each email a CSV from notifications@housecallpro.com; Admins only. These steps appear on the card |
| Jobber | help.getjobber.com, developer.getjobber.com | Not verified: both returned 403 to automated reads. The card says Selestial hasn't confirmed Jobber's menu names. The API's existence comes from Selestial's own connector, not from help pages |
| BookingKoala | bookingkoala.com, support.bookingkoala.com | Not verified: the proxy couldn't reach them (502). The card makes no menu claims and says there's no direct connection |

Column recognition for all three comes from the existing `lib/clients/importing.ts` header lists and the test fixtures. **It has not been checked against real export files from any provider.** Get a real export from each before the first assisted migrations.

## The workspace

`/app/migration`, Owners and Managers. Every entry point opens the same saved migration on its last step. The page carries the title and supporting copy from the brief.

1. **Choose your source**: six cards, each listing what works today and what doesn't. Export steps appear for the chosen source. A "What do you want to bring?" picker marks the kinds Selestial doesn't import yet as "Coming next".
2. **Add your files**: drag-and-drop CSVs (≤12 files, 5 MB and 2,000 rows each, 5,000 rows per migration). Each file is read on the server. Its card says what Selestial thinks it is, which columns told it so, and what's missing (bookings without customers, schedules without live services). Four templates download.
3. **Organize your information**: each column mapping shows the file's first values beside it; suggested columns are marked. Also: date format (proved from the files when possible, never guessed), timezone confirmation, and matching old service names to live Selestial services.
4. **Review & fix**: counts (ready, imported before, duplicates, needs review, needs correction, skipped). Commercial-account grouping suggestions sit above tabs per record kind, with filters, search, pagination and bulk actions for rows sharing one problem. Opening a row shows the source row beside the Selestial fields, editable inline with "put back the original". Its matches carry reasons. Choices: keep existing, update selected fields, create separately, skip, review later. Recurring rows preview their next four visits.
5. **Import**: what will happen per kind, what still blocks it, the "nothing goes live yet" guarantees, then a background run with real progress. Stop and re-run are both safe.
6. **Verify & activate**: per-kind counts that must add up to the file rows, links to records, a downloadable CSV of everything not imported and why, and a "what didn't transfer" list. Then the Owner-only release of held visits and plans, behind an explicit confirmation.

Screenshots are in `docs/screenshots/migration/`: desktop at 1440 wide, phone at 390. They render the real components against query results captured from the test scenario. Two wording fixes on Verify (record names in the links, the "not transferred" line) landed after the capture.

## Rules that hold everywhere

- **No guessing.** Dates, times, lengths, money and frequency are parsed deterministically (`lib/migration/rules.ts`). `03/04/2027` is read only in the order the files prove (any value with a part over 12) or the owner chooses. Missing prices, addresses, times and services stay missing as problems.
- **Every four weeks ≠ monthly.** `every_28_days` and `once_per_month` stay separate. "Biweekly" is read as every two weeks, with a note. "Bimonthly" requires a choice. Unsupported cadences (every 3 weeks, twice a week) are errors with guidance.
- **No merging on one shared value.** Matches against existing customers, contacts, properties, plans and visits are shown with their reason ("Same email and same name") and wait for a choice. In-file duplicates are flagged against the earlier row.
- **No guessed relationships.** A property, plan or booking links to a customer only when exactly one fits (source ID, or a name matching exactly one customer). When several fit, they are listed for the owner. A customer with several properties needs the address or property ID.
- **Commercial accounts** are suggested, never applied: rows for one business at different addresses form one account only when the owner clicks "Group them".
- **Owner edits are never overwritten.** Corrections live in `migrationRows.edits`, kept across re-checks and re-mappings. A check never writes over a row that changed while it ran (stamps).
- **Uploaded text is data.** No cell is sent to a model or treated as an instruction.

## Import: durable and idempotent

`convex/migration.ts` › `startImport` → `runStep` (scheduler):

- Order: customers → properties → recurring → bookings. A dependent row whose parent failed or was skipped fails with that reason.
- Each step writes up to 40 rows and advances the checkpoint **in the same transaction**, so an interruption never half-writes a batch.
- Each run holds a 2-minute lease. The cron `migration imports resume after an interruption` restarts expired runs. After 3 failed attempts on the same batch it marks that one row failed and moves on (bounded retries).
- Per-row results (`created`, `updated`, `linked`, `skipped`, `failed`, with a reason) are stored on the staged row.
- Every written record gets a `migrationLinks` row keyed by source + kind + the old system's ID (or a content key). A repeat upload, a retry or a second run finds it and links instead of copying. A visit at the same property and minute is linked, never doubled.
- The run writes as the member who started it, only while they're still an active Owner or Manager.
- Events: `migration.import_started`, `migration.imported`, `migration.released`.

## Migration stays separate from agent activation

| Path | What it does with imported records |
|---|---|
| Dispatch (`coverJob`, the 15-minute sweep) | Returns `held`: no offers, no cleaner texts |
| Day-of-service watcher | Skips held visits |
| Plan booking (`bookAhead`, daily cron) | Imported plans are `setup` and held, so nothing is booked |
| Google Ads conversions | Ignores migrated visits |
| Pricing | Imported plan prices are proposals in Services & Pricing; plans carry no typed price |
| Messaging | No consent created. Opt-outs kept. Nothing sent (asserted in tests) |
| Events | No per-record `job.created`/`customer.created` is emitted, so activation's event wake isn't triggered |

**Release** (`migration.release`, Owner, `confirm: true`): un-holds visits (applies checklist templates, schedules Dispatch cover) and starts plans (`active`, or `paused` if paused in the source), which then book ahead. Days an imported visit already covers aren't booked again. Customers are not messaged.

## AI

This pass uses **no model**. Column, category and grouping suggestions come from rules, each shown with the source values behind it, and the assistant panel says so. Nothing is billed. The brief's model-assisted review (explaining odd values, smarter mapping) belongs with assisted migration and must use the billing disclosure in `lib/billing`. Per the owner's decision it will be free for assisted migrations.

## Data rights

`migrations` and `migrationLinks` are in the company export. `migrationFiles`, `migrationRows` and `migrationRuns` are listed in `NOT_EXPORTED` with reasons (`lib/trust/exportTables.ts`). Original uploads stay in storage with the migration; a removed or failed file is deleted.

## Tests

`convex/migration.test.ts` (13 tests) plus the full suite (119 files, all passing):

- Ambiguous dates, date-order proof, times, lengths, money, frequencies (4 weeks vs monthly, biweekly, bimonthly), file-kind and column guesses, opt-outs, category suggestions.
- A booking whose customer name matches two customers is not linked.
- Source cards: no integration claims for CSV, saved cards never move, Housecall Pro verified, Jobber not.
- Server-side file checks: Excel refused, a zip renamed `.csv` caught when read, the same file refused twice.
- End to end: duplicates flagged and decided, commercial grouping, a property ambiguity fixed by inline edits (originals kept), past and cancelled bookings skipped, bookings reconciled to the plan series (no double booking), timezone and column gates, reconciled counts, Harbor Dental's two sites under one account, Sam kept unchanged, opt-out suppressions with no permissions, plans held at no typed price with price proposals in review, visits held, Dispatch cover and plan booking doing nothing, no customer or cleaner messages, the in-app notice.
- Running the import again writes nothing; the same export uploaded again links instead of copying; release books ahead without doubling imported days.
- Release is Owner-only; Office can't open the migration.
- An interrupted import resumes from its checkpoint via the sweep, with a concurrent duplicate step, and ends with exactly 95 customers and no duplicates.
- Another company can't read or decide this company's rows.

## Phase 5: the rest of the records, and assisted migration

Built November 20, 2026, after Admin Support Sessions (#124) merged.

### Decisions (from the owner)

| Question | Decision |
|---|---|
| Past visits | Read-only history on the client, never jobs |
| Outstanding balances | Opening balances, reference only, by old invoice number |
| Imported cleaners | Onboarding, no invitation, held until released |
| Staff in a support session | Prepare only; the company's Owner or a Manager imports, and only the Owner releases |

### New record kinds

Import order: customers → properties → **cleaners** → recurring → bookings → **history** → **balances**.

| Kind | What it becomes | Never |
|---|---|---|
| Cleaners | `cleaners` via the existing `createWorker` (onboarding, requirement template), `migration.held`, weekly availability windows when the file says something clear ("Mon-Fri 8am-4pm") | Employment status is never guessed: a missing or unclear value is a problem to fix. Unreadable availability is noted, not set. Someone marked terminated or inactive is skipped unless the owner picks "Import anyway". No invitation, onboarding follow-up or offer is sent while held (`lib/cleaners/followUps.ts` skips held cleaners) |
| Service history | `importedHistory`, shown on the client's Services tab as "From Jobber" (or the source) | Not a job, so never paid, invoiced, reviewed, followed up or counted. Future dates are skipped with a pointer to the bookings file |
| Balances | `openingBalances`, shown on the client's Billing tab (Owner only) with a total | Never a Selestial invoice, charged, reminded or added to what the client owes. Each needs its old invoice number; the same number twice is a duplicate, and a re-import links instead of adding. Zero balances are skipped. Credits are refused. A customer with several rows gets a "not a running total?" check |
| Consent | Customer columns for all/texts/email/marketing opt-outs, kept as suppressions with their scope. "Consent recorded" text goes to the client's Owner-only note | No permission is created, ever: the old system's evidence didn't come with the file |
| Agreements, services, other | Kept with the migration and reported as not transferred. Agreements point to Agreements › upload, where a signature is never assumed | |

Templates now cover all seven kinds. Source cards say balances come over for reference only.

### Assisted migration

Uses the merged Admin Support Sessions (`docs/operations/03-support-sessions.md`); nothing is duplicated.

- Every migration prep mutation (open, files, mapping, services, grouping, decisions, edits, categories, recheck, reopen) is opened to Manage-mode sessions under `records.edit`. Each change is written to `supportEvents` with a readable summary ("decided records in the migration"). View mode can read but not change.
- **Attribution:**
  - Rows keep the actual staff member and session (`decision.staff`, `editedByStaff`), and `migrations.assistedBy` lists who helped.
  - The company sees "By Selestial Support", matching the rest of the platform.
- **Questions for the owner:** staff can `askOwner` on rows they can't settle. The owner gets a banner, a "Questions" filter and the question on the record, and answers by deciding the row, which clears it.
- **Limits:**
  - `startImport` and `release` aren't opened to support sessions, so the backend refuses them there.
  - The staff UI says the company imports and releases.
  - Staff can't send messages or spend money: no migration function does either.
- AI review stays off. Nothing is billed.

### Release, split

`release` takes `schedule` and `team`. The schedule part sends held visits to Dispatch and starts held plans; the team part un-holds cleaners, who stay onboarding and start getting the usual onboarding follow-ups. The Verify step describes each part, with counts, before the Owner confirms.

### Tests

The original 13, plus:

- employment-status and availability rules;
- an end-to-end run with team, history, balances and consent files: held onboarding cleaners with no follow-ups or invitations until the team is released, no jobs or invoices from history or balances, duplicate invoices counted once, scoped opt-outs, a consent note with no permission, balanced counts, and history and balances on the client;
- an assisted run: View refused, Manage with the owner's grant, staff decisions and questions attributed and logged, import and release refused in the session, and the owner's answer clearing the question.

Full suite: 121 files passing. Screenshots: `docs/screenshots/migration/*-p5-*.png` (the "$700" in the balance note there predates the fix that leaves skipped duplicates out of that total).

## Phase 6: undo, activation review, completion email

Built November 20, 2026, after main gained Operations recovery, tutorials, and a second, quicker importer from another session (#125 and the tutorials work).

### Decisions (from the owner)

| Question | Decision |
|---|---|
| Two importers | Keep both, clearly labeled. The quick setup import (`convex/migrationImports.ts`) stays for a client list plus appointments or schedules waiting to be set up; the guided migration is the full path. Each points to the other |
| Undo | Owner only. Managers see the preview; support sessions can't undo |
| Activation | Per workflow |
| Completion email | Owner only (Owners and Managers still get the in-app notice) |

### Merging main

Both versions added `convex/lib/migration/schema.ts`. It now holds both table sets: `migrationRecords` and `migrationImportRuns` for the quick import, and the guided tables. Setup shows the guided-migration card above the quick-import step, and Home keeps both the migration banner and main's issue cards. Every test from both branches passes.

### Undo (`lib/migration/undo.ts`; `migration.undoPreview`, `migration.undo`, `migration.undoStep`)

- **Only what the import created.** Records it matched or updated (`linked`, `updated`) were already the company's and are never removed.
- **Preview first.** For each kind it shows how many records can be undone, and every record that will stay, with the reason. Choosing customers includes everything they own.
- **"Touched" means any of these:**
  - Visits: started, released to Dispatch, offered, invoiced or messaged.
  - Plans: started, changed, or booked visits of their own.
  - Properties: edited, with outside visits or plans, an approved price, or an agreement.
  - Team members: released, status changed, offered work, onboarding started, messaged, or an agreement.
  - Customers: edited, invoiced, messaged, notes added, in the sales pipeline, a care case, an agreement, quick-import records, or outside visits, plans, properties or contacts.
  - Each record is judged on its own. An untouched imported visit of an edited customer is undone, and the customer stays.
- **Durable.** Undo works dependents first (visits → plans → history → balances → properties → team → customers), 25 links per checkpointed step. The same sweep cron resumes a stalled undo.
- **What's removed with a record:** a customer takes its contacts, its directory rows and its `importedRecords` entries. A plan's imported price proposal is withdrawn. A team member's requirements, availability and follow-ups go with them.
- **What's never removed:** opt-outs (suppressions). An undo never makes anyone reachable.
- **Rows afterwards:** undone rows are marked, left decided "skip" (importing again doesn't bring them back unless someone takes back the skip), and counted in a new **Undone** column. The report stays balanced. Kept records show "Kept by undo" with the reason, in Review & fix and in the downloadable report.

### Activation review (`migration.activationReview`)

Three workflows, each with its records, what it does, its Agent controls level, what's missing, approvals still needed, and an estimate of messages and cost at the current rate card ($0.025 a text segment):

| Workflow | Records | Missing / approvals it checks |
|---|---|---|
| Dispatch offers imported visits | Held visits, how many in the next two weeks, the first date | Dispatch paused, first offers Off, no active cleaner, texting not set up; Ask me first |
| Recurring services start booking | Held plans; visits they'd book in four weeks minus days imported visits cover | Imported prices waiting in Services & Pricing |
| Team onboarding follow-ups | Held team members | No phone or email, reminders Off, texting not set up; Ask me first |

It also lists what isn't affected: customers aren't messaged, balances aren't reminded, no consent was created. `release` now takes `visits`, `plans` and `team` separately, and records when each was turned on.

### Completion email

A new `migration_complete` notice (Owner audience), sent through the shared notice router (preferences, quiet hours, outbox) when an import finishes. It's composed with the platform alert template: the counts, what needs attention, "nothing has been sent to customers or cleaners", and a button to Verify.

### Two importers, side by side

The quick setup step says what it is and links to the guided migration. The guided Files step explains that quick-import clients are recognized. Appointments and recurring services the quick import is still holding are flagged as possible duplicates, so nothing is booked twice.

### Tests

20 migration tests (plus the full suite, 124 files):
- the completion email reaches the Owner;
- the review's counts, missing pieces and approvals; a plans-only release keeps imported visits held;
- undo removes untouched records, keeps an edited customer and a matched existing one with reasons, withdraws price proposals, keeps opt-outs, balances the report, is Owner-only, and doesn't bring undone rows back on re-import;
- a visit released to Dispatch is kept by undo;
- an appointment from the quick import is flagged instead of booked twice.

Screenshots: `docs/screenshots/migration/*-p6-verify.png`. The first-visit date and the $0.025 rate formatting were fixed after the capture.

## Not yet (phase 7 and beyond)

- **Verification against real export samples** from Jobber, Housecall Pro and BookingKoala: still the most important open item.
- **Model-assisted review** with cost disclosure (free for assisted migrations).
- **Cleaner assignment conflicts:** assignments in booking files are noted, not imported.
- Agreement documents inside the migration (they go through Agreements today), Excel files, and connector reads inside the migration.
- **One importer:** merging the quick setup import and the guided migration into a single path.
