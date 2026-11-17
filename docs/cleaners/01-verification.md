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
