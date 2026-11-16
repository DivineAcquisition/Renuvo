# Company Chat: external setup blockers and open decisions

## Setup needed before chat answers for real

| # | What | Where | Without it |
|---|---|---|---|
| 1 | `ANTHROPIC_API_KEY` on the Convex deployment | Convex dashboard → Settings → Environment variables | Every answer fails with "No model is connected to Company Chat on this deployment yet". Nothing is invented. |
| 2 | Leave `CHAT_MODEL` unset (or `claude`) in production. `mock` is for tests only, and `off` switches chat off. | Same | `mock` would answer with scripted text. |
| 3 | `CHAT_MONTHLY_RUNS`: answers per company per month | Same | The default is 300 answers per company per month. |
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

## Decisions for the owner

1. **The company export and private chats.** Today a company's data export includes drafts, action
   receipts, runs, knowledge and usage, but not the words of members' private chats. Should an Owner's
   export include everyone's chat messages?
2. **Sharing.** Chats are private to their creator. If sharing is wanted, decide who may share with
   whom. Each shared view must be filtered by the recipient's own access.
3. **Plan allowances.** Growth and Scale need measured allowances before chat is sold. The plan is not
   on the company record yet, so one company-wide number (`CHAT_MONTHLY_RUNS`) applies to every
   company.
4. **Retention.** Deleting a chat removes its words immediately and keeps its action receipts and
   drafts. Decide whether chats themselves expire after a period.
5. **Who records a document as approved, sent or signed.** Today Owners and Managers may.
