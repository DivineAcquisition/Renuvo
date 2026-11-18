# Sales: what it is built on

Sales turns an inquiry into a confirmed booking, a documented decline, or a next step with an owner
and a time. It works by text, email and intake forms. It does not make calls and does not contact
people who have not asked. Existing customers rebooking or coming back are Retention's.

## Reused, not rebuilt

| Shared system | How Sales uses it |
| --- | --- |
| Customers and properties | An inquiry matches or creates one `customers` row; an address becomes a `properties` row. A partial match waits for a person. |
| Services & Pricing | Every price is the pricing engine's `quote()` over a published service. Sales stores the result as an immutable quote version. |
| Authority and approvals | `sales.reply_and_quote`, `sales.follow_up`, `sales.confirm_booking` in the shared permission catalog; "Ask me first" goes to the one approvals queue. |
| Messaging and consent | Every message goes through the one outbox and `checkSend`: consent, opt-outs, quiet hours, sender readiness. |
| Tasks and events | Each open opportunity keeps one task; everything is recorded with `recordEvent`. |
| Billing | Reading a message with AI opens, reserves and settles an execution. Viewing records and pricing cost nothing. |
| Agreements | Sales reads whether a signed agreement is in force. It does not write or send one. |
| Finance | The Owner drafts a deposit invoice from the accepted quote; Finance issues and collects it. Sales reads the ledger. |
| Jobs and Dispatch | A booking is a job made by the same `createJob` the schedule uses, handed to Dispatch. Capacity uses Dispatch's own rules. |
| Company Chat | An opportunity can be attached to a chat; two read-only tools read the pipeline and one opportunity. |

## Added for Sales

Tables: opportunities, the conversation, prepared actions, runs, quotes and their versions, follow-ups,
forms and submissions, time holds, and the first review batch (`convex/lib/sales/schema.ts`).

The runtime (`convex/salesAgent.ts`, `convex/lib/sales/agent.ts`) runs once per event: a new inquiry, a
reply, a quote decision, a reminder coming due, an agreement or payment change, a person handing the
conversation back. A reader (the company's rules, or an AI model when one is connected) only reads the
customer's message into checked facts. Code decides what is asked, priced, sent and booked.

## Four states that are never confused

Open time (enough eligible cleaners are free) → reserved (a hold with an expiry) → booked (a job
exists) → crew confirmed (Dispatch's, when a cleaner accepts). The screens name each one.

## Decisions worth knowing

- **First review.** Until the Owner decides the first batch, nothing Sales prepares is sent. Deciding
  it changes no permission.
- **Conversations.** The tab is named Conversations and keeps the address `calls-messages`. Voice is
  not built and nothing suggests it is.
- **Advertising.** `sales.draft_ad_campaign` and the Google lead form stay as they were. A Google lead
  now files a Sales opportunity. The permission sits under Sales only for compatibility and should
  move to Marketing when Marketing is built; the Playbook shows it apart and says so.
- **Booking forms can be framed.** `/c/form/*` is the one path without `X-Frame-Options: DENY`, so a
  company can embed its own form.

## Not built

- Reading a customer's email replies. `internal.salesIntake.email` is the door; no mailbox is connected
  to it. Email is outbound only, and replies reach Sales by text and through the quote page.
- Voice, cold outbound, and sending an agreement or collecting a payment from Sales.
