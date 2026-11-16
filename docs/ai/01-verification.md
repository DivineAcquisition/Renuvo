# Live AI: verification

Automated: `convex/ai.test.ts` (15 tests), plus the Company Chat suite and the existing suites (445
passing in all; the 19 live evaluation cases skip without keys). Provider HTTP is replaced at `fetch` with each provider's documented response, so the
real adapters, job engine and allowance logic run. No provider is contacted.

| Brief §13 | Test |
|---|---|
| Tool calls invoke real backend functions and return receipts | "continues on the backup model…" (create_task receipt); Company Chat suite |
| Cross-tenant and unauthorized access fail | "keeps each company's studio to itself…"; "finds only confirmed knowledge of this company and the asker's own drafts"; staff-only settings in "stops honestly when Selestial staff switch chat off" |
| Fallback and retries never duplicate | "continues on the backup model, carrying the tool result instead of repeating it"; "never resends a generation whose answer was lost"; "follows a video by its saved reference… never starts it twice" |
| No provider switch after a refusal | "never switches providers after a refusal" |
| Stale approvals are invalidated | Company Chat: "does not apply an approval once what it would change has changed"; `request_creative` binds to prompt, settings, model and allowance |
| Pausing stops future work | Company Chat and Dispatch suites (agent pause); the staff switch stops chat ("stops honestly…") |
| Streaming recovery | Company Chat: sweep and retry tests |
| Media jobs survive refresh, restart and repeated callbacks | Video polling test; repeated `complete` ignored in the image test; the `media.sweep` cron |
| Original evidence stays intact | "keeps real job photos out of generation…" compares the original's file before and after composing |
| Usage limits under concurrent requests | "refuses past the plan's allowance…". Reservation is one transaction, so Convex serializes conflicting writes. |
| Missing optional providers do not block chat | "says what is not connected or not built…" |
| Unavailable services never shown as done | Registry states; Company Chat unavailable-action test; `launch_campaign` blocker |
| Photo review describes and decides nothing | "reviews a visit's photos as data…" checks the instructions sent, two images, the cleaner unchanged, and no task invented |
| No production recipients, ads or offers | Every test is synthetic; no live keys exist here |

Not verified:
- Live provider responses. No keys were available here.
- The Creative Studio canvas in a browser against a deployment.
- The human-scored evaluation cases.

See `02-status.md`.
