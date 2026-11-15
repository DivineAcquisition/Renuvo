#!/usr/bin/env node
/**
 * Turns the logo SVGs in public/brand into PNGs for places that cannot take an SVG (email, slides,
 * social profiles). Run after `python3 scripts/generate-logo.py`. Each PNG is 1600 px wide (the stacked
 * ones 1000) on a transparent background.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const dir = join(import.meta.dirname, "..", "public", "brand");
for (const file of (await readdir(dir)).filter((name) => /^selestial-logo.*\.svg$/.test(name))) {
  const width = file.includes("stacked") ? 1000 : 1600;
  const png = await sharp(await readFile(join(dir, file)), { density: 600 }).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
  const out = file.replace(/\.svg$/, ".png");
  await writeFile(join(dir, out), png);
  console.log(`public/brand/${out}  ${png.length} bytes`);
}
