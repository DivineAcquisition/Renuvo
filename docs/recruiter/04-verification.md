# Recruiter: verification

Everything below ran on synthetic data. No real applicant was emailed or texted, no real inbox was
read, nothing was purchased, no real offer was made, and nothing was deployed.

## Automated tests (`npm test`)

60 Recruiter tests in four files, alongside the 145 that were already there (205 pass). `recruiterProviders.test.ts` runs the Resend and Claude adapters against a fake `fetch`: the request each sends, plain-words failures, signed and unsigned webhooks, a bounce arriving by webhook, Claude's answer passing through the same checks as the rules reader, and the fallback to rules on a refusal, an error or a malformed answer.

| Scenario from the brief | Test |
|---|---|
| Indeed application with a direct applicant address | `recruiterIntake` "records an Indeed application…" |
| ZipRecruiter application with a verified usable relay | "uses a ZipRecruiter relay only once the Owner has confirmed…" |
| Notification-only sender | "does not write to a notification-only sender…" |
| Missing contact address | "marks an application with no usable address as contact needed…" |
| Conflicting addresses | "asks a person when two addresses could both be the applicant's" |
| Applicant address inside a resume | "finds the applicant's address inside a resume…" |
| Duplicate notifications | "files repeat notifications under the one application and invites once" |
| Same person applying to different roles | "keeps one person and two applications…"; also "never merges two people on a name alone" |
| Incorrect role mapping | "holds an application whose role matches no hiring need…" |
| Closed role | "sends nothing for a role that is paused or closed…" |
| Bounce and failed delivery | `recruiterInvite` "treats a bounce as a wrong address…", "also records a bounce the email service reports later", "a send that died half way…" |
| Applicant question | "pauses reminders while an applicant's question is unanswered" |
| Withdrawal or no-contact request | "stops everything when the applicant withdraws or asks not to be contacted" |
| Completion before a scheduled reminder | "stops reminders the moment the application is submitted" |
| Expired or revoked form link | "an expired or revoked link shows nothing and accepts nothing" |
| Form save and resume | "saves a draft, lets the applicant return to it…" |
| Worker retry after successful sending | "does not send a second invitation when the send is retried…" |
| Malicious instructions in email or attachments | `recruiterIntake` "treats instructions inside an email or a resume as text, whoever reads it" |
| Interview scheduling conflict | `recruiterHiring` "confirms an interview only when a slot is reserved…", "with a calendar connected, a time the interviewer is busy at is never confirmed" |
| Unauthorized offer sending | "no offer goes out without a person…" |
| Cross-tenant access attempts | "keeps companies apart: records, files, links and inboxes" |
| Approved applicant who is still not dispatch-ready | "opening an offer accepts nothing; accepting it hands off to onboarding and makes nobody dispatch-ready" |

Also covered: promotions, suggested candidates and personal mail are separated and personal mail
leaves nothing behind; forwarded mail; the inbox checkpoint and expired authorization; review-first and
automatic invitation; reminders on schedule, at the limit, on Propose, and by text only with consent;
uploads; screening evidence and contradictions; automatic decline only when switched on; the fairness
guard; urgent requests; retention and deletion; the agent tools; pausing Recruiter.

**The first end-to-end proof** is one test, `recruiterInvite` "the first end-to-end proof…": a genuine
notification enters the test inbox among other mail, the recipient is resolved, one invitation is sent
after approval, the applicant completes the tokenized form, follow-ups stop, and an evidence-backed
screening summary reaches the owner.

## The applicant pages, in a real browser

`tests/e2e/applicant-pages.mjs` drives the actual pages at phone size against a **local** Convex
backend (the one `convex dev` runs with no account) with a real file upload. 33 checks, all passing on
November 15, 2026: invitation → application page (fetching and reloading starts nothing) → prefilled
details → draft saved → return visit in a second browser → review → resume upload → submit →
confirmation → screening with the owner; interview page → choose a time → confirmed; withdraw on the
page; offer page (fetching, opening and reloading accepts nothing) → confirm → accepted → onboarding
handoff with the worker not dispatch-ready; tampered and wrong-kind links.

Running it also showed that a real Convex backend accepts the schema, indexes, functions and cron
entries.

```
env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous npx convex dev      # local backend, leave running
npx convex env set ACTION_LINK_SECRET <any 32+ characters>
npx convex env set EMAIL_PROVIDER mock
npx convex env set MESSAGING_PROVIDER mock
npx convex env set LINK_ORIGIN http://localhost:3100
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.selestial.test
npx next dev -p 3100
node tests/e2e/applicant-pages.mjs
```

It is not part of `npm test`: it needs a running backend and a browser.

## Not verified

- Any real mailbox, email service, text service, calendar, signing service or model. The Resend and Claude adapters are built but have only met stand-ins.
- The Indeed and ZipRecruiter formats against real notifications (`05-assumptions.md`).
- The inbox run and the scheduled sweeps left running on a schedule; they were called directly.
- Accessibility beyond labels and button semantics; other languages; very slow connections.
- The owner-facing screens, which are not built.
