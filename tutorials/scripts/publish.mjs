#!/usr/bin/env node
/**
 * Uploads a reviewed tutorial build to Vercel Blob, under a path that names the tutorial and version, so
 * an old version keeps working until staff point the tutorial at the new one. Blob serves each file with
 * its content type and answers range requests, so the player can seek.
 *
 *   BLOB_READ_WRITE_TOKEN=... node tutorials/scripts/publish.mjs spreadsheet-prepare-clients
 *
 * Prints the media entry to paste into the staff panel (Tutorials › Replace media version) or into the
 * catalog. Publishing the file does not publish the tutorial: staff do that after review.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { put } from "@vercel/blob";

import { buildDir, loadStoryboard } from "./lib.mjs";

const id = process.argv[2];
const board = loadStoryboard(id);
const dir = buildDir(board);
const media = JSON.parse(readFileSync(join(dir, "media.json"), "utf8"));
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Set BLOB_READ_WRITE_TOKEN for the tutorial media store.");

const TYPES = { video: "video/mp4", poster: "image/jpeg", captions: "text/vtt" };
const urls = {};
for (const [kind, file] of Object.entries(media.files)) {
  const blob = await put(`tutorials/${id}/v${board.version}/${file}`, readFileSync(join(dir, file)), {
    access: "public",
    contentType: TYPES[kind],
    addRandomSuffix: false,
    allowOverwrite: false,
    // A version never changes once uploaded, so it can be cached for a year.
    cacheControlMaxAge: 31_536_000,
  });
  urls[kind] = blob.url;
  console.log(`+ ${kind}: ${blob.url}`);
}
console.log(JSON.stringify({ version: board.version, video: urls.video, poster: urls.poster, captions: urls.captions, durationSeconds: media.durationSeconds }, null, 2));
