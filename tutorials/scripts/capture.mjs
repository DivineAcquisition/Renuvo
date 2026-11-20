#!/usr/bin/env node
/**
 * Records a tutorial's Playwright scenes against a running Selestial, at 1920×1080, with a visible cursor
 * and a highlight ring on the control each step points at. Scenes with "kind": "manual" are recorded by a
 * person (see tutorials/README.md) and placed at tutorials/build/<id>/v<version>/clips/<scene>.mp4.
 *
 *   node tutorials/scripts/capture.mjs spreadsheet-prepare-clients \
 *     --base http://localhost:3000 --storage tutorials/.auth/demo-owner.json
 *
 * --storage is a Playwright storage state for an authorized demo account holding sample data only. It is
 * never committed (tutorials/.auth is ignored). Waits marked "cut" are left out of the final video.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { buildDir, loadStoryboard, ROOT } from "./lib.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const args = process.argv.slice(2);
const id = args[0];
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const base = flag("base", "http://localhost:3000");
const storage = flag("storage", undefined);
const only = flag("scene", undefined);

const board = loadStoryboard(id);
const clips = join(buildDir(board), "clips");
mkdirSync(clips, { recursive: true });

// The page is drawn at 1440×810 and recorded at 1920×1080, so text is larger than a 1080p screen shows it.
const VIEW = { width: 1440, height: 810 };

/** A cursor dot and a highlight ring, drawn in the page so the recording shows them. */
const OVERLAY = `
(() => {
  if (window.__tutorialOverlay) return;
  window.__tutorialOverlay = true;
  const style = document.createElement("style");
  style.textContent = \`
    #tut-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      background: rgba(104,56,239,.28); border: 2px solid #6838ef; pointer-events: none; transition: transform .12s ease; }
    #tut-cursor.down { transform: scale(.7); background: rgba(104,56,239,.5); }
    .tut-ring { position: fixed; z-index: 2147483646; border: 3px solid #8e6df6; border-radius: 12px; pointer-events: none;
      box-shadow: 0 0 0 6px rgba(142,109,246,.22); transition: all .25s ease; }
  \`;
  document.documentElement.appendChild(style);
  const cursor = document.createElement("div");
  cursor.id = "tut-cursor";
  document.documentElement.appendChild(cursor);
  addEventListener("mousemove", (e) => { cursor.style.left = e.clientX + "px"; cursor.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", () => cursor.classList.add("down"), true);
  addEventListener("mouseup", () => cursor.classList.remove("down"), true);
  window.__ring = (box) => {
    document.querySelectorAll(".tut-ring").forEach((el) => el.remove());
    if (!box) return;
    const ring = document.createElement("div");
    ring.className = "tut-ring";
    Object.assign(ring.style, { left: box.x - 6 + "px", top: box.y - 6 + "px", width: box.width + 12 + "px", height: box.height + 12 + "px" });
    document.documentElement.appendChild(ring);
  };
})();`;

const browser = await chromium.launch();
for (const scene of board.scenes) {
  if (scene.capture.kind !== "playwright" || (only && scene.id !== only)) continue;
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, storageState: storage ? resolve(storage) : undefined, recordVideo: { dir: clips, size: { width: 1920, height: 1080 } } });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  const began = Date.now();
  const cuts = [];
  await page.goto(new URL(scene.capture.start, base).toString(), { waitUntil: "networkidle" });
  // Loading is never part of the tutorial.
  cuts.push([0, (Date.now() - began) / 1000]);
  await page.evaluate(OVERLAY);
  const moveTo = async (locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Nothing to point at in ${scene.id}.`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
    return box;
  };
  for (const step of scene.capture.actions) {
    const at = (Date.now() - began) / 1000;
    if (step.do === "highlight") {
      const box = await moveTo(page.locator(step.target).first());
      await page.evaluate((b) => window.__ring(b), box);
      await page.waitForTimeout(step.ms ?? 1400);
    } else if (step.do === "click") {
      await moveTo(page.locator(step.target).first());
      await page.waitForTimeout(350);
      await page.locator(step.target).first().click();
      await page.evaluate(() => window.__ring(null));
    } else if (step.do === "type") {
      await moveTo(page.locator(step.target).first());
      await page.locator(step.target).first().pressSequentially(step.text, { delay: 60 });
    } else if (step.do === "upload") {
      await page.locator(step.target).first().setInputFiles(join(ROOT, step.file));
    } else if (step.do === "scroll") {
      await page.mouse.wheel(0, step.y ?? 400);
      await page.waitForTimeout(500);
    } else if (step.do === "wait" || step.do === "pause") {
      await page.waitForTimeout(step.ms);
    } else throw new Error(`Unknown step "${step.do}" in ${scene.id}.`);
    if (step.cut) cuts.push([at, (Date.now() - began) / 1000]);
  }
  await page.waitForTimeout(400);
  const ended = (Date.now() - began) / 1000;
  const video = page.video();
  await context.close();
  const raw = await video.path();
  const target = join(clips, `${scene.id}.webm`);
  renameSync(raw, target);
  writeFileSync(join(clips, `${scene.id}.cuts.json`), JSON.stringify({ end: ended, cuts }, null, 1));
  console.log(`+ ${scene.id} → ${target}`);
}
await browser.close();
