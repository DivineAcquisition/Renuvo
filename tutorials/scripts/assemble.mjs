#!/usr/bin/env node
/**
 * Puts a tutorial together from its clips and narration: each scene's footage, with recorded delays cut,
 * held on its last frame if the narration is longer, eased into the storyboard's focus area, with a small
 * Selestial mark, the scene's narration, and captions timed to the voice. Writes:
 *
 *   tutorials/build/<id>/v<version>/tutorial.mp4   H.264 + AAC, faststart (plays and seeks while loading)
 *                                     poster.jpg      a frame from the scene marked "poster"
 *                                     captions.vtt    WebVTT from the voice's timings
 *                                     media.json      what the catalog or staff panel needs
 *
 *   node tutorials/scripts/assemble.mjs spreadsheet-prepare-clients
 *
 * Needs ffmpeg and ffprobe. Fails, rather than guessing, when a clip or narration is missing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDir, cues, loadStoryboard, ROOT, vttTime } from "./lib.mjs";

const id = process.argv[2];
const board = loadStoryboard(id);
const dir = buildDir(board);
const W = 1920;
const H = 1080;
const FPS = 30;
const LEAD = 0.4; // seconds of picture before the voice starts
const TAIL = 0.9; // and after it ends, to read the screen

const probe = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

function clipOf(scene) {
  for (const ext of ["webm", "mp4", "mov", "mkv"]) {
    const file = join(dir, "clips", `${scene.id}.${ext}`);
    if (existsSync(file)) return file;
  }
  throw new Error(`No clip for scene "${scene.id}". Record it (tutorials/README.md) as ${join(dir, "clips", `${scene.id}.mp4`)}.`);
}

/** The parts of the clip to keep: everything except recorded loading and waits marked "cut". */
function keptSpans(scene, clip) {
  const total = probe(clip);
  const cutsFile = join(dir, "clips", `${scene.id}.cuts.json`);
  const marks = existsSync(cutsFile) ? JSON.parse(readFileSync(cutsFile, "utf8")) : { end: total, cuts: [] };
  const inPoint = scene.in ?? 0;
  const outPoint = Math.min(scene.out ?? marks.end ?? total, total);
  const cuts = [...marks.cuts].sort((a, b) => a[0] - b[0]);
  const spans = [];
  let at = inPoint;
  for (const [a, b] of cuts) {
    if (b <= at) continue;
    if (a > at) spans.push([at, Math.min(a, outPoint)]);
    at = Math.max(at, b);
  }
  if (at < outPoint) spans.push([at, outPoint]);
  return spans.filter(([a, b]) => b - a > 0.05);
}

const scenes = board.scenes.map((scene) => {
  const meta = join(dir, "narration", `${scene.id}.json`);
  if (!existsSync(meta)) throw new Error(`No narration for "${scene.id}". Run narrate.mjs first.`);
  const narration = JSON.parse(readFileSync(meta, "utf8"));
  if (narration.text !== scene.narration) throw new Error(`The narration for "${scene.id}" is out of date. Run narrate.mjs again.`);
  const clip = clipOf(scene);
  const spans = keptSpans(scene, clip);
  const footage = spans.reduce((sum, [a, b]) => sum + (b - a), 0) / (scene.speed ?? 1);
  const length = Math.max(narration.duration + LEAD + TAIL, scene.minSeconds ?? 0);
  if (footage > length + 4) console.warn(`! ${scene.id}: ${footage.toFixed(1)}s of footage for ${length.toFixed(1)}s of narration; the end is cut. Trim it with "out" or speed it with "speed".`);
  return { scene, narration, clip, spans, length };
});

// ── Picture and sound, one scene at a time ──────────────────────────────────────────────────────
const inputs = [];
const filters = [];
let start = 0;
const timeline = [];
const logo = join(ROOT, "public/brand/selestial-logo-white.png");
const logoInput = scenes.length * 2;

scenes.forEach(({ scene, clip, spans, length }, i) => {
  inputs.push("-i", clip, "-i", join(dir, "narration", `${scene.id}.mp3`));
  const v = i * 2;
  const parts = spans.map(([a, b], k) => `[${v}:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[s${i}p${k}]`);
  const joined = spans.length > 1 ? `${spans.map((_, k) => `[s${i}p${k}]`).join("")}concat=n=${spans.length}:v=1:a=0[s${i}j]` : `[s${i}p0]null[s${i}j]`;
  const speed = scene.speed ?? 1;
  // Fit, then ease into the focus area over 0.8 s and hold it. Without a focus area the whole frame stays.
  const f = scene.focus;
  const zoom = f ? Math.min(W / f.w, H / f.h, 1.8) : 1;
  const cx = f ? f.x + f.w / 2 : W / 2;
  const cy = f ? f.y + f.h / 2 : H / 2;
  const z = `(1+${(zoom - 1).toFixed(4)}*min(t/0.8\\,1)*min(t/0.8\\,1)*(3-2*min(t/0.8\\,1))/1)`;
  const zoomChain = f
    ? `,scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame,crop=${W}:${H}:x='min(max(${cx}*iw/${W}-${W}/2\\,0)\\,iw-${W})':y='min(max(${cy}*ih/${H}-${H}/2\\,0)\\,ih-${H})'`
    : "";
  filters.push(
    ...parts,
    joined,
    `[s${i}j]setpts=PTS/${speed},fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0b14,setsar=1${zoomChain},tpad=stop_mode=clone:stop_duration=${length.toFixed(3)},trim=duration=${length.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`,
    `[${v + 1}:a]aresample=48000,adelay=${Math.round(LEAD * 1000)}:all=1,apad,atrim=duration=${length.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
  );
  timeline.push({ id: scene.id, start, length });
  start += length;
});
inputs.push("-loop", "1", "-i", logo);
filters.push(
  `${scenes.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${scenes.length}:v=1:a=1[vc][ac]`,
  // A small, quiet mark in the corner: branding, not a banner.
  `[${logoInput}:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.55[logo]`,
  `[vc][logo]overlay=x=W-w-36:y=H-h-30:shortest=1,format=yuv420p[vout]`,
  `[ac]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`,
);

const output = join(dir, "tutorial.mp4");
execFileSync("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-r", String(FPS), "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output], { stdio: "inherit" });

// ── Captions from the voice's own timings ───────────────────────────────────────────────────────
const lines = ["WEBVTT", ""];
let n = 1;
scenes.forEach(({ scene, narration }, i) => {
  for (const cue of cues(scene.narration, narration.alignment)) {
    lines.push(String(n++), `${vttTime(timeline[i].start + LEAD + cue.start)} --> ${vttTime(timeline[i].start + LEAD + cue.end + 0.25)}`, cue.text, "");
  }
});
writeFileSync(join(dir, "captions.vtt"), lines.join("\n"));

const posterScene = timeline[Math.max(0, board.scenes.findIndex((scene) => scene.poster))];
execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", (posterScene.start + Math.min(2, posterScene.length - 0.2)).toFixed(2), "-i", output, "-frames:v", "1", "-q:v", "3", join(dir, "poster.jpg")]);

const duration = probe(output);
const media = { version: board.version, durationSeconds: Math.round(duration * 10) / 10, files: { video: "tutorial.mp4", poster: "poster.jpg", captions: "captions.vtt" }, timeline };
writeFileSync(join(dir, "media.json"), JSON.stringify(media, null, 1));
console.log(`${output} · ${duration.toFixed(1)}s`);
