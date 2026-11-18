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

## Phase 3: availability, crews, Dispatch eligibility, subcontractor access

**Works end to end (functions, tests and screens):**

- **Dispatch reads the same records.** A cleaner whose requirements for work are not met is never offered a
  job, with the requirement named; readiness is judged as of the job's start, so a document that expires
  before the job counts. A date the cleaner cannot work keeps them out; a date they can work makes them
  eligible outside their weekly hours. Existing Dispatch behaviour and tests are unchanged.
- **Availability from the office** (profile, Availability & Jobs): weekly hours, time away, single dates
  (cannot work / can work, whole day or a time range), "still right" with how it was confirmed, and removing
  time away or a date. Before saving, each dialog lists the accepted and offered work in the next 60 days the
  change would touch, marking what already clashed. Saving never removes anyone from a job; the clash shows
  on the profile and in the directory until a person keeps or covers it in Dispatch. Owners and Managers
  change availability; Office reads it.
- **Crews** (`/app/cleaners/crews`): permanent crews with a lead, dated memberships (a change of lead is a
  new membership, so the history shows who led when), an optional subcontractor company and what the crew
  brings. Ending a crew keeps its history. A person whose engagement ended cannot join.
- **Crew builder for one job**: scheduled jobs in the next two weeks with places still open; for the chosen
  job, every active person is checked with Dispatch's rules for that job, and permanent crews are shown
  member by member. Reasons that hold for everyone (a date they cannot work, hours, time away, other work,
  requirements) come before Dispatch's preferences, so "outside their areas" is shown, and may be set aside
  by a person, only when nothing else stops them. Offers go out through Dispatch's one offer path, the lead
  first, each checked again as it is made; anyone refused is listed with the reason, and the places still
  open stay visible. Places that already have an offer out are not offered twice. The job keeps one team,
  which keeps its people whatever later happens to the permanent crew.
- **Crew leads**: in their portal a cleaner sees their crew and, on each accepted crew job, who else has
  accepted (first name and initial); a lead also sees the places still open and offers out.
- **Subcontractor companies** (`/app/cleaners/subcontractors`): contact, areas, workers and former workers,
  changes by Owners and Managers, pausing and ending by the Owner with a reason. The contact's link opens
  their own workers only: who is ready and, by name only, what each still needs; their weekly hours; their
  upcoming work (the street once accepted); their crews. They can say a worker will be away (booked work it
  touches goes to a person in Dispatch) and ask the office. Ending the relationship ends the contact's link;
  the workers keep their records.

**Tests:** `convex/cleanersCrews.test.ts`: assembling a crew with a member away and the open places reported;
pressing twice offers nobody twice and the job keeps one team; a decline reopens the place and a later round
adds to the same team; no place offered twice while offers are out; a permanent crew change leaves the job's
team as it was, with dated lead changes; requirements and date exceptions in Dispatch both ways; the impact
preview before saving, with nothing removed from the job; Office can read but not change availability or
crews; the crew lead's view; the subcontractor contact's scope, refusals for anyone else's worker and for a
cleaner's link, and the end of access with the relationship; tenant isolation for crews, jobs and previews.

**Visually inspected:** crews and the crew builder at 1440 and 390 wide (including making an offer from the
screen); a profile's availability with the single-date dialog and its preview; subcontractor companies at
1440 and 390; the contact's portal and a crew lead's portal at 390; the directory header for Owner and Office.

**Found and fixed while inspecting:** the builder showed only Dispatch's first reason, so a cleaner who cannot
work that day looked like "outside their areas, check first"; a cleaner with no pay arrangement was labelled
"check first" though they could not be chosen; the builder's sticky footer put its button under the floating
team dock; the builder invited more offers than places with offers already out; on phones the jobs strip
stretched the page wider than the screen.

**Not done, and why:** Selestial does not text or email a subcontractor contact: the send policy needs a
recorded permission for each address, and a contact is not yet a person the compliance records can hold
permission for. The office makes the link and sends it; that is said on screen. A contact sees no pay (pay
summaries are Phase 4). A subcontractor worker's pay goes through their company, which Dispatch cannot yet
state on an offer, so such a worker is shown as not offerable for that reason.

### Phase 3, second pass (November 18)

Main's Phase 3 was checked against the brief's Phase 3 list and its required tests (overlapping jobs, changed
availability, crew membership changes, reassignment, access revocation). Four gaps were found and fixed.

- **A job's team is shown against the job.**
  - Before: the "Teams for jobs" card and the profile listed the people a team was assembled with, as if they
    were all still on the job. Someone who declined, dropped out or was released stayed listed, and a
    replacement Dispatch put on the job was missing.
  - Now: each person shows where they stand, read from the job's own assignments (`lib/cleaners/teams.ts`):
    Accepted, Offer out, Declined, Did not answer in time, or No longer on this job. Anyone on the job who was
    not assembled with the team is listed as "Added to the job in Dispatch".
  - The card shows the job's places (accepted, offered, open). The team still records who it was assembled with.
  - On a profile, a job team is current only while the job is ahead and the person is still on it.
