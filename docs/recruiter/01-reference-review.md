# Reference review: Novara's recruiting and onboarding

`DivineAcquisition/novaracleaningui` was cloned read-only and reviewed on November 15, 2026 (shallow
clone of the default branch). Every entry point named in the brief was read with its dependencies. It
is a reference for behavior, not a specification, and several of its flows are not production-ready.
None of Novara's pay, geography, legal wording or exceptions was copied.

## What Novara does

- **Indeed intake.** A Gmail query (`from:indeedemail.com subject:"New application" newer_than:7d`)
  reads metadata and a 300-character snippet, never the body. It takes the Indeed relay address as the
  applicant's email, the name from the snippet and the role from the subject. No real email, phone or
  application id is extracted. The cursor is set once and never advances; progress relies on the 7-day
  window and a seen-table. At most 50 messages per run. **No ZipRecruiter handling exists anywhere.**
- **Invitation.** Sent through Resend to the relay address, with an idempotency key per Gmail message.
  No reminders for an unfinished application.
- **Application session.** A 192-bit token, stored raw, sliding 7-day expiry, autosave. The form asks
  for a government photo ID, age, work authorization, vehicle, licence and insurance, and requires SMS
  consent.
- **Rules engine.** First-match rules returning pass / not a fit / waitlist / needs review. Most
  "not a fit" rules cannot fire, because validation rejects earlier with no record kept.
- **Phone screen.** A scripted scorecard with four numeric ratings and no thresholds. No scheduling.
- **Onboarding.** Token routes for agreement (DocuSeal), setup, supplies, W-9 and training, and a
  first-job gate over those flags.
- **Urgent hire.** Broadcasts a premium first-job offer to applicants and assigns the first to claim it,
  skipping the background check, W-9, training and the first-job gate.

## Preserve, adapt, replace

| Novara behavior | Verdict | In Selestial |
|---|---|---|
| Tokenized, resumable application with autosave | **Preserve** | `/c/apply/[token]`, drafts saved server-side, return visits on any device. |
| Idempotency key per invitation | **Preserve** | `messages.dedupeKey`, plus claim/send/settle so a crash never resends. |
| Outcome with a recorded reason | **Preserve** | Per-criterion outcomes with evidence; closure reasons stored explicitly. |
| First-claim-wins as one transaction | **Preserve** (as a pattern) | Interview slot booking is one transaction. |
| Readiness gate before first job | **Preserve** | Onboarding requirements a person records; Dispatch reads `cleaners.status`. |
| Indeed parser | **Adapt** | Full body, labelled fields with provenance, per-company connection, pluggable job boards, ZipRecruiter added. The relay address is *not* assumed to reach the applicant: it is "relay, unverified" until the Owner confirms that board. |
| Gmail polling window | **Adapt** | Cursor saved after each filed page; replay is safe because filing is idempotent. |
| `decide.ts` rules | **Adapt** | Criteria are per role, set by the Owner, evaluated at one point, and every result is kept. |
| First-job gate | **Adapt** | The requirement list is the company's setting, not code. |
| Phone-screen scorecard | **Adapt** | Interview feedback is notes plus advance / hold / do not advance. No numeric score. |
| Raw tokens at rest and in query strings | **Replace** | Signed tokens that are never stored. |
| Token expiry reset on every save | **Replace** | Fixed expiry; a person sends a new link. |
| Photo ID, age, work authorization, vehicle/licence/insurance and mandatory SMS consent on the application | **Replace** | The application asks none of these. SMS permission is optional and separate. Identity and eligibility belong to onboarding, after legal review. |
| Hardcoded states, ZIP coverage, pay percentages, legal copy | **Replace** | Company settings and per-role fields. |
| Airtable dual-write | **Replace** | Not carried over. |
| Client-side writes of onboarding flags | **Replace** | Requirements are recorded by a signed-in Owner or Manager only. |
| Background-check and adverse-action stubs | **Replace** | Nothing is implemented or claimed. A background check can only be a requirement a person records. |
| Plaintext tax id | **Replace** | No tax or bank data is collected by Recruiter at all. |
| Urgent-hire bypasses | **Replace** | Urgent requests list who is in the pipeline and what each lacks, and propose outreach for approval. Nothing is skipped. |

## Bugs seen in Novara (not carried over)

- `hiring/apply/route.ts` writes `valid_drivers_license` from the vehicle answer, hardcodes
  `auto_insured: false`, and forces background and pay consent to `true`.
- Gate rejections write no applicant record, so there is no audit trail and no reapply date.
- `kit` accepts a client-sent `complete: true`; nothing ever sets `background_cleared`, so the
  automated flow cannot pass activation without a manual database edit.
- Email lookups use `ilike`, so `_` and `%` in an address act as wildcards.
- The apply endpoint is public and a session token can mark any open session submitted.

## Handoff into Dispatch

Novara makes a cleaner assignable with three flags set at admin activation. Selestial's equivalent is
one field, `cleaners.status = "ready"`, which Dispatch's eligibility already requires and which only a
person sets.
