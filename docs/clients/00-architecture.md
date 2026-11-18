# Clients & Properties

**Operations → Clients & Properties** (`/app/clients`) is where a cleaning company sees who it works for,
what it does for them, where, and what happens next. It replaced Customers & Properties on November 18,
2026; `/app/customers` and `/app/records` redirect here with their query kept.

It reads the records the rest of Selestial already keeps. It adds no second customer, conversation,
agreement or money database: every number and state on it comes from the record that owns it.

## Decisions on record (November 18, 2026)

| Question | Decision |
|---|---|
| Plans | A running recurring plan books its visits 28 days ahead, through the same visit creation as a manual booking, at the plan's agreed price. A standing arrangement (short-term rentals) holds terms only; turnovers are booked one by one. |
| Prospects | A prospect is a relationship status on the same client record, not a separate list. A customer added in Sales starts as a prospect; booking a visit (by a person, a plan, Sales or the online booking page) makes them a client; history stays. The deal itself lives in the Sales pipeline. |
| Sales and Clients plans (decided November 18, 2026) | Both stay: Sales recurring plans (made by Sales bookings and proposals) and Clients service plans. The client's profile shows both, each changed where it lives; setting up a Clients plan at a property with a running Sales plan warns that it books visits on top. |
| Messages | Threads plus sending: texts and emails both ways, notes, scheduled follow-ups, take over and hand back. |
| Access | Office adds and edits clients and properties. Access instructions and office notes are for Owners and Managers only, and never appear in search, previews, Chat or agent summaries. Archiving and merging need an Owner or Manager. |
| Billing | The Owner's, as Finance is (decision of November 15, 2026). Enforced by the server, not by hiding the tab. |
| Agents and Chat | Draft only. Chat never sends to a client and never changes a plan; a person does, on the screens. |

## Where things live

