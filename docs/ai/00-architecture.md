# Live AI models and agent execution: architecture

Implements the "Live AI Models and Agent Execution" prompt (November 16, 2026) on top of Company Chat
(`docs/chat/`). Section numbers below refer to that prompt.

## 1. What existed and what was missing (§1)

| Area | Before this work | Now |
|---|---|---|
| Membership, roles, agent authority, pause, approvals | Built (`lib/builders.ts`, `lib/authority.ts`, `approvals.ts`) | Reused unchanged. Every AI tool goes through them. |
| Recruiter model | Claude Opus 5.5 reading hiring mail, falling back to rules (`lib/recruiter/claude.ts`) | Same adapter. The model now comes from the registry: **Claude Haiku 5.5**, the cheaper route for routine extraction. |
| Dispatch, tasks, events, messages, sending policy | Built | Reused. Chat calls the same functions and leaves the same records. |
| Company Chat | Built: sessions, run engine, tools, drafts, knowledge, usage | Runs on the registry: **Claude Sonnet 5.5**, with an OpenRouter stand-in for outages. New tools: photo review, video review, document search, creative requests. Reads PDFs. |
| Provider layer | One Anthropic client per feature, model IDs as constants | **Capability registry** (`lib/ai/registry.ts`) with adapters for Anthropic, OpenAI, Google and OpenRouter, typed errors, an allowlisted fetch, and a usage ledger. |
| Media storage | Evidence photos from cleaner links only | **Creative Studio**: assets, marketing permission, compositions, generation jobs. |
| Knowledge search | None. Confirmed knowledge went into the prompt only. | **Embeddings index** filtered by company and person. |
| Usage and billing | Chat answers per plan. Plan catalog with no metering. | **`aiUsage` ledger** per call, generation allowances per plan, Settings › AI & usage. |
| Ad platforms | None connected. Meta lead ads planned in Integrations. | Still none. Drafts and creatives only; the exact blockers are stated (§8). |
| Settings and administration | Owner settings and a staff console | Owner: **AI & usage** (feature switches, usage, allowances). Staff: **AI models** (connection status, enable/disable, evaluation status). |

## 2. Capability registry (§2, §3)

`convex/lib/ai/registry.ts` is the only place a model is named. Screens and tools ask for a
capability; nothing else names a model.

| Capability | Default | Verified | Stand-in |
|---|---|---|---|
| chat | anthropic `claude-sonnet-5-5` (people may choose others, §3a) | docs, 2026-11-16 | OpenRouter `anthropic/claude-sonnet-5.5` (or `OPENROUTER_CHAT_MODEL`), for outages and rate limits only |
| reasoning (optional, off) | anthropic `claude-opus-5-5` | docs | — |
| classify | anthropic `claude-haiku-5-5` | docs | Recruiter's rules reader |
| image_understanding | anthropic `claude-sonnet-5-5` | docs | — |
| video_understanding | google `gemini-3.8-flash` (Interactions API) | docs | — |
| image_generate / image_edit | openai `gpt-image-2.6-sunburst` | docs | — |
| image_fast | openai `gpt-image-2.6-flare` | docs | — |
| video_generate | google `gemini-omni-1.2-flash` | docs | — |
| embed | openai `text-embedding-3-small` (1536 dimensions) | docs | — |
| video_edit, transcribe, speech, document_ocr, rerank | not implemented | — | never shown as connected |

"Verified" means the model ID, endpoint and request shape were read in the provider's current
documentation on that date. **No adapter has been called live**: no key was available here. See
`02-status.md`.

Each entry records its provider, model, verification, published rates (null when not published),
timeout, inputs and outputs, sizes and durations, cancellation behaviour, and a note on data handling.
`resolve()` combines the entry, the platform administrators' setting (`aiSettings`) and whether the
key is present. It returns either the model to use or a plain reason why not: not built, switched off,
or not connected.

**Keys.** All are set on the Convex deployment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `OPENROUTER_API_KEY` and `OPENROUTER_CHAT_MODEL`. They are never in the browser and
never typed into chat. The staff page shows only whether each key is set.

