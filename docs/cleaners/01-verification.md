# Cleaners: verification

What was checked for each phase, how, and what was not.

## How the screens were rendered

This environment has no Convex deployment and no Clerk instance, and a local Convex backend cannot be
downloaded here. The screens were rendered by a local-only harness (not committed): the real components,
the real `AppShell` and sidebar, and the real `convex/react` hooks, talking to the **real Convex functions**
running in `convex-test`'s in-memory runtime behind a small HTTP bridge. Data was written through the same
public mutations the product uses (a seed stands in for weeks of use by writing a few requirement states
directly). Mutations made from the screens round-trip through the functions. Sign-in is trusted, not real.

## Phase 1: foundation, overview, directory, profiles

**Works end to end (functions, tests and screens):**

- Add a cleaner with the onboarding template for their relationship type. A likely duplicate (same phone or
  email, or same name) is shown while typing and refused unless a person says why it is someone else; the
  override is recorded.
- Import a CSV: columns are matched, every row is reviewed (new, may be someone already here, same as another
  row in the file, cannot be added), and only chosen rows are written. Running the same file again adds nobody.
- Subcontractor companies with an authorized contact; their workers are people with their own records.
  Moving a worker between subcontractors keeps the earlier affiliation with dates.
- The overview's four counts, each with its definition on screen; clicking one filters the directory.
- Needs attention: items to review, missing requirements (urgent when the engagement is active), expired and
  expiring requirements, no weekly hours, availability not confirmed within the company's window, accepted
  jobs that clash with time away, a date exception, the weekly hours or other accepted work, no contact
  details, no pay arrangement (Owner only), skills to confirm. Each opens the person at the right section;
  a job opens the shared detail panel.
- Directory: search, eight filters, "free at a time" for a date and time window (with why each other person
  is not free), cards and table. Search, filters, view and the open person are in the address, so closing a
  profile, Back and reload keep them; a profile's "Cleaners" link returns to the same directory.
- Profile drawer and page (`/app/cleaners/<id>/<section>`): readiness with the exact unmet requirements,
  engagement status apart from readiness, payout readiness, details, upcoming work with conflicts, weekly
  hours drawn as a week, time away, recent work with each offer's outcome, requirements grouped by what they
  hold up, skills and equipment, crews, pay (Owner), activity with message delivery states.
- Routine engagement changes (make active, pause, resume) by Owners and Managers. Suspending, reinstating,
  ending, disciplinary records, rehire restrictions, removing personal details and pay changes are requests
  an authorized person decides; approving re-checks and carries them out, and accepted jobs are left in
  place and handed to a person in Dispatch's queue rather than removed.

**Access, checked in tests:** Office reads the directory and profiles with no pay anywhere in what the
functions return, and cannot add, change or open personnel requests. Managers cannot propose or see pay
changes, and pay-related history is left out of their activity view. Another company's cleaners,
subcontractors and requests answer "Not found." exactly like missing ones.

**Fixed along the way:** `onboarding.queue` and `hiringOffers.board` returned approved pay terms to every
role; they now return pay to the Owner only.

**Visually inspected:** directory at 1440 and 390 wide, profile drawer, profile page (overview, onboarding
as Office, pay as Office), the add dialog with a duplicate warning, and the import review.

**Tests:** `convex/lib/cleaners/readiness.test.ts` (readiness, expiry, service-specific and crew equipment,
conflicts, duplicates), `convex/cleanersWorkspace.test.ts` (add, duplicates, import, subcontractor
affiliation, role access, tenant isolation, personnel decisions, pay history), `src/lib/app/csv.test.ts`.
The whole suite, type check and lint pass.

**Not yet:** Performance is marked not built until Phase 4. Portal invitations, requirement review, crews and
follow-ups arrive in Phases 2 to 4.