- **Ending a subcontractor relationship stops new work through it.**
  - Before: workers of an ended subcontractor stayed "Ready for assignments" and could be offered work.
  - Now: their readiness says they are not taking work, and why. Dispatch excludes them, and an offer already
    out can no longer be accepted.
  - Jobs they accepted are left as they are and handed to a person in Dispatch.
  - The end dialog lists those jobs and open offers before the Owner confirms. The worker's profile shows
    "Relationship ended" on the company.
  - Pausing still changes nothing about the workers, as its screen says.
- **Accepting an offer re-checks readiness for that job.**
  - Before: acceptance re-checked engagement status, overlaps and time off, but not requirements. A document
    that lapsed, or a requirement applied after the offer went out, did not stop an acceptance.
  - Now: it does, with the requirement named. A job someone already has is never touched.
- **Hand-offs name what they are about.**
  - Before: the "Decide X's upcoming jobs" task (suspend, end, or a subcontractor ending) and the "reminders went
    unanswered" task lost their details when they became questions for a person.
  - Now: the question itself names the reason and the jobs, or what the reminders were about.

**Tests added** to `convex/cleanersCrews.test.ts`:

- **Drop and replacement:**
  - A team member drops out and Dispatch puts someone else on the job. The team card, the team record and both
    profiles say so.
  - The dropped cleaner's portal no longer shows the job or its street. The lead's portal shows the replacement.
- **Overlapping and back-to-back work:**
  - A crew member with an overlapping visit is not counted for the crew and is refused when chosen. The other
    members are offered, and the open place stays visible.
  - A visit inside the company's time between jobs is refused.
  - Releasing the first visit frees the member for both.
- **Claimed skills:** a skill claimed from the portal stays out of Dispatch until a manager confirms it. Office
  cannot confirm it, and a declined claim never becomes a skill.
- **Ending a subcontractor:**
  - The Owner sees the preview first; Office cannot read it.
  - Pausing changes nothing.
  - Ending: the worker is not taking work, the accepted job stays theirs and goes to a person with the job
    named, the open offer cannot be accepted, and Dispatch and a manual offer both refuse them.
- **Lapsed requirement:** a requirement applied after an offer went out stops its acceptance until a person sets
  it aside.

The new Dispatch and subcontractor tests were also run with their fix switched off, and failed.

**Visually inspected** against a local backend with seeded data, at 1440 and 390 wide:

- the crews page, including a job team after a drop and a replacement;
- the crew builder for a job that overlaps a crew's other visit, and for a commercial job with a member away;
- a profile's crews after a drop;
- a worker whose subcontractor relationship ended (profile and builder);
- the subcontractor end dialog with its preview;
- the crews page as Office.

Found while inspecting: the worker's profile did not say their company's relationship had ended. Fixed.

**Not done, and why:**

- A travel limit is still shown, not enforced. Selestial has no drive times to check it against.
- Offers that can no longer be accepted are not withdrawn when a relationship ends; they expire. The same holds
  when an engagement ends.

## Phase 4: performance, coaching, check-ins, Chat, pay

**Works end to end (functions, tests and screens):**

- **Measures from verified records only** (`convex/lib/cleaners/performance.ts`), each with its definition,
  the period (90 days), the sample and the records themselves:
  - *Accepted jobs kept*: jobs a person released, cancelled, moved or covered are left out; saying they could
    not attend and a no-show declared by a person are counted apart.
  - *On time when checked in*: by the end of the arrival window with five minutes' grace; a job with no
    check-in recorded is never counted as late; late arrivals they told the office about are shown apart.
  - *Offers answered*: declining is an answer; silence is shown apart; offers that never reached them or were
    withdrawn are left out.
  - *Completion reports on their own jobs*: shown, not scored; a crew job's report is not put on one member.
- **The score** (`selestial.cleaners.score.v1`): reliability 50 points, punctuality 30, answering offers 20.
  Deterministic; each part's points are shown; a part with fewer than five records is left out and its points
  shared among the others, which the explanation says; with fewer than five accepted jobs there is no score
  and the page says "Not enough history". It is not used to rank people or by Dispatch, and says so.
- **Disputes**: a manager or the cleaner (from their portal, about the whole record) flags a record; it is
  left out until someone other than whoever raised it (or the Owner) upholds or corrects it. The assignment
  itself is never changed. Raising the same dispute twice finds the first.
- **Suggestions that rest on records**: a no-show to talk about, arrivals without word, offers going
  unanswered (checked as a contact problem first), recognition for a clean record, disputes to decide. Each
  lists the records behind it.
- **Coaching and feedback**: internal notes, shared feedback, training and coaching items with actions and a
  follow-up date. Selestial's drafts are written from the records and stay drafts until a person publishes
  them; only published shared feedback reaches the portal, where the cleaner replies; withdrawing removes it.
  Drafts waiting, follow-ups due and disputes appear in Needs attention. Coaching is never a disciplinary
  step (that remains a personnel request). Office sees none of it, including in the history.
