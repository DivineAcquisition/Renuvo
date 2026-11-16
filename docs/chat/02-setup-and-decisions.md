# Company Chat: external setup blockers and open decisions

## Setup needed before chat answers for real

| # | What | Where | Without it |
|---|---|---|---|
| 1 | `ANTHROPIC_API_KEY` on the Convex deployment. **Done in production**, per the owner. | Convex dashboard → Settings → Environment variables | Every answer fails with "No model is connected to Company Chat on this deployment yet". Nothing is invented. |
| 2 | Leave `CHAT_MODEL` unset (or `claude`) in production. `mock` is for tests only, and `off` switches chat off. | Same | `mock` would answer with scripted text. |
| 3 | Set each company's plan (Growth or Scale) on the staff Companies page | Staff console | Every company counts as Growth (300 answers a month). |
| 4 | The organization's data retention allows `claude-opus-5-5` (30-day retention, not zero data retention) | Anthropic Console | The provider refuses requests; chat shows "The model could not take this request". |
| 5 | Deploy the Convex functions and schema (`npx convex deploy`), which adds the new tables, the search index and the 2-minute cron | Deployment pipeline | The pages load, but every chat function is missing. |
| 6 | One end-to-end check against the live model with a test company: a direct answer, a pricing question, an agreement draft, a task, and a Dispatch offer on Propose | Staging | The Claude adapter (`convex/lib/chat/claude.ts`) has **not been run against the live API**: no key was available in this build. |

## Capabilities that stay unavailable until their backends exist

Chat says so plainly when someone asks for any of these:

- **Customer messages.** Customer Care is not built, and the shared outbox has no customer-message
  purpose.
- **Changing a live price.** There is no price book or service catalog, and changing prices is a
  person's decision.
- **Launching marketing campaigns.** Marketing is not built and no sending is connected.
- **E-signature.** No signing service is connected. Sent and signed are recorded by hand on the draft.
- **Refunds and credits.** Selestial holds no payments, and these are always a person's decision.
- **Assigning a task to a named person.** The shared task model gives every task to one agent and has
  no assignee field.
- **PDF, Word and image attachments.** Only `.txt`, `.md`, `.csv` and `.json` up to 512 KB are read.
  Anything else is refused at upload, with the reason shown.

## Decisions the owner made (November 16, 2026)

| Question | Decision | Where it lives |
|---|---|---|
| Key name | `ANTHROPIC_API_KEY`, already set in Convex production with the other model keys | `convex/lib/chat/model.ts` |
| Company export and private chats | Chat messages stay out of the export. Drafts, action receipts, runs, knowledge and usage are in it. | `convex/lib/trust/exportTables.ts` |
| Sharing | Private only for now. Each chat is visible only to the person who started it. | `convex/lib/chat/state.ts` `ownConversation` |
| Plan allowances | Growth: 300 chat answers per company per month. Scale: 1,000. The plan is on the company record (absent means Growth), and Selestial staff admins set it on the staff Companies page. `CHAT_MONTHLY_RUNS`, if set, overrides every plan (emergency cap or test only). | `CHAT_ANSWERS_PER_MONTH` in `convex/lib/chat/state.ts`; `chat.setCompanyPlan` |
| Retention | Keep chats until the person deletes them. There is no automatic expiry. | — |
| Who records a document as approved, sent or signed | Owners and Managers | `convex/chatArtifacts.ts` `setState` |
| Production | Deployed later, together with all other production work, in a separate session. Nothing was deployed from this one. | — |
