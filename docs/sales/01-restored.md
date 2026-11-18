# Sales: what was brought back after the rebuild

The Sales agent was rebuilt on main's booking workspace, bookings engine and pipeline. That kept the
agent's core and replaced its own quotes, booking checklist and forms with main's. This note lists what
the rebuild left behind and has since been restored on main's records.

| Restored | Where |
| --- | --- |
| Privacy erasure removes a customer's Sales conversation, what they told Sales, and anything waiting to go | `convex/lib/trust/erase.ts` |
| Sidebar badges for Sales | `src/lib/app/badges.ts` |
| A Sales proposal in the approvals panel shows who it goes to and the exact words | `convex/details.ts` |
| Chat reads the inquiries Sales is working, and an opportunity can be attached to a chat | `convex/lib/chat/pipelineTools.ts` |
| A Google lead files an opportunity in the pipeline | `convex/googleAds.ts` |
| A deal the agent works keeps the agent's stage rules on the pipeline; Won follows a confirmed booking only | `convex/pipeline.ts` |
| Cards drag between pipeline stages | `src/components/app/sales/pipeline-screen.tsx` |
| The Playbook's discount band takes effect on a price lowered in the workspace | `convex/lib/sales/settings.ts`, `convex/bookings.ts` |
| Money received, from Finance's ledger, on the Sales overview (Owner only) | `convex/salesInquiries.ts` |

The scenarios that lost their tests are in `convex/salesAgentRestored.test.ts`.

## Not restored, on purpose

- Sales's own form builder and `/c/form` page: Booking Experiences replaces them.
- Sales's own quote versions and booking checklist: the booking workspace and bookings engine replace them.
- The earlier screenshots and browser notes: they showed screens that no longer exist.

## Not verified

These changes are covered by tests, the type check and the production build. They were not opened in
a browser. Live Telnyx, Resend, Stripe and the AI reader remain untested.
