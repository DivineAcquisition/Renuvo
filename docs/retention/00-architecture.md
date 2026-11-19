# Retention agent: what it is built on

**Philosophy.** Earn the next service by protecting the promise of the last one.

Retention recognises when a customer relationship needs attention, understands the cause, coordinates a
response, and verifies what happened afterward. Every intervention follows
**evidence → diagnosis → action → verification → outcome**, and each step is a record. Sending a message,
booking a visit or handing work to another agent moves a case; none of them closes it.

`convex/retention.ts` is the privacy purge (data retention) and has nothing to do with this agent. The
agent lives in `convex/retentionAgent.ts`, `convex/retentionCare.ts`, `convex/retentionWork.ts` and
`convex/lib/retention/`.

## Reused, not rebuilt

| Shared system | How Retention uses it |
| --- | --- |
| Customers, properties, contacts | Read by id. A case points at the customer, the property and the visit it is about; nothing is matched by email. |
| Visits, checklists, photos, crew reports, completion review | The evidence for a concern (`lib/retention/evidence.ts`). A completed, reviewed visit queues Retention's follow-through (`jobs.ts` → `lib/retention/runs.ts`). |
| Both plan systems (`servicePlans`, `recurringPlans`) | Reconciled against booked visits and open invoices; changed through one preview-then-apply module (`lib/retention/planChanges.ts`) that calls the same visit cancellation and booking code the plans use. |
| Agreements | Real `lifecycle` dates and `renewalNoticeDays` / `terminationNoticeDays` terms. Retention prepares; it never renews. An agreement with only an expiry date is covered too. |
| Finance | Read for what is still due. A credit is written to Finance's own ledger only when the Owner approves it on an open invoice; refunds and everything else are handed to the Owner in Finance. |
| Dispatch | A correction visit is an ordinary visit made by `createVisit`, so Dispatch staffs it under its own permissions. `jobs.avoidCleanerIds` lets a person keep a cleaner off a visit; Dispatch reads it when ranking. |
| Authority and approvals | Eleven `retention.*` actions in the permission catalog. "Ask me first" goes to the one approvals queue as a `retention_action` proposal; `lib/retention/approvals.ts` carries it out after every check runs again. |
| Spending limits | Enforced for Retention's money actions (`permitFor` in `lib/retention/cases.ts`): per action and per day, and an unknown cost is never treated as zero. |
| Messaging and consent | Every message goes through the one sending policy, when planned and again when sent. Retention also checks whose conversation it is: a person who took over, a held case, or an open Sales conversation stops it. |
| Customer links | The same signed-token scheme as quotes and proposals (kind `care`), with a row per link so each is scoped, expiring, revocable and limited to named actions. |
| Tasks and events | Each open case keeps one task; every change is an event. |
| Chat | `lib/chat/retentionTools.ts` exposes the same six case tools the case's buttons run. |
| Billing | An AI reading of a customer's words is the `retention_assessment` task, with credits held first. Without a rate or credits the company's rules read, and nothing is charged. |

## Added

Tables (`convex/lib/retention/schema.ts`): `retentionSignals`, `retentionCases`, `retentionEntries`
(a case's evidence and history), `retentionActions`, `retentionFeedback`, `retentionLinks`,
`retentionRuns`. Company settings gain `retention` (the guarantee in the company's words, the public
review page, link and deadline lengths, what a customer may change themselves).

## Relationships at the right level

Six things are kept apart (`lib/retention/relationships.ts`): the account's relationship status, each
property's service health, each plan's status, each contract's renewal status, open recovery cases, and
repeat-purchase opportunities. Segments: residential recurring, residential one-time, commercial, office,
short-term rental, property management, project.

- A home without a recurring plan is one-time. Its completed job is not a customer who left.
- A standing arrangement (short-term rental) has no calendar, so no booked turnover is not a gap.
- A paused plan is a planned pause, not a missing visit.
- "No known open issues" is a statement about the record, never about satisfaction.

## Signals

`lib/retention/reconcile.ts` reads the records every ten minutes and after the events that matter. Each
signal says what happened, its source record and date, what it affects, whether it is a **fact**, **what
the customer said** or a **hypothesis**, what is not known, and a suggested step. The same evidence seen
again is counted on the same row; evidence the records no longer show is cleared.

Rules: repeated complaint about the same area at a property · commitment past its deadline · visit lost
on the company's side · visit moved more than once · running plan with no next visit · money paid for a
cancelled visit · service paused with invoices still due · customer asked to cancel or reduce · payment
dispute · renewal or notice deadline approaching · decision-maker changed · open issue before a guest
check-in.

There is no churn probability and no inactivity threshold.

## The five workflows

1. **New-customer follow-through** (`followThrough`). After a customer's first completed and reviewed
   service: checks the scope and preferences are on record, asks for feedback once, confirms the next
   service where a plan exists. Later visits are asked only when a person chooses to.
2. **Service recovery** (`lib/retention/recovery.ts`). Feedback, a customer's text, or a person opens one
   case per service. Evidence is gathered, the rules diagnose (quality miss, scope misunderstanding,
   scheduling, billing, insufficient evidence, serious concern), a first step is prepared with its
   estimated cost and routed by authority. Photos never cancel a complaint. Safety, damage, theft and
   staff conduct go to a person with no remedy prepared. Nothing touches a cleaner's pay or standing.
3. **Recurring-service continuity**. Skip, move, change cadence, pause service, pause billing, resume and
   end are seven different changes. Each is previewed (visits cancelled, future dates, billing, credits)
   and applied only for the visits shown. Pausing service never pauses billing, and the preview says so.
4. **Commercial, office and short-term rental** (`prepareRenewal`, `serviceReview`). Renewal cases carry a
   service review counted from the term's records, per site. A rental's open issue is ordered by the
   guest's arrival.
5. **Selective re-engagement** (`reactivationCandidates`, `prepareReturn`). A former customer is listed
   when a person marked the relationship former or their recurring service ended. Open issues, opt-outs
   and missing permission make them ineligible. One offer at a time, with no price or discount.

A sixth, smaller flow earns the next service after a good first one (`lib/retention/growth.ts`): when a
home customer with no recurring plan gives feedback, describes no issue and did not rate the service 3
or lower, Retention prepares a recurring-plan offer and hands it to Sales under "Offer a recurring plan
at the standard price" (Ask me first until the Owner changes it; Off prepares nothing). Retention names
no price or discount. The case closes as "recurring plan started" only when a plan is on record, and as
"offered, none started" thirty days after Sales finishes otherwise.

## Customer email

`convex/retentionInbox.ts` reads customers' replies in an inbox connected for Care & Retention. It is off
until the Owner turns it on in the Playbook, and nothing received before that moment is read. Headers are
listed; a message is opened only when its sender's address is on exactly one active customer's record.
Only the customer's own new lines are read (`lib/retention/mail.ts` drops the quoted original, forwarded
headers and signatures), by the same rules that read a customer's text. Automatic replies are skipped.
Nothing is sent, deleted or marked. It keeps its own cursor on the connection, so an inbox shared with
hiring is read by Recruiter and Retention independently.

