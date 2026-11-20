#!/usr/bin/env node
/**
 * Narration for one tutorial, scene by scene, from its storyboard: ElevenLabs speech with character
 * timings, so captions follow the voice exactly. Run during production, never when an owner opens a
 * tutorial. The key is read from ELEVENLABS_API_KEY on the machine that runs this, never from the app.
 *
 *   ELEVENLABS_API_KEY=... node tutorials/scripts/narrate.mjs spreadsheet-prepare-clients
 *
 * Writes tutorials/build/<id>/v<version>/narration/<scene>.mp3 and <scene>.json (the timings), and
 * transcript.txt. A scene whose text has not changed is not generated again.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDir, loadStoryboard } from "./lib.mjs";

const id = process.argv[2];
if (!id) throw new Error("Name a tutorial: node tutorials/scripts/narrate.mjs <tutorial-id>");
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("Set ELEVENLABS_API_KEY.");

const board = loadStoryboard(id);
const out = join(buildDir(board), "narration");
mkdirSync(out, { recursive: true });

for (const [index, scene] of board.scenes.entries()) {
  const hash = createHash("sha256").update(JSON.stringify([board.voice, scene.narration])).digest("hex").slice(0, 16);
  const meta = join(out, `${scene.id}.json`);
  if (existsSync(meta) && JSON.parse(readFileSync(meta, "utf8")).hash === hash) {
    console.log(`= ${scene.id} (unchanged)`);
    continue;
  }
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${board.voice.voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: scene.narration,
      model_id: board.voice.model,
      voice_settings: board.voice.settings,
      // Neighbouring lines keep the delivery even from one scene to the next.
      previous_text: board.scenes[index - 1]?.narration,
      next_text: board.scenes[index + 1]?.narration,
    }),
  });
  if (!response.ok) throw new Error(`ElevenLabs refused ${scene.id}: ${response.status} ${await response.text()}`);
  const body = await response.json();
  writeFileSync(join(out, `${scene.id}.mp3`), Buffer.from(body.audio_base64, "base64"));
  const alignment = body.alignment;
  const duration = alignment.character_end_times_seconds.at(-1) ?? 0;
  writeFileSync(meta, JSON.stringify({ hash, text: scene.narration, duration, alignment }, null, 1));
  console.log(`+ ${scene.id} ${duration.toFixed(2)}s`);
}

writeFileSync(join(buildDir(board), "transcript.txt"), board.scenes.map((scene) => scene.narration).join("\n\n") + "\n");
console.log(`Transcript: ${join(buildDir(board), "transcript.txt")}`);