- **Idle-worker check-ins**: an active, ready cleaner with no accepted work, answered offer or portal activity
  for the company's window gets a check-in from Dispatch under its permission (Propose by default). The
  answer is kept: still available, fewer jobs, a break (recorded as time away, so no work is offered) or
  wanting to stop (a person is told; the engagement is not ended). Unanswered check-ins go to a person after
  the company's limit, and the attention list says "Not answering is not the same as leaving".
- **Chat** (`convex/lib/chat/cleanerTools.ts`), through the same functions as the screens: who is free and
  ready in a window; what stops people becoming ready; preparing onboarding reminders (the exact list is
  approved in chat, then Recruiter's permission applies, and nobody gets a second); a crew suggestion for a
  job; explaining a cleaner's score; drafting a coaching note. Office is not offered the last three.
- **Pay**: the Owner's summary shows the arrangement, its history, and the pay each job's offer stated; the
  cleaner sees their own behind a code. Approved earnings and payments come from Finance › Team Pay (see the
  second pass below); the cleaner sees those through their earnings statement link.

**Tests:** `convex/lib/cleaners/performance.test.ts` (no score with little history, silence versus a no,
missing check-ins, company-side cancellations, crew completion, disputes, deterministic scoring with parts
left out, recommendations) and `convex/cleanersPerformance.test.ts` (the score from real records and its
access; disputes decided by someone else, from the portal and not for anyone else's record; drafts,
publishing, replies and withdrawal; check-ins asked for under Propose, a break, "stop", and silence handed to
a person with nothing changed; the Chat questions, the reminder approval and no duplicates, and what Office
is offered).

**Visually inspected:** performance and coaching for a cleaner with a mixed record, a clean record (390 wide)
and no history; the section as Office; a check-in answered from the portal at 390; the full Needs attention
list with coaching drafts and a disputed record.

**Found and fixed while inspecting:** disputing someone else's record from a portal answered "That record is
not yours", which confirmed it existed; it now answers "Not found." The score's note repeated itself, and
"Not enough history" was said twice.

**Not done, and why:** Selestial has no Quality agent, so there is no quality measure (no inspections or
customer ratings exist to measure). Team Coordinator does not exist; Dispatch and Recruiter run the routine
follow-ups that belong to their own work.

### Phase 4, second pass (November 18)

Main's Phase 4 was checked against the brief's Phase 4 list, its gate and its required tests (missing
history, disputed records, duplicate follow-ups, permissions, changes requiring human approval). Four gaps
were found and fixed.

- **Sensitive requests rest on records, and a dispute stops them.**
  - Before: a disciplinary record, suspension, ending or rehire restriction could not name the job records it
    was about, and nothing stopped one being approved while those records were disputed.
  - Now: the request dialog lists the person's own records of concern (with what each shows) to attach, and
    the request keeps them.
  - A record still in dispute blocks approval until the dispute is decided. A record corrected after a
    dispute blocks approval, and cannot be attached to a new request. Declining is always possible.
  - Another person's record answers "Not found."; a pay change cannot rest on job records.
  - The request card shows each record and its dispute, and Approve is disabled while one blocks it.
- **Pay reads Team Pay in full.**
  - Before: three totals only.
  - Now also: payments recorded in Team Pay (day, method, status, the jobs covered, and a reference shown
    only by its last four characters, so an account or routing number typed there never shows); adjustments
    waiting for the Owner's approval, with their reasons; approved earnings; and, beside the pay each job's
    offer stated, where Team Pay has that job.
  - Still Owner only. No second ledger: every figure is read from Team Pay.
- **The score says how fresh it is**: the newest record it counts, and that it is worked out live from the
  records as they are now.
- **Late check-ins are called check-ins**: "Checked in late, without word" instead of "Late without word", so
  a check-in time is not read as a confirmed late arrival. The coaching draft about arrival times tells the
  cleaner how to have the record corrected if they arrived on time.

**Tests added** to `convex/cleanersPerformance.test.ts`:

- **A finding to an outcome:**
  - The finding lists its record, and the score reports its freshness.
  - A disciplinary request rests on that record.
  - The cleaner disputes it from her portal, and approval is refused until it is decided.
  - Once the record is corrected, approval is refused, and a new request on it is refused; the request is
    declined with a note and nothing about her changes.
  - A request on a record that stands is approved and carried out.
- **Pay from Team Pay:** approved, paid and waiting figures, the adjustment waiting, the payment with its
  reference masked (the full account and routing numbers appear nowhere in the answer), each job's Team Pay
  state beside its stated pay, and Manager refused.

The approval test was also run with the dispute check switched off, and failed.

**Visually inspected** against a local backend with seeded records, at 1440 and 390 wide: performance and
coaching with a disputed record and a draft from the no-show; Pay with payments, an adjustment waiting and
each job's Team Pay state; the request dialog with records to attach; the request card blocked by a dispute;
a cleaner with too little history; the section as Office.

**Found and fixed while inspecting:**

- On phones, the profile's cards were 9 pixels wider than the screen, with their right edge cut off, because a
  long job name held the column open. The cards now shrink to the screen in every section.
- A long record name made its checkbox smaller than the others.
