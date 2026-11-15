#!/usr/bin/env node
/**
 * Draws every app icon from one source: the Selestial mark in white on a violet rounded square, in the
 * owner's palette. Run with `node scripts/generate-icons.mjs` after the mark or the brand colour changes,
 * and commit the results.
 *
 *   src/app/favicon.ico          16, 32 and 48 px, for browsers that ask for /favicon.ico
 *   src/app/icon1.png            32 px tab icon        (Next's `icon` file convention)
 *   src/app/icon2.png            192 px                 (same convention, a sharper tab and shortcut icon)
 *   src/app/apple-icon.png       180 px, full-bleed square: iOS rounds the corners itself
 *   public/icons/icon-192.png    installable-app icons, rounded square on transparent corners
 *   public/icons/icon-512.png
 *   public/icons/icon-*-maskable.png  full-bleed violet, mark inside the 80% safe zone
 *   public/icons/apple-touch-icon.png and public/apple-touch-icon.png, for clients that ask by path
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = join(import.meta.dirname, "..");

// Selestial Violet at the top-left to Deep Violet at the bottom-right. Both are from the owner's palette,
// and the white mark reads on either end.
const TOP = "#6838EF";
const BOTTOM = "#5126C7";

/** The mark, traced from the owner's logo file. It sits in a box 58.43 wide and 100 tall. */
const MARK_WIDTH = 58.43;
const MARK_HEIGHT = 100;
const MARK =
  "M29.1 0.2C29.04 0.37 26.99 6.07 26.46 7.55C26.26 8.12 25.94 9.03 25.74 9.57C25.54 10.12 25.22 11.03 25.02 11.59C24.81 12.16 24.55 12.9 24.43 13.23C24.3 13.57 23.9 14.69 23.54 15.71C23.17 16.74 22.77 17.84 22.66 18.15C22.54 18.47 21.51 21.35 20.36 24.56C19.22 27.77 18.25 30.43 18.22 30.47C18.15 30.54 18.15 30.55 17.12 29.99C12.43 27.46 8.31 23.1 6.2 18.42C6.07 18.13 5.87 17.68 5.76 17.43C5.46 16.77 4.77 14.65 4.57 13.81C4.48 13.41 4.36 12.88 4.3 12.64C4.17 12.07 3.9 9.9 3.82 8.77C3.77 7.97 3.76 7.91 3.67 8.12C3.62 8.25 3.51 8.49 3.43 8.66C2.48 10.69 1.65 13.58 1.3 16.12C0.07 24.88 2.84 33.39 8.99 39.76L9.78 40.57 9.52 40.73C7.84 41.78 4.01 43.41 1.29 44.23C0.21 44.56 0.07 44.62 0.27 44.66C2.21 45.14 5.88 47.2 8.52 49.31C19.77 58.29 26.69 74.87 28.64 97.47C28.75 98.7 28.85 99.74 28.88 99.78C28.93 99.87 29.42 99.87 29.48 99.77C29.51 99.73 29.61 98.74 29.71 97.58C30.77 85.43 33.03 75.72 36.77 67.24C41.26 57.04 47.99 49.34 55.57 45.72C56.57 45.24 57.95 44.7 58.15 44.7C58.54 44.7 58.19 44.53 57.15 44.21C54.36 43.37 50.59 41.78 48.9 40.73L48.64 40.57 49.4 39.79C50.24 38.93 50.72 38.4 51.07 37.96C51.19 37.79 51.46 37.45 51.67 37.19C52.2 36.52 53.37 34.73 53.91 33.75C56.27 29.49 57.4 25.05 57.39 20.06C57.38 15.95 56.7 12.58 55.12 8.92C54.46 7.38 54.51 7.35 54.4 9.34C53.9 18.04 48.65 26.15 40.94 30.11L40.19 30.5 40.08 30.26C40 30.07 35.44 17.41 34.36 14.34C34.26 14.07 34.08 13.57 33.96 13.23C33.66 12.41 33.36 11.59 31.16 5.45C30.13 2.56 29.25 0.16 29.22 0.13C29.18 0.09 29.13 0.13 29.1 0.2Z";

/**
 * One icon as SVG: the square (rounded unless `bleed`), the gradient, a soft top highlight, and the mark
 * centred at `markHeight` of the side.
 */
function svg({ size, bleed, markHeight }) {
  const radius = bleed ? 0 : Math.round(size * 0.225);
  const scale = (size * markHeight) / MARK_HEIGHT;
  const x = (size - MARK_WIDTH * scale) / 2;
  const y = (size - MARK_HEIGHT * scale) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${TOP}"/>
      <stop offset="1" stop-color="${BOTTOM}"/>
    </linearGradient>
    <radialGradient id="hl" cx="0.3" cy="0.1" r="0.8">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#g)"/>
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#hl)"/>
  <path d="${MARK}" fill="#ffffff" transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${scale.toFixed(5)})"/>
</svg>`);
}

async function render(options) {
  return sharp(svg(options), { density: 300 }).resize(options.size, options.size).png({ compressionLevel: 9 }).toBuffer();
}

/** An .ico holding PNG images, which every current browser reads. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

// The mark is tall and narrow, so small sizes get a taller mark to still read at 16 px.
const small = (size) => render({ size, bleed: false, markHeight: size <= 32 ? 0.8 : 0.74 });
const rounded = (size) => render({ size, bleed: false, markHeight: 0.7 });
const square = (size) => render({ size, bleed: true, markHeight: 0.66 });
const maskable = (size) => render({ size, bleed: true, markHeight: 0.56 });

const outputs = {
  "src/app/favicon.ico": ico([
    { size: 16, data: await small(16) },
    { size: 32, data: await small(32) },
    { size: 48, data: await small(48) },
  ]),
  "src/app/icon1.png": await small(32),
  "src/app/icon2.png": await rounded(192),
  "src/app/apple-icon.png": await square(180),
  "public/icons/icon-192.png": await rounded(192),
  "public/icons/icon-512.png": await rounded(512),
  "public/icons/icon-192-maskable.png": await maskable(192),
  "public/icons/icon-512-maskable.png": await maskable(512),
  "public/icons/apple-touch-icon.png": await square(180),
  "public/apple-touch-icon.png": await square(180),
};

for (const [path, data] of Object.entries(outputs)) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), data);
  console.log(`${path}  ${data.length} bytes`);
}
