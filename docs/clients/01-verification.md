# Clients & Properties: verification and status

What was checked, how, and what is and is not end to end. Date: November 18, 2026.

## Automated tests

Full suite: 81 files, 925 passed, 19 skipped (the same 19 skipped before this work). Type check, lint and
the production build pass.

| File | What it covers |
|---|---|
| `convex/clients.test.ts` (12) | One record in every view it belongs to; server-side search that never matches access instructions; server-side paging; duplicate detection; prospect to client on the same record with history; access and private notes for Owners and Managers only; stale saves refused; one primary contact; archive blocked by upcoming visits or plans, history kept; relationship changes by role; company isolation; preparing the directory for older clients. |
| `convex/servicePlans.test.ts` (14) | Weekly plan booked 28 days ahead at its price, first visit priced as a first visit; nothing booked before start; skip one visit only; pause only after the person saw the exact visits, resumes on its own; pause until resumed; change this and future visits; end without touching history; STR standing arrangement holds terms only; plans by Owners and Managers; property details by kind; address change shows its impact first and holds the service area; property archive blocked by a running plan. Scenarios: residential client with recurring and one-time work in both views from one record; a signed proposal never read as booked service; every part of a profile kept to its own company (profile, plans, property, conversation, composer, documents, proposals, billing, pause, notes). |
| `convex/clientConversations.test.ts` (6) | Send through the sending policy to the client's own number; a contact without their own permission refused, with the reason; the address seen must still be current; quiet hours hold a message; STOP refuses later sends and shows in the thread; a reply stops a scheduled follow-up and is filed as an excerpt with a reply task; a contact's text filed under the client; takeover stops agent follow-ups and drafts, keeps the person's own, and only the holder or a Manager hands back; notes never become messages; billing messages hidden from Office. |
| `convex/clientBilling.test.ts` (4) | Invoiced, collected, overdue, owed-not-due and estimated kept apart, no card details; Manager and Office refused by the server; Chat never receives access instructions for any role, billing only for the Owner; `draft_client_message` sends nothing and links to Conversations. |
| `convex/chat.test.ts` | The unavailable send tool now says Chat never sends to clients, and still sends nothing. |
| Existing suites | Visits and Dispatch (the `jobs.create` body moved into `lib/jobs/visits.ts`), consent and inbound texts (`inbound.ts` now also files client texts), agreements (access prefill now Owners and Managers outside Chat), Finance, data export and erasure. All pass. |

## Visual checks

A temporary preview page (not committed) rendered every screen against fake Convex data, at 1440 px and on
an iPhone 13 viewport, as Owner, Manager and Office:

- Directory: populated and empty; attention strip, view tabs, residential sub-views, filters drawer, bulk
  preview, phone list.
- Profile for a residential client, a business with offices and a rental, and an STR host: Overview,
  Properties (home, office, rental detail; Office role without access codes or office notes), Services
  (upcoming, history, plans, the pause and change dialogs listing affected visits, the new-plan form, quotes
  and proposals), Conversations (thread, refused contact, notes, scheduled follow-ups, a Chat draft
  arriving in the composer), Documents (renewals, signing provenance, replaced versions, files), Billing
  (Owner; the Owner-only message for others).
- 20 pages × 2 viewports × 2 roles: no sideways scroll, no stuck loading state, no console errors. The one
  animation (a working agent's dot) stops under reduced motion.

## End to end, and not

| Works end to end | Not yet |
|---|---|
| Directory, search, filters, paging, deep links, return with filters and scroll | — |
| Plans booking visits ahead; pause, skip, change, end | Rebooking a cancelled day after a pause ends is deliberately not done; a person books it. |
| Sending texts and emails through the policy; scheduled follow-ups; take over | Messaging contacts other than the client's own phone and email: they need their own permission record, which does not exist yet. Inbound **email** from clients is not received. Delivery needs Telnyx (texts) and an email provider configured on the deployment. |
| Texts from clients filed in the thread | Kept as a 200-character excerpt, links removed, the existing rule for inbound texts. Changing that is a retention decision for the Owner. |
| Documents read from Company Agreements with their access rules | Uploading from the client page: uploads stay in Agreements. |
| Billing read from Finance, Owner only | Changes (issue, payments, refunds, credits) stay in Finance, where their effect is shown first. |
| Chat reads a client and drafts a message | No agent drafts client follow-ups on its own yet (Customer Care and Retention are not built). The takeover and stop rules are in place for when one does. |
| — | Convex code generation was run locally (`api.d.ts` regenerated by script); a real deployment still has to run `npx convex dev` / deploy to push the new tables and indexes. |
| — | No Sales pipeline exists in this repository, so prospects are not linked to one. |
