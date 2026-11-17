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

## Phase 2: onboarding, documents, portal, links, reminders, Recruiter handoff

**Works end to end (functions, tests and screens):**

- **The checklist** (`/app/cleaners/onboarding`): the Owner adds, changes and removes requirements, chooses
  who each applies to, what an unmet one holds up (work, payment, or nothing), who reviews it, its validity,
  whether the cleaner does it from their portal, the services it is for and, for equipment, who provides
  it. It starts from Selestial's suggestion and becomes the company's own on the first change. A new
  requirement holds up nobody until it is given to them, from the checklist or from a profile.
- **Review** on the profile: accept (with the document's own expiry if it has one), ask for changes (the
  cleaner reads the note), waive with a reason, reopen, or add a file handed in at the office. Each follows
  the template's reviewer; files open only for that reviewer. A paper agreement is accepted with a note
  saying how it was signed; a signed agreement in Agreements counts by itself; sent is not signed. Weekly
  hours and areas are read from the record and never ticked. Accepted items expire on their date (hourly).
- **The portal** (`/c/portal/<token>`), phone first: next steps and progress, next job, jobs (an offer shows
  the area; the street and the job page appear only for accepted work that is still theirs), weekly hours
  and time away (with the accepted jobs it touches handed to a person, never dropped), onboarding steps
  (confirm contact and agree to work texts in their own action, acknowledge policies, send photos or PDFs),
  ask the office, shared feedback, and pay behind a one-time code.
- **Links:** signed, scoped, expiring and revocable; opening one changes nothing and is not recorded; a task
  link opens only its step; ending an engagement ends access (the company's default) and keeps the record.
  One live portal link per cleaner; a second invitation within minutes finds the first; a failed or refused
  send is explained and the link can be copied to send by hand.
- **Codes:** six digits, ten minutes, five tries, three sends per fifteen minutes; only a hash is stored and
  the code travels in the send itself, never in the stored message.
- **Reminders:** Recruiter reminds about onboarding, Dispatch about unconfirmed hours. One open follow-up per
  person and topic; the first waits a day after the person was added; the agent's permission applies
  (Propose puts it in Approvals); one routine message per reminder window per person across workspaces; each
  message is checked again as it goes; after the company's limit a person is asked to reach out, and nothing
  about the cleaner changes. The profile and the attention list say what Selestial is doing and what became
  of each message: prepared, sent, delivered and acted on are shown apart.
- **Recruiter handoff:** an accepted hire gets the same record and checklist. A returning worker (same email
  or phone) keeps their record and history; a rehire restriction is put in front of the person completing
  the handoff. Recording a step in Recruiter's queue records it on the cleaner under the same reviewer rule.

**Tests:** `convex/cleanersOnboarding.test.ts`: template rules; reviewer roles and Office seeing state but no
files; expiry and readiness; the full invited-cleaner journey to ready; expired, revoked, wrong and
out-of-scope links; ended engagement; duplicate invitations; failed delivery; codes never stored; reminders
asking first, never duplicating, rechecked at send time, handed to a person after the limit. Recruiter's
hiring test was updated for the shared checklist and the reviewer rule.

**Visually inspected:** the portal home, steps, hours and pay (390 wide); the owner's onboarding review with
"What Selestial is doing" and portal messages; the directory header actions.

**Found and fixed while inspecting:** queries keyed to the current minute dropped to their loading state each
minute, which reset the portal's code entry and would have flashed the directory; they now keep the last
answer while the next loads (`src/lib/app/stable-query.ts`). Steps the office records no longer show the
cleaner "To do".

**Not verified here:** a real text or email provider (the mock was used), a real phone camera upload, and
signing through a provider (none is connected in Selestial).