**Optional extensions** (§2 list) are entries with `implemented: false`. Kling, Runway, Ideogram,
Mistral OCR, Voyage and ElevenLabs have no adapters, cannot be switched on, and are never shown as
connected.

## 3. Calling providers safely (§3, §10)

- `lib/ai/http.ts` calls only the providers' own hosts, over HTTPS, with no redirects. It applies a
  timeout and a size limit to every call.
  - Only requests that are safe to repeat (reads, polls, embeddings) are retried, with backoff.
  - A generation request is never retried blind. A lost answer becomes `uncertain`: it counts as
    possibly billed and is reconciled, never resent.
- `lib/ai/errors.ts` keeps failures apart: refusal, invalid output, not configured, rate limited,
  outage, timeout, rejected input, business refusal, cancelled and uncertain. Only an outage or a rate
  limit may go to another provider.
- **Refusals.** Anthropic's own server-side fallback to another Claude model is on, as the owner
  allowed. A refusal never goes to another provider.
- **Chat stand-in** (`lib/ai/openrouter.ts`).
  - When Anthropic is down after the SDK's retries, OpenRouter continues the same reply. It sees the
    conversation as it stands, including the results of tools already carried out.
  - Chat's idempotency keys mean nothing is carried out twice.
  - Requests ask OpenRouter for providers that do not collect data.
  - The reply says that a backup answered.

## 3a. Choosing a chat model

People pick a model in the chat composer. The choice is saved on the conversation, used by its next
answer, and shown under each answer ("· GPT-6.1 Sol").

- **The list.** `lib/ai/chatModels.ts` is the whole list.
  - Claude Sonnet 5.5 (default), Opus 5.5 and Haiku 5.5 are called directly.
  - GPT-6.1 Sol, Gemini 3.8 Flash, Grok 4.7, Mistral Large 4, Qwen4 Max, DeepSeek V4.1 Flash and Kimi
    K3.1 Pro go through OpenRouter.
  - IDs and prices were read from OpenRouter's public model list on 2026-11-16.
- **What the browser sends.** Only a key from the list, never a model ID.
- **Server checks.** The server checks the key on send, retry and change. A model is refused when:
  - staff have switched it off (staff console › AI models);
  - its provider's key is missing;
  - the model is from another provider and the Owner has turned other providers off (Settings › AI & usage).
- **Same rules for every model.** Each model gets the same instructions and tools, and every tool keeps
  its own checks. Choosing a model never widens what chat can do.
- **Data.** OpenRouter requests carry `data_collection: "deny"`.
- **Attachments.** Only Claude models read PDFs. Sending a PDF to another model is refused with a reason.
- **Outages.** On an outage or rate limit, a Claude choice continues on OpenRouter (Claude Sonnet 5.5
  there by default). Any other choice continues on Claude Sonnet 5.5 directly. Never after a refusal.
- **Usage.** Each answer is recorded with the chosen model's own rates.

## 4. Tools and agents (§4, §5)

The model proposes typed calls. Selestial executes them through the registry in
`lib/chat/tools.ts`, with the checks from `docs/chat/00-architecture.md`: membership, role, record
ownership, agent authority and pause, the company's feature switches, and bound approvals.

