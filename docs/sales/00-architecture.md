# Sales agent: what it is built on

The Sales agent turns an inquiry into a confirmed booking, a documented decline, or a next step with
an owner and a time. It works by text and email. It does not make calls and does not contact people
who have not asked. Existing customers rebooking or coming back are Retention's: a text from a known
client with no open inquiry stays in their client conversation.

The agent is a worker on the Sales workspace, not a second Sales product. An inquiry is a pipeline
opportunity, a quote is a booking-workspace quote, and a booking goes through the bookings engine.
A person and the agent work on the same records.

## Reused, not rebuilt

| Shared system | How the agent uses it |
| --- | --- |
| Pipeline (`salesOpportunities`) | An inquiry is an opportunity with `intake` set. The agent's stage is read from the pipeline stage and milestone (`agentStage` in `convex/lib/sales/agentOpportunity.ts`). Taking over is the pipeline's own `followUps: "paused"`. |
| Booking workspace (`salesDrafts`, `salesQuotes`) | The agent fills a draft and saves a quote through `saveQuote`, priced by `priceBooking` over a published service. A changed price is a new quote row; the old one is marked superseded and its link stops accepting. |
| Bookings engine (`convex/bookings.ts`) | `requestFromAgent` holds capacity, asks for the payment link through approvals, waits for a required agreement, confirms, and hands the job to Dispatch. |
| Booking Forms | The company's booking pages. The agent has no forms of its own. |
| Customers and properties | An inquiry matches or creates one customer; an address becomes a property. A partial match waits for a person. |
| Authority and approvals | `sales.reply_and_quote`, `sales.follow_up`, `sales.confirm_booking` in the permission catalog. "Ask me first" goes to the approvals queue as `sales_action` or `sales_quote`. |
| Messaging and consent | Every message goes through the Sales outbox and `checkSend`: consent, opt-outs, quiet hours, sender readiness. STOP and plain-language stops opt the prospect out. |
| Tasks and events | Each open inquiry keeps one task. Everything is recorded with `recordEvent`. |
| Billing | Reading a message with AI is the `sales_message_reading` task. Without a rate on the company's card, the rules reader is used and nothing is charged. |

## Added for the agent

Tables (`convex/lib/sales/agentSchema.ts`):
- the conversation (`salesMessages`)
- prepared actions (`salesActions`)
- runs (`salesRuns`)
- follow-ups (`salesFollowUps`)
- the first review batch (`salesBatches`)

Quotes gain a public page id, hash, deposit, terms and the customer's answer. Opportunities gain the
agent's facts and next step. Both changes are optional fields on main's tables.

The runtime (`convex/salesAgent.ts`, `convex/lib/sales/agent.ts`) runs once per event:
- a new inquiry
- a reply
- a quote decision
- a reminder coming due
- a person handing the conversation back
- a sweep that picks up work left after a pause or a failure

A reader (the company's rules, or an AI model when one is connected and billed) only reads the
customer's message into checked facts. Code decides what is asked, priced, sent and booked. A
rewording is kept only if it adds no number, no link and no promise.

## The quote page

`/c/quote/<token>` shows the quote exactly as approved (`QuotePreview`, the same component the drawer
shows). The customer can accept it, give the address, choose an open time, ask a question or decline.
Accepting is a yes to the price and scope only. The booking is confirmed separately, when the
booking's checklist is done.

## Things a person still does

- Approve the payment link. It goes through Approvals to an Owner or Manager.
- Prepare a required agreement from the drawer, then review and send it from the booking.
- Answer disputes, damage claims and anything the agent escalates.

## Email replies

Every email the agent sends carries a reply address of its own on the receiving domain
(`SALES_REPLY_DOMAIN`, for example `reply.selestial.io`): `r-<random key>@…`, with the key kept on the
opportunity. Resend receives mail for that domain and posts `email.received` to `/webhooks/resend`.
The notice has no body, so `convex/salesInbound.ts` fetches the message and files it.

- The address says which conversation. Who sent it is checked separately: only mail from the
  customer's own address that passed SPF/DKIM/DMARC is read as the customer. Anything else is kept as
  a note for a person, and the agent does not act on it.
- The quoted earlier message and the signature are cut off before reading.
- Automatic replies are dropped. A message delivered twice is one message.

Settings needed:
- `SALES_REPLY_DOMAIN`, `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` on Convex.
- `email.received` ticked on the Resend webhook that points at `/webhooks/resend`.
- The receiving domain's MX record pointed at Resend.

Without `SALES_REPLY_DOMAIN`, replies go to the company's own address and the overview says so.

## Not built

- Chat tools for the agent's conversations. Chat reads the pipeline through the Sales workspace's
  existing tools.
- A first email sent to a company's own address (not a reply). `internal.salesIntake.email` is the
  door for a mailbox reader; none is connected.
- Voice and cold outbound.
