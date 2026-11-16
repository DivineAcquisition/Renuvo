# Live AI: what is done, how it was checked, and what is left

Four levels, used strictly:
- **Code complete**: written, typechecked and linted.
- **Mock-tested**: exercised by automated tests, with provider HTTP replaced by the provider's
  documented response shape.
- **Live-tested**: called the real provider and checked the result.
- **Production-ready**: live-tested, evaluated, configured in production, and approved by the owner.

| Piece | Code complete | Mock-tested | Live-tested | Production-ready |
|---|---|---|---|---|
| Capability registry, resolve, staff overrides | Yes | Yes | n/a | No: not deployed |
| Chat on Claude Sonnet 5.5 | Yes | Yes (scripted model) | **No** | No |
| OpenRouter outage stand-in for chat | Yes | Yes (conversion and continuation; no repeated tool) | **No** | No |
| Chat model picker (six makers; uploads to every model) | Yes | Yes (request shape, files and images, pdf-text for DeepSeek/Kimi, data_collection deny, pricing, staff/Owner/key checks) | **No** | No |
| Recruiter on Claude Haiku 5.5 | Yes | Yes (stubbed fetch) | **No** | No |
| Photo review (Sonnet image input) | Yes | Yes (real SDK, stubbed fetch) | **No** | No: needs the photo evaluation |
| Video review (Gemini 3.8 Flash) | Yes | Response parsing only | **No** | No |
| Image generation and editing (gpt-image-2.6) | Yes | Yes (job lifecycle, uncertain, allowance) | **No** | No |
| Video generation (Gemini Omni 1.2 Flash) | Yes | Yes (start, poll, repeated poll, store) | **No** | No |
| Knowledge embeddings and search | Yes | Yes (tenant and person filtering) | **No** | No |
| Creative Studio compositions | Yes | Server rules tested; canvas drawn in the browser | n/a | No: not checked in a browser against a deployment |
| Usage ledger and Settings › AI & usage | Yes | Yes | n/a | No |
| Meta ads | **No adapter.** Drafts and blockers only. | — | — | No |
| Optional extensions (Kling, Runway, Ideogram, Mistral OCR, Voyage, ElevenLabs, GPT-Live) | Contracts only | — | — | No |
| Evaluation runner | Yes | Skipped without keys | **Not run** | — |

## Setup steps that remain

1. **Keys on the Convex deployment.** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` and
   `OPENROUTER_API_KEY` are set (checked by name only). The chat stand-in defaults to
   `anthropic/claude-sonnet-5.5` on OpenRouter; `OPENROUTER_CHAT_MODEL` changes it.
2. **Model access.** Confirm that each account can use these models: `claude-sonnet-5-5`,
   `claude-haiku-5-5`, `gpt-image-2.6-sunburst`, `gpt-image-2.6-flare`, `text-embedding-3-small`,
   `gemini-3.8-flash` and `gemini-omni-1.2-flash`. The OpenAI image models need the organization's
   verification for image generation, where OpenAI requires it.
3. **Data terms.** Confirm that each provider's data-retention terms suit company photos and documents.
   Opus 5.5 and Fable-class models need 30-day retention, not zero data retention.
4. **Run the evaluation.** Run `AI_EVAL=1 npx vitest run convex/ai.eval.test.ts` with keys. Then review
   the human-scored cases in `convex/lib/ai/eval/cases.ts`; they need synthetic photo and video
   fixtures to be added. Choose defaults from the measured results, then set evaluation status on the
   staff AI models page.
5. **Rates.** Fill in published per-image and per-video-second rates in the registry, so costs are
   estimated instead of "not priced".
6. **Deploy.** Run `npx convex deploy`. This adds the new tables, the vector index and the crons.
7. **Meta ads, when wanted.** Create a Meta app, pass app review for `ads_management`, add each
   company's own authorization flow, and build the adapter. That is separate work.
8. **Allowances.** Growth 40 images and 4 videos, Scale 150 and 15, are provisional. Confirm them
   before they are sold.

Nothing was deployed, no live model was called, no ad was created, and no real customer, cleaner or
applicant was contacted during this build.
