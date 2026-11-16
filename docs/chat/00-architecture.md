# Company Chat: architecture

Company Chat is the owner's general assistant under **Company → Chat**. A person asks, the conversation
can move between topics, and nobody picks an agent first. Chat answers directly, drafts documents,
reads the company's records, and requests the actions Selestial supports. The eight agents stay the
specialists that carry out work; chat uses their tools only when it actually needs them.

What chat may talk about is wide. What chat may *do* is exactly the tool registry below. When an action
has no tool, chat says what blocks it and does not pretend.

## Where it lives

| Piece | File |
|---|---|
| Tables | `convex/lib/chat/schema.ts` (registered in `convex/schema.ts`) |
| Public functions: sessions, send, stop, retry, approvals, uploads, usage, knowledge | `convex/chat.ts` |
| Drafts and versions | `convex/chatArtifacts.ts`, `convex/lib/chat/artifacts.ts` |
| Run engine (internal only) | `convex/chatRuns.ts` |
| Tool registry | `convex/lib/chat/tools.ts` |
| One tool call: checks, receipt, approval binding | `convex/lib/chat/steps.ts` |
| Model adapter: Claude, scripted mock, none | `convex/lib/chat/model.ts`, `convex/lib/chat/claude.ts` |
| System prompt and how context is marked as data | `convex/lib/chat/prompt.ts` |
| Pricing calculator and arithmetic | `convex/lib/chat/pricing.ts`, `convex/lib/chat/calc.ts` |
| Navigation entry | `src/lib/app/navigation.ts` (`SHARED_ITEMS`, `CHAT_PAGES`) |
| Screens | `src/components/app/chat/*`, pages under `src/app/(product)/app/chat` and `/app/chats` |

## Three layers, kept apart

1. **The conversation**: `conversations`, `chatMessages`, `chatRuns`. Private to the member who
   started it. A suggestion in a chat is never company policy.
2. **Confirmed company knowledge**: `companyKnowledge`. A chat can only *propose* an entry; the Owner
   confirms it. Only confirmed entries reach the model, and they are knowledge for answers, never an
   operating rule. Prices, pay, permissions and policies change only through their own functions.
3. **Live operational records**: read and changed only through tools, with the same checks the rest
   of Selestial uses.

There is no cross-chat memory. The model sees the current conversation only, and the system prompt says
so.

## A run, start to finish

1. `chat.send` checks membership, the attached records and files, the monthly allowance and a per-person
   rate limit, then **saves the message before anything else**. A `clientKey` from the browser makes a
   repeated send (double click, reconnect) find the first message instead of making a second.
2. It inserts an empty assistant message and a `chatRuns` row (`queued`), and schedules
   `chatRuns.execute`.
3. `execute` claims the run (`queued → running`; a duplicate schedule does nothing), loads the prompt
   for the member **as they are now**, reads attached text files as data, and calls the model.
4. Text is saved into the assistant message every ~300 ms as it streams. The page reads the record, so
   a refresh or a closed tab loses nothing. The same write answers "was Stop pressed?".
5. Each tool call is its own transaction (`chatRuns.runStep` → `lib/chat/steps.ts`). The member's
   current role, the tool's minimum role, the input schema and the record's company are checked every
   time.
6. Before every step `checkpoint` re-checks: the run is still live, Stop was not pressed, the chat
   still exists, and the person is still an active member.
7. `finish` closes the run with one honest status. Stopped or failed runs append a notice listing
   exactly which actions were already carried out ("not undone").
8. A cron (`chatRuns.sweep`, every 2 minutes) closes runs whose worker stopped reporting for 3 minutes,
   with "interrupted; retry to continue". A late worker cannot reopen a closed run.

Limits per run: 8 tool steps, 4 minutes, 16,000 output tokens per model call, 12,000 characters of
tool output returned to the model, 60,000 characters per attached file.

## Tools and the execution ladder

`convex/lib/chat/tools.ts` is the server-side capability registry. Each tool states its kind, the
least role that may use it, the specialist whose function runs (if any), and whether it needs the
person's approval in chat.

