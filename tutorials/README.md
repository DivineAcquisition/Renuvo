# Migration tutorial production

How Selestial's narrated migration tutorials are made, checked and updated. The tutorials themselves (steps,
sources, placements, transcript, media) are in `convex/lib/tutorials/catalog.ts`; publication state and media
versions are changed by staff at **/staff/tutorials** without a release.

## The rules

- Real footage only. Never generate or mock up another company's software screens.
- An authorized demo account holding sample data only. No real client names, emails, phone numbers, addresses,
  account ids, payment details or credentials on screen. Blur or re-record if one slips in.
- Narration describes only what the footage shows and what the platform's help article says.
- One task per tutorial, about 60 to 120 seconds, no long intro, no music, no promotional outro. The last line
  is the next step: "Return to Selestial and upload the file you just downloaded."
- The voice is ElevenLabs **Eric** (`cjVigY5qzO86Huf0OWal`, `eleven_multilingual_v2`), chosen by the Owner on
  November 20, 2026. It is a stock synthetic voice: no cloning.
- Narration is generated here, during production. The ElevenLabs key never goes into the app.

## Steps

1. **Verify.** Read the platform's current help article, and record its URL, its updated date and the date you
   read it in the catalog (`sources`, `docsCheckedOn`). Note the role and plan limits it states.
2. **Storyboard.** `tutorials/storyboards/<tutorial-id>.json`: one scene per step, each with its narration, how
   it is captured, an optional `focus` rectangle (in 1920×1080 pixels) to zoom into, and `minSeconds`.
3. **Capture.**
   - Selestial screens: `node tutorials/scripts/capture.mjs <id> --base <url> --storage tutorials/.auth/<demo>.json`.
     It records at 1920×1080 with a visible cursor and a highlight ring, and cuts loading and marked waits.
   - Other systems (Jobber, Housecall Pro, BookingKoala, a spreadsheet app): record each scene at 1920×1080 with
     the cursor visible and highlighted, in the demo account, and save it as
     `tutorials/build/<id>/v<version>/clips/<scene-id>.mp4`. Set `in`/`out` (seconds) on the scene to trim.
   - Follow the steps for real. Note the date in the catalog (`interfaceVerifiedOn`) and anything that differs
     from the help article; fix the storyboard and catalog to match what you saw.
4. **Check the file.** Import what the export produced into a test company with the matching Selestial import.
   Columns must be matched, and rows checked, with no unexpected problems. Record anything the owner must do.
5. **Narrate.** `NODE_USE_ENV_PROXY=1 ELEVENLABS_API_KEY=... node tutorials/scripts/narrate.mjs <id>`. Only
   changed scenes are generated again.
6. **Assemble.** `node tutorials/scripts/assemble.mjs <id>` writes `tutorial.mp4` (H.264/AAC, faststart),
   `captions.vtt` (timed to the voice), `poster.jpg` and `media.json`.
7. **Review.** Watch the whole video with captions on, at 1×, on a laptop and a phone. Check against the list
   below. Copy the final narration into the catalog's `transcript`.
8. **Publish the media.** `BLOB_READ_WRITE_TOKEN=... node tutorials/scripts/publish.mjs <id>` uploads to
   `tutorials/<id>/v<version>/` on Vercel Blob and prints the media entry.
9. **Publish the tutorial.** At /staff/tutorials, use *Replace media version* with that entry, then set the
   state to *Published*. Publishing is refused until `interfaceVerifiedOn` and `transcript` are set.

## Review checklist (before every publish)

- [ ] Interface and instructions match, today, in the demo account.
- [ ] The exported file imports into the intended Selestial import.
- [ ] No private information appears in any frame.
- [ ] Narration and captions are accurate and in sync.
- [ ] Text and controls are readable at 1080p and on a phone.
- [ ] Each contextual link opens this tutorial; closing the dialog keeps the form as it was.
- [ ] Keyboard and mobile operation work; a broken media URL shows the written steps and a retry.

## Updating a tutorial

- **The workflow changed** (an owner reports it, or you notice): set the state to *Needs update* at
  /staff/tutorials. Owners then get the written fallback and migration help instead of the video.
- **New footage or narration:** bump `version` in the storyboard, run steps 3 to 8, and replace the media
  version at /staff/tutorials. Every screen that offers the tutorial gets the new version at once; the old
  files stay in place until no one is pointed at them.
- **Written steps changed:** edit the catalog, bump `contentVersion`, and update `docsCheckedOn`.

## Status

See `docs/tutorials/00-plan.md` for what is verified, produced and published, and what is still needed.
