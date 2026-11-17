# Cleaners: what was verified, and what was not

No real text or email was sent, nobody was paid, and nothing was deployed. Tests use synthetic records.

## Phase 1: foundation, overview, directory, profiles

### Automated tests (`npm test`)

`convex/workforce.test.ts` runs the real functions in `convex-test`; `src/lib/app/cleaners.test.ts` covers
the directory's address, filtering and the CSV reader.

| Requirement | Test |
|---|---|
| Active is not ready; each blocker is named and says what it blocks | "separates being active from being ready…", "does not let a missing nice-to-have block work" |
| Payout readiness is never claimed | "does not let a missing nice-to-have block work" |
| Add asks before adding a possible duplicate; a double submit is one record | "adds a worker once, and asks before adding someone…" |
| Subcontractor company, contact and workers are separate; affiliation history is kept | "keeps a subcontractor, its contact and its workers apart…" |
| The four counts follow their definitions; conflicts are found and nothing is changed | "counts ready, onboarding, attention and working today…" |
| Availability is only for a stated window | "answers availability only for a stated window" |
| Pausing or ending needs a reason; the reason is hidden from office staff; accepted visits stay | "needs a reason to pause or end…" |
| Pay and classification are the Owner's in every read | "shows pay and classification to the Owner only, everywhere" |
| Import reviews problems and duplicates, refuses unconfirmed duplicates, and runs once | "imports a list with a review…" |
| Crew membership is history, with one lead | "keeps crews as membership history, with one lead" |
| Tenant isolation | "answers another company's records exactly like missing ones" |
| The export covers every new table | `convex/dataRights.test.ts` (existing check, now listing the five workforce tables) |

Full suite: 61 files, 651 tests passed, 19 skipped (the same skips as before). `tsc --noEmit`, `eslint`
and `next build` pass.

### In a real browser

The screens were rendered against a local Convex backend with a seeded company (13 people across every
state, two subcontractors, two crews, jobs today and later this week), at 1440 px and on an iPhone 13,
as the Owner and as an Office member. Screenshots are in `docs/screenshots/cleaners/`. What the
inspection changed:

- On blocked cards, "1 thing to look at" repeated the readiness line; it now counts only what is beyond it.
- A person free in the chosen window but not offerable now says "Free then, but cannot be offered work yet".
- The readiness list puts unmet checks first and compacts met ones into two columns.
- Identical weekly hours read as one line ("Every day, 7:00 AM – 6:00 PM").
- On a phone: compact count tiles with a "What these counts mean" disclosure, Add cleaner first, two
  attention items before "Show all", and the profile header beside its avatar.

Browser rendering used a local stand-in for sign-in that is not part of the repository; the product's
own sign-in (Clerk) was not exercised.

### Not verified

- Hundreds of workers in one company: the directory reads up to 1,000 and filters in the browser. It was
  exercised with 13.
- Concurrent imports with the same key rely on Convex's serializable mutations; not load-tested.

## Phase 2: onboarding, documents, portal, reminders

### Automated tests

`convex/workforceOnboarding.test.ts` and a new case in `convex/recruiterHiring.test.ts`.

| Requirement | Test |
|---|---|
| Only the Owner sets requirements; readiness and Dispatch block on the same requirement | "keeps the Owner's policy with the Owner…" |
| An upload is not a verification; sending back needs words; acceptance sets validity | same test |
| The same file sent twice is kept once | same test |
| Only the cleaner agrees to a statement; Owner-only files and decisions stay with the Owner; office sees states only | "never lets a person agree for the cleaner…" |
| Setting aside needs a reason and is never shown as accepted | same test |
| Expiry is read from the clock and warned about before it | "reads expiry from the clock and warns before it" |
| A real onboarding journey: invited, code, agree, upload, review, readiness updates; pay needs a fresh code; help reaches a person | "takes an invited cleaner through onboarding…" |
| The code is never stored | same test (no message body holds it) |
| Duplicate invitations close the earlier link; forged, used, expired and revoked links and codes do nothing; ending an engagement closes the portal | "closes old, expired and revoked links…" |
| Failed delivery is shown as not sent with the reason; the office can hand over the link | "says plainly when the invitation cannot be texted…" |
| Reminders: proposed first, sent once, limited, and silence decides nothing | "proposes first, sends once…" |
| Reminders wait while the cleaner's question is open | "holds reminders while the cleaner's help request is open" |
| A hire links to the existing worker by phone instead of adding them twice | "links a hire to the worker already on record…" |

Full suite: 62 files, 660 tests passed, 19 skipped. `tsc --noEmit`, `eslint` and `next build` pass.

### In a real browser

Against the local backend with mock texting: the Owner's requirements were added, one cleaner was invited,
the code was texted and confirmed, the policy agreed, an ID uploaded, hours set and a question sent, all
through the real functions. Rendered at 1440 px (the Owner's requirements, the profile's onboarding
review, an invitation that could not be texted, the cleaner's question) and on an iPhone 13 (the portal's
confirm step, home, hours editor and a bad link). What the inspection changed:

- The portal's "Before you can be offered work" now says where each item stands ("Photo ID: sent, the
  office is reviewing it"), not just its name.
- An invitation whose text was not sent is badged "Invitation not sent", not "Invited", with what to do next.

### Not verified

- Real texts through Telnyx: the mock provider was used. Quiet hours and carrier delivery reports follow
  the existing messaging paths, which have their own tests.
- Uploads from a real phone camera (HEIC); the server accepts the type, and a PNG was uploaded in the browser run.