Some work needs a model or the search index and so cannot run inside a database transaction: photo
review, video review and document search. The tool prepares that work in a mutation (choosing exactly
which photos, which video, which person's documents). The run engine performs it, and the result is
recorded on the same step (`lib/chat/work.ts`). Nothing in the model's output can widen what was
prepared.

| Specialist | What runs | What does not |
|---|---|---|
| Marketing | Drafts; Creative Studio compositions and generations (`request_creative`, approved in chat) | Publishing or ad spend: no ad platform is connected |
| Sales | Pricing calculator, confirmed services, drafts | Inventing discounts, quotes or availability |
| Retention | Records and drafts | Payments, refunds (a person's decision) |
| Dispatch | Its own tools under its authority | Overriding eligibility or conflicts |
| Quality | `review_visit_photos` and `review_video`: description against the checklist, with evidence marked insufficient where it is | Sanitation, safety or hidden-damage conclusions; any consequence for a worker |
| Customer Care | Drafts | Sending to customers: no customer-message purpose exists |
| Recruiter | Haiku extraction; its tools under its authority | Hiring decisions, pay, offers, readiness |
| Team Coordinator | Drafts and guidance | Verifying documents or readiness |

## 5. Creative Studio (§6, §7)

Marketing › Content & Creative (`/app/agents/marketing/content-creative`). Backend: `convex/creative.ts`,
`convex/media.ts`, `lib/ai/media.ts`.

**Real-job creatives.**
- Evidence photos are brought in as assets that point at the same stored file. Selestial never changes
  that file.
- A real photo needs an Owner's or Manager's recorded marketing permission before it can be composed.
- Composition is code: a canvas that frames the photos without retouching them and draws the caption,
  offer and call to action exactly as typed. The result is a new asset that records its sources and
  layout.
- Real work, and anything composed from it, is refused by every generator and editor.

**Generated creatives.** Generated images and videos are labelled "AI generated · model" everywhere,
with their prompt and provenance (C2PA as OpenAI provides it, Google's SynthID). They are never shown
as real work.

**Jobs.** `mediaJobs` is durable.
- Every job first reserves its allowance in a transaction, so two requests cannot both take the last
  generation.
- Images are one call; a lost answer is `uncertain` and counts as used.
- A video saves its provider reference, then is only polled. Repeated polls and restarts never start a
  second one, and a sweep picks up quiet jobs.
- Outputs are copied into Selestial storage straight away.
- Stopping a queued job sends nothing and gives the allowance back. Stopping a running video stops
  Selestial waiting; the provider may still bill, and the job says so.

**Allowances.** Growth includes 40 images and 4 videos a month; Scale 150 and 15. These are the
owner's provisional numbers, in `MEDIA_PER_MONTH`. `MEDIA_IMAGES_PER_MONTH` and
`MEDIA_VIDEOS_PER_MONTH` on the deployment override every plan. Nothing is charged beyond an
allowance; that feature stops for the month.

## 6. Advertising (§8)

No ad platform is connected, and none is automated around. What exists is drafts: campaign
documents, chosen creatives, and selection recorded on assets. Paid delivery needs:
- each company's own Meta ad account and Facebook Page authorized to Selestial;
- Selestial's Meta app approved for `ads_management`;
- a Selestial adapter.

None of these exists yet. The `launch_campaign` tool says so and spends nothing.

## 7. Documents and knowledge (§9)

- PDFs up to 10 MB go to Claude as documents, so their text layer is read without OCR. OCR for scans
  remains an optional, unbuilt extension.
- Text files are read as before.
- `knowledgeChunks` holds embeddings of confirmed company knowledge (audience `company:<id>`) and of
  each person's own drafts (audience `member:<id>`).
  - Search filters by audience in the vector query.
  - It then re-reads each source: knowledge must still be confirmed; a draft must still be that
    person's.
  - Live records from the other tools always win over anything older.
  - The index is rebuilt whenever knowledge is confirmed or a draft is saved.

## 8. Usage and cost (§11)

`aiUsage` records one row per model call or media job: the company, person, feature, capability,
provider and model, run or job, and units. Units are tokens in, out and cache-read, images, or video
seconds.
- The estimated cost comes from published rates; it is null when a rate is not published, never zero.
- A reconciled cost is recorded when a provider reports one.
- The provider's raw usage is kept, trimmed.

Settings › AI & usage shows the month's allowances, usage by feature (with "not priced" where a rate is
unknown), the Owner's feature switches, and which capabilities are connected.

Platform administrators use the staff console's AI models page. Office staff have no provider
administration.

## 9. Evaluation (§12)

`convex/lib/ai/eval/cases.ts` is a synthetic set. Every case has a known answer or a rubric:
- inbox classification and extraction, with ambiguous senders and an injection attempt;
- tool selection and forbidden actions;
- pricing problems with exact answers;
- an agreement checked against supplied terms;
- retrieval;
- rubrics for photo, video, branded-creative and generated-video review.

`convex/ai.eval.test.ts` runs the automatic suites against the live models when `AI_EVAL=1` and keys
are set. It records valid-output rate, correctness, latency and tokens, and writes
`docs/ai/eval-results.json`. **It has not been run.** The registry's defaults are therefore the
prompt's provisional choices, not measured winners.