| Kind | Tools | Rule |
|---|---|---|
| Read and analyze | `calculate`, `price_service`, `company_profile`, `attention_summary`, `list_jobs`, `find_records`, `get_record`, `list_tasks`, `inspect_visit_staffing` (Dispatch), `inspect_application` (Recruiter), `read_draft` | Run directly. Pay is shown to the Owner only. |
| Draft | `save_draft`, `revise_draft`, `propose_company_knowledge` | Run directly. A revision names its base version. |
| Routine write | `create_task`, `prepare_hiring_offer` (Recruiter; a draft for the Approvals queue) | Run directly, once, under an idempotency key. |
| Consequential write | `request_dispatch_offer` (Dispatch), `request_application_invitation` (Recruiter), `create_hiring_need` (Owner), `record_draft_status` | Shown as a preview; nothing happens until the person approves **in chat**. |
| Not available | `send_customer_message`, `update_price_book`, `launch_campaign`, `send_for_signature`, `issue_refund_or_credit` | Always answer with the blocker. |

A specialist tool runs through the agent's own tool function (`lib/dispatch/tools.ts`,
`lib/recruiter/tools.ts`), so the agent's authority level, pause state and hard rules apply exactly as
they do for the agent's own workflow. It is also recorded in `toolRuns` under `chat:<key>` with "asked
for in Company Chat by member …". If Dispatch is on Propose, a chat approval puts an approval in the
shared Approvals queue; it does not skip it.

### Approval binding

A `confirm` tool first produces a preview: a summary, the lines a person reads, and `bindsTo`, a hash of
exactly what the action depends on (for an offer: the visit's time and status, the cleaner, the cover
action, the authority level, the current assignments). Approving re-runs the preview. If `bindsTo`
differs, the step becomes `expired` and nothing is done. An approved step is never asked for again.

### Idempotency

A read is keyed by run and call. Anything else is keyed by conversation, user message, tool and a
canonical hash of its arguments. When the model asks again in the same run, or a retried run asks again,
the earlier receipt is returned and shown instead of doing the work twice.

## Drafts

`chatArtifacts` holds identity, kind, state and current version. `chatArtifactVersions` holds each
version's Markdown, its author (assistant run or member) and a note. A revision must name the version it
starts from (optimistic concurrency).

Four separate states: **Draft → Terms approved → Sent → Signed**, recorded one step at a time by an
Owner or Manager for the version on screen. A new version after any of them returns the document to
Draft, because the approval was for the old words. "Sent" and "Signed" are a person's record of what
happened outside Selestial. No signing service is connected. Unresolved terms are written
`[[TO CONFIRM: …]]` and counted before approval. Export is Markdown, plain text, and copy.

## Prompt injection

Records, attachments, the page path and tool results reach the model inside `<record>`,
`<attachment>`, `<page>` tags or as tool results, and the system prompt says they are data. That is a
mitigation, not the defense. The defenses are structural:

- the model cannot write anything itself;
- every tool re-checks the member's role and the record's company;
- the tools an Office member may not use are not offered, and are refused if called anyway;
- every consequential action waits for a human click on a preview;
- a file can be attached only by the member who uploaded it.

## Access

- Every public function is a `companyQuery` / `companyMutation` / `ownerMutation` from
  `lib/builders.ts`.
- A conversation, its steps and its drafts are visible only to the member who started them.
  Another member, another company, a removed member and a deleted chat all get "Not found.".
- "Company" is the navigation category. It does not give every employee access to every chat.
- Sharing is not built. When it is, a shared chat must not show records a recipient cannot read;
  hiding the link alone is not enough.
- The company data export includes runs (without error text), action steps, drafts and their
  versions, knowledge and usage. Conversations and messages are left out as private
  (`lib/trust/exportTables.ts`). **This is a product decision for the owner to confirm**; see
  `02-setup-and-decisions.md`.

## Deleting and archiving

Archiving sets a chat aside and never stops its running work; the person is told it is still running.
Deleting is refused while a response is running ("Stop it first"). It removes the messages and attached
files (batched), cancels approvals still waiting in that chat, and keeps the conversation row as
"Deleted chat" so the action receipts (`chatActionSteps`) and drafts still point at something.

## Usage

Each answer counts against `CHAT_MONTHLY_RUNS` per company per UTC month (default 300). Tokens are
recorded per run and per month. The composer shows "N of M answers used this month". A per-person limit
of 20 sends per 10 minutes protects against loops. Plan-based allowances (Growth / Scale) need the plan
on the company record, which does not exist yet.

## The model

`claude-opus-5-5` through the Anthropic SDK, streamed, effort `medium`, server-side refusal fallbacks
(`fallbacks: "default"`). Tool inputs stream eagerly and are validated by `lib/chat/fields.ts` before
anything runs. No reasoning is stored or shown. Between runs only the visible words are replayed. With
no key the run fails with "No model is connected…"; there is never a canned answer. **Not verified
against the live API in this build: no key was available.**
