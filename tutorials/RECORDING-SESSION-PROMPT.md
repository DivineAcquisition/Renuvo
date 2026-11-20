Record and produce Selestial's narrated migration tutorial videos, on this Mac, using the pipeline already on `main` in github.com/DivineAcquisition/Selestial-AI.

Ask me before anything you can't verify. Do one tutorial completely first (the reference), send it to me for review, and wait for my approval before producing the rest.

## Context (read first)
- `tutorials/README.md`: the production process, rules and review checklist. Follow it exactly.
- `docs/tutorials/00-plan.md`: what's verified and what's still needed.
- `convex/lib/tutorials/catalog.ts`: every tutorial's steps, sources and placements.
- `tutorials/storyboards/*.json`: scene-by-scene narration and capture notes.
- `tutorials/scripts/`: `capture.mjs` (Playwright, Selestial screens), `narrate.mjs` (ElevenLabs), `assemble.mjs` (ffmpeg), `publish.mjs` (Vercel Blob).
- Voice: ElevenLabs stock voice "Eric" (`cjVigY5qzO86Huf0OWal`, `eleven_multilingual_v2`), already chosen. No cloning.

## Setup
1. If this folder is empty, clone the repo into it. Otherwise pull `main`. Create a branch `tutorials/recordings` and work only there; never push to `main`.
2. `npm ci`. Install ffmpeg if missing (`brew install ffmpeg`). Install Playwright's Chromium only if `require('playwright')` can't launch one.
3. Get `.env.local` for local dev from me. Ask me where it is; don't invent values. Start Selestial (`npm run dev`) against the DEVELOPMENT Convex deployment and development sign-in, never production.
4. Ask me for a demo owner account that has ONLY sample data, then sign in once in a headed Playwright browser and save the storage state to `tutorials/.auth/demo-owner.json` (git-ignored).
5. For narration I'll set `ELEVENLABS_API_KEY` in your shell myself. Never ask me to paste it into chat, and never write it to a file.

## Reference tutorial first: `spreadsheet-prepare-clients`
1. Selestial scenes: `node tutorials/scripts/capture.mjs spreadsheet-prepare-clients --base http://localhost:3000 --storage tutorials/.auth/demo-owner.json`. Watch the clips. If a selector fails or the UI differs from the storyboard, fix the storyboard to match the real UI, not the other way round.
2. Spreadsheet scenes (`"kind": "manual"`): open `public/templates/selestial-clients.csv` in Google Sheets (or Numbers/Excel; tell me which, and match the narration to it). Record each scene at 1920×1080 with the cursor visible, following its `what` note, using only the sample rows. Either drive it with Playwright in a headed browser or ask me to record with QuickTime; save each as `tutorials/build/spreadsheet-prepare-clients/v1/clips/<scene-id>.mp4`.
3. `NODE_USE_ENV_PROXY=1` is not needed on the Mac. Run `node tutorials/scripts/narrate.mjs spreadsheet-prepare-clients`, then `node tutorials/scripts/assemble.mjs spreadsheet-prepare-clients`.
4. Check the result yourself against the README's review checklist: frames readable, no private data in any frame, captions in sync, narration only describes what's on screen. Extract a few frames and look at them.
5. Import `tutorials/sample/selestial-clients-filled.csv` in the running Selestial to confirm the flow shown actually works.
6. Send me `tutorial.mp4` and `poster.jpg` to review, with the final narration text. STOP and wait for my approval.

## After I approve the reference
1. Platform tutorials, in this order: `jobber-export-clients`, `hcp-export-customers`, `jobber-export-visits`, `jobber-export-recurring`, `jobber-export-invoices`, `hcp-export-jobs`, `hcp-export-invoices`. Then BookingKoala: first read help.bookingkoala.com's export articles and follow them in the demo account, then write the `bk-*` storyboards and catalog steps from what you actually see.
2. Record only in the authorized demo accounts I'm signed into, with sample data only. Never show real customers, emails, phone numbers, account IDs, billing or payment details, or credentials. Blur or re-record any frame that does. Never generate or mock up another company's screens.
3. Follow each export for real. If the interface differs from the help article, fix the storyboard narration and the catalog steps to match what you saw, and tell me. Then import the downloaded file into the matching Selestial import to confirm it works, and record any problem.
4. In the catalog, set `interfaceVerifiedOn` to the date you followed the steps, and `transcript` to the final narration, only for tutorials that passed.
5. Send me each MP4 for review before publishing.

## Publishing (only after I approve each video)
1. Get `BLOB_READ_WRITE_TOKEN` with `vercel env pull` from the `selestial-ai` project (Blob store `selestial-tutorials`). Don't print it.
2. Run `node tutorials/scripts/publish.mjs <id>` and give me the printed media entry.
3. Commit the storyboard and catalog changes on `tutorials/recordings`, push the branch, and open a PR. Don't merge it, and don't publish tutorials at /staff/tutorials yourself: I'll do that.

Report at the end: what was produced, what was verified (with dates), what differed from the help articles, and anything still blocked.
