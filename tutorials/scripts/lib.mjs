/** Shared by the tutorial production scripts. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = new URL("../../", import.meta.url).pathname;

export function loadStoryboard(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`"${id}" is not a tutorial id.`);
  const board = JSON.parse(readFileSync(join(ROOT, "tutorials/storyboards", `${id}.json`), "utf8"));
  if (board.tutorial !== id) throw new Error(`The storyboard names ${board.tutorial}, not ${id}.`);
  return board;
}

export const buildDir = (board) => join(ROOT, "tutorials/build", board.tutorial, `v${board.version}`);

/** Seconds as a WebVTT timestamp. */
export function vttTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

/**
 * Caption cues for one scene from the voice's character timings: whole sentences, split at commas when a
 * cue would exceed two lines of about 42 characters. Times are relative to the scene's narration.
 */
export function cues(text, alignment, maxChars = 84) {
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const joined = chars.join("");
  const pieces = [];
  let from = 0;
  const pushUntil = (to) => {
    const raw = joined.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const piece = raw.trim();
    if (piece) pieces.push({ text: piece, a: from + lead, b: from + lead + piece.length - 1 });
    from = to;
  };
  const sentences = joined.match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) ?? [joined];
  let cursor = 0;
  for (const sentence of sentences) {
    const end = cursor + sentence.length;
    if (sentence.trim().length <= maxChars) pushUntil(end);
    else {
      // Break a long sentence at the comma nearest its middle.
      const commas = [...sentence.matchAll(/,\s/g)].map((m) => cursor + m.index + 1);
      const middle = cursor + sentence.length / 2;
      const at = commas.sort((x, y) => Math.abs(x - middle) - Math.abs(y - middle))[0];
      if (at) pushUntil(at);
      pushUntil(end);
    }
    cursor = end;
  }
  if (joined.trim() !== text.trim()) throw new Error("The timings do not match the narration text.");
  return pieces.map((piece) => ({ text: wrap(piece.text), start: starts[piece.a], end: ends[piece.b] }));
}

/** Two balanced lines when a cue is longer than one. */
function wrap(text, width = 42) {
  if (text.length <= width) return text;
  const words = text.split(" ");
  let best = text;
  let score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const s = Math.abs(a.length - b.length) + (Math.max(a.length, b.length) > width ? 100 : 0);
    if (s < score) {
      score = s;
      best = `${a}\n${b}`;
    }
  }
  return best;
}