## What the people who run the company are told

Through the shared notices (`convex/lib/notify`), by email, under each person's own settings:

| Notice | When | Priority |
| --- | --- | --- |
| A serious concern needs a person | A case opens with a safety, damage, theft or staff-conduct concern | Critical: goes at any hour |
| A case needs your decision | A case starts waiting on a person and no approval is already waiting (the approval has its own notice) | High |
| A commitment is overdue | An open case passes its deadline; once per deadline | High |
| A case closed | A recovery, plan-change, renewal, offer or return case closes with its outcome. Routine first-service follow-through is not sent | Normal |
| Retention did this for you | A step carried out at Act and notify me | Normal |

Each is written when it goes, from the record as it is then: a case someone already took, decided or
closed sends nothing. The customer's own words are never put in the email. The person who did the thing
is not told about it.

The sidebar shows the same facts as badges: serious concerns nobody has taken, cases waiting on a person,
overdue commitments, then "Working" or "Waiting on replies".

## Customer pages

`/c/care/<token>` (`convex/retentionCare.ts`, `src/components/public/care-page.tsx`): give feedback,
describe an issue, review a proposed remedy, confirm a correction, manage a recurring service. Opening a
page changes nothing. Every change is an explicit step against what the customer was shown; pausing or
ending service also asks for the property's ZIP code; each link is limited to twenty changes in ten
minutes. Everyone is shown the same public review page, whatever they answered.

## Decisions on record (November 18, 2026)

| Question | Decision |
| --- | --- |
| Navigation | Needs Attention · Recovery · Continuity & Renewals · Re-engagement · Playbook, replacing the seven tabs recorded earlier. |
| Correction visits | No charge to the customer. The visit's price is the basis the crew is paid from, so a share-paid cleaner is paid; Finance leaves it out of invoicing and revenue. |
| Crew pay on a correction (November 19) | The Owner sets it each time. Retention prepares the visit and shows the original price in proportion to the time for reference, but fills nothing in. Nothing is booked, and nothing goes to Approvals, until the Owner sets the figure; setting it books the visit. A Manager cannot set it. |
| What the Owner is told (November 19) | Serious concern, case needs a decision, commitment overdue, outcome recorded. |
| Customer plan changes | Routed by the Owner's authority settings. A cancellation request is recorded at once either way. |
| Feedback | After the first service only, unless a person asks. A rating routes nothing. |

## Not built, and said so on the screens

- Memberships, prepaid packages and expiring cleaning credits do not exist in Selestial.
- No reservation calendar is connected, so lost short-term rental turnovers cannot be known.
- Texts and emails are not metered, so there is no messaging balance to check.
- Customer email is read only from a connected Care & Retention inbox with reading turned on. Without
  one, replies go to the company's own mailbox and Selestial does not see them.
- An email from an address on two customers' records, or on none, is left for a person.
- The Claude reader (`RETENTION_MODEL=claude`) is written and not verified against the live API: no key
  was available. The published rate cards give `retention_assessment` no rate yet, so the rules read.