| Concern | Record (owner) | Read and changed through |
|---|---|---|
| Client identity, relationship, owner, communication preferences, private notes | `customers` | `convex/clients.ts` |
| Contacts and their roles (primary, billing, signer, site) | `clientContacts` | `clients.saveContact` / `removeContact` |
| The directory: one row per view a client is in | `clientViews` (derived, rebuilt by `refreshClient`, never edited, not exported) | `clients.directory` (server-side search, filters, sort, pages) |
| Properties, details by kind, crew / client / office notes, access | `properties` | `convex/clientProperties.ts`, `convex/properties.ts` |
| Visits | `jobs` (with `planId`, `planDate`, `skipped`) | `convex/jobs.ts`, `convex/lib/jobs/visits.ts` |
| Plans | `servicePlans` | `convex/servicePlans.ts`, `convex/lib/clients/plans.ts` |
| Agreements, proposals, files | Company Agreements (`agreements`, `agreementLinks`, `agreementFiles`) | `convex/clientDocuments.ts` reads them under each record's own access rule |
| Messages to the client | `messages` (purpose `customer_message`, plus Finance's invoice messages) | `convex/clientConversations.ts`, sent by `convex/messaging.ts` |
| Texts from the client | `inboundMessages` (excerpt only) | filed by `convex/inbound.ts` → `lib/clients/conversations.ts` |
| Internal notes | `clientNotes` | `clientConversations.addNote` |
| Money | Finance (`invoices`, `payments`, `refunds`, `invoiceCredits`) | `convex/clientBilling.ts` (Owner only) |
| Open work, "Selestial is handling" | `tasks`, `approvals` | `lib/clients/signals.ts` |
| Deals, quotes, proposals, bookings, Sales plans | Sales (`salesOpportunities`, `salesQuotes`, `proposals`, `bookings`, `recurringPlans`) | `convex/clientSales.ts` reads them for the profile; changed in Sales (`/app/agents/sales`) |

## Statuses kept apart

- **Relationship** (prospect, active, paused, former) is not the record status (active, archived), and
  neither is the plan state (setup, active, paused, ended).
- **A visit** is shown as booking (booked, cancelled, completed), staffing (who accepted, how many still
  needed) and outcome, separately. Signing a proposal books nothing: its card says so.
- **Money** is invoiced, collected (less refunds), processing, overdue, owed but not yet due, credited, and
  estimated from booked visits. The estimate is labelled as not money owed.
- **Messages** show their real delivery state from the outbox: sending, waiting (quiet hours), scheduled,
  sent without confirmation, delivered, failed, not sent with the policy's words.

## Sending to a client

Every message goes through the one sending policy (`convex/lib/messaging/policy.ts`), when it is planned
and again when it goes: company suspended, agent paused, sender not ready, no usable address, do-not-contact,
no recorded permission, quiet hours. The composer shows the recipient, the address and the policy's answer
before anything is written, and the server refuses a send whose address changed since the person looked.

Permission is recorded against the client's own phone and email. A contact whose address is not the
client's has no permission record of its own yet, so the policy refuses it and the screen says why.

A reply or an opt-out from the client (or one of its contacts) stops every scheduled follow-up written
before it. Taking over stops the agents' follow-ups and refuses agent drafts until the conversation is
handed back; a person's own scheduled messages stay.

Texts from the client are kept as their first 200 characters with links removed, like every inbound text
(the rule in `convex/inbound.ts`). Inbound email from clients is not received yet.

## Plans

`bookAhead` books every series day in the next 28 days that is not booked, skipped, paused or ended,
through `createVisit` (the body of `jobs.create`), at the plan's price, with `priceSource: "plan"`. A day it
cannot book opens one Dispatch task for the plan. A daily cron ("service plans book their visits ahead")
keeps the horizon full. Pausing, ending and changing "this and future visits" require the exact list of
booked visits the person saw; skipping one visit never rebooks that day.

## Access and privacy

- Access instructions and office notes: Owners and Managers, on the property page and the visit panel.
  Office sees that they exist. The assigned crew sees access on their own job page.
- They are excluded from directory search text, previews, the quick view, Chat (for every role) and
  agreement prefill done from Chat or by Office.
- Billing queries are `ownerQuery` and check Finance's `read` capability. Payments are described by kind;
  card and bank details are never read.
- Erasure (`lib/trust/erase.ts`) clears contacts, notes and inbound texts; the data export includes the new
  tables except the derived directory.

## Chat

Attaching a client gives Chat what the profile shows that person: contacts, properties, plans, open work,
recent visits, whether a person has taken over, and billing for the Owner only. `draft_client_message`
returns a link that opens the draft in the client's Conversations; nothing is sent until a person sends it.

## Screens

`src/components/app/clients/`: `directory.tsx` (attention strip, view tabs, filters drawer, table and phone
list, bulk actions with an exact preview), `quick-view.tsx`, `profile.tsx` (header, tabs, a select on
phones), `overview.tsx`, `properties.tsx`, `services.tsx`, `conversations.tsx`, `documents.tsx`,
`billing.tsx`, shared pieces in `bits.tsx`, `parts.tsx`, `menu.tsx`, `edit.tsx`. URL state (view, filters,
sort, tab, property, services view, open visit) lives in the address, and scroll is restored on return.

## Sales

The Sales workspace (`/app/agents/sales`) and Clients & Properties share the customer, property and visit
records:

- A customer or property added in Sales is filed into the directory at once (`refreshClient`), as a
  prospect until a visit is booked. Visits Sales makes (one-time bookings, plan visits, proposal turnovers)
  go through `visitBooked`, like `jobs.create` and online booking.
- The Recurring view counts a running Sales plan on a home; a visit a Sales plan made (`planVisits`) does
  not count as one-time work.
- "Needs follow-up" includes a deal whose next action is overdue.
- The profile shows deals (stage, milestone, owner, next action), proposals (version, sent, opened,
  expiry), bookings (booking, payment, agreement and time each in their own words), quotes, and Sales plans,
  each linking to its Sales page. An accepted proposal says plainly that it books nothing by itself.
- "Create booking or proposal" offers a quick visit, a Sales booking, a Sales proposal, or an agreement only.
  A prospect's main action is "Quote or book in Sales".
- Chat's client record lists open deals and Sales plans.
