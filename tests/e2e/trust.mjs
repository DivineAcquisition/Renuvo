/**
 * The trust and privacy browser run: cookie choices, tracker blocking, footer links, public request
 * forms, keyboard use and phone layout, against the running app.
 *
 *   node tests/e2e/trust.mjs [screenshot-directory]
 *
 * Start the app with fake tracker ids so every optional tool is "set up":
 *   NEXT_PUBLIC_VERCEL_ANALYTICS=1 NEXT_PUBLIC_GA4_ID=G-TEST12345 NEXT_PUBLIC_GOOGLE_ADS_ID=AW-123456789 \
 *   NEXT_PUBLIC_META_PIXEL_ID=1234567890123 npx next dev -p 3300
 * Requests to Google, Meta and Vercel's analytics are intercepted and answered with an empty script, so
 * nothing reaches them. Form submissions go to the dev record (PUBLIC_FORM_SECRET must be set).
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

import { expect, reporter } from "./auth-lib.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.TRUST_E2E_BASE ?? "http://localhost:3300";
const shots = process.argv[2] ?? null;
if (shots) mkdirSync(shots, { recursive: true });

const TRACKER = /googletagmanager\.com|google-analytics\.com|googleadservices\.com|doubleclick\.net|connect\.facebook\.net|facebook\.com\/tr|\/_vercel\/insights/;
const report = reporter();
const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined });

/** A fresh visitor. `hits` records every request to a tracking host; none of them leaves the machine. */
async function visitor({ gpc = false, viewport = { width: 1280, height: 860 } } = {}) {
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: gpc ? { "Sec-GPC": "1" } : {} });
  if (gpc) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  const hits = [];
  await ctx.route(TRACKER, (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => console.log("        page error:", String(error.message).slice(0, 160)));
  return { ctx, page, hits };
}

const banner = (page) => page.getByRole("region", { name: "Cookie choices" });
const toolScripts = (page) => page.locator("script[data-tool]").count();
const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};
const settle = (page) => page.waitForTimeout(1200);

try {
  console.log(`Trust run against ${BASE}\n\nCookie choices`);

  await report.check("before any choice: the banner shows and nothing optional loads", async () => {
    const { ctx, page, hits } = await visitor();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await banner(page).waitFor({ timeout: 15000 });
    await settle(page);
    expect(hits.length === 0, `Tracker requests before a choice: ${hits.join(", ")}`);
    expect((await toolScripts(page)) === 0, "A tool script tag exists before a choice.");
    const names = await banner(page).getByRole("button").allInnerTexts();
    expect(names.includes("Accept optional") && names.includes("Reject optional"), `Buttons: ${names.join(" | ")}`);
    await shot(page, "01-banner");
    await ctx.close();
  });

  await report.check("closing the banner is not acceptance", async () => {
    const { ctx, page, hits } = await visitor();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await banner(page).getByRole("button", { name: /Close without choosing/ }).click();
    await page.goto(`${BASE}/security`, { waitUntil: "networkidle" });
    await settle(page);
    expect(hits.length === 0, "Closing the banner loaded trackers.");
    expect((await banner(page).count()) === 0, "The banner came back in the same tab.");
    const fresh = await ctx.newPage();
    await fresh.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await banner(fresh).waitFor({ timeout: 15000 });
    await ctx.close();
  });

  await report.check("rejecting keeps every optional tool off, across pages and reloads", async () => {
    const { ctx, page, hits } = await visitor();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await banner(page).getByRole("button", { name: "Reject optional" }).click();
    await page.reload({ waitUntil: "networkidle" });
    await page.goto(`${BASE}/cookies`, { waitUntil: "networkidle" });
    await settle(page);
    expect(hits.length === 0, `Tracker requests after rejecting: ${hits.join(", ")}`);
    expect((await banner(page).count()) === 0, "The banner asked again after a choice.");
    await ctx.close();
  });

  const accepted = await visitor();
  await report.check("accepting loads the tools, telling them the path only", async () => {
    const { page, hits } = accepted;
    await page.goto(`${BASE}/?utm_source=test`, { waitUntil: "networkidle" });
    await banner(page).getByRole("button", { name: "Accept optional" }).click();
    await settle(page);
    expect(hits.some((url) => url.includes("googletagmanager.com/gtag/js")), "Google's tag did not load after accepting.");
    expect(hits.some((url) => url.includes("connect.facebook.net")), "Meta Pixel did not load after accepting.");
    expect(hits.some((url) => url.includes("/_vercel/insights")), "Vercel Analytics did not load after accepting.");
    const layer = JSON.stringify(await page.evaluate(() => window.dataLayer ?? []));
    expect(!layer.includes("utm_source"), "A query string was passed to Google.");
  });

  await report.check("no tool loads on request forms, sign-in or an address with a token, even after accepting", async () => {
    const { page, hits } = accepted;
    for (const path of ["/privacy/requests", "/security/report", "/security/review", "/login", "/?token=abc123"]) {
      hits.length = 0;
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await settle(page);
      expect(hits.length === 0 && (await toolScripts(page)) === 0, `${path} loaded: ${hits.join(", ")}`);
    }
  });

  await report.check("withdrawing from the footer stops tracking from the next page on", async () => {
    const { page, hits } = accepted;
    await page.goto(`${BASE}/terms`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Cookie preferences" }).click();
    const dialog = page.getByRole("dialog", { name: "Cookie preferences" });
    await dialog.waitFor({ timeout: 10000 });
    await shot(page, "02-preferences");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), dialog.getByRole("button", { name: "Reject optional" }).click()]);
    hits.length = 0;
    await page.goto(`${BASE}/security`, { waitUntil: "networkidle" });
    await settle(page);
    expect(hits.length === 0, `Tracker requests after withdrawing: ${hits.join(", ")}`);
    const cookies = (await accepted.ctx.cookies()).map((cookie) => cookie.name);
    expect(!cookies.some((name) => /^_ga|^_fbp|^_gcl/.test(name)), `Optional cookies left: ${cookies.join(", ")}`);
    await accepted.ctx.close();
  });

  await report.check("a Global Privacy Control signal keeps advertising off even when everything is accepted", async () => {
    const { ctx, page, hits } = await visitor({ gpc: true });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await banner(page).getByText("Global Privacy Control").waitFor({ timeout: 15000 });
    await banner(page).getByRole("button", { name: "Accept optional" }).click();
    await settle(page);
    expect(!hits.some((url) => url.includes("connect.facebook.net")), "Meta Pixel loaded despite the signal.");
    expect(hits.some((url) => url.includes("/_vercel/insights")), "Analytics chosen with the signal on did not load.");
    const layer = JSON.stringify(await page.evaluate(() => window.dataLayer ?? []));
    expect(!layer.includes("AW-"), "The Google Ads tag was configured despite the signal.");
    await ctx.close();
  });

  await report.check("the preferences dialog works from the keyboard and Escape closes it", async () => {
    const { ctx, page } = await visitor();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await banner(page).getByRole("button", { name: "Manage preferences" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Cookie preferences" });
    await dialog.waitFor({ timeout: 10000 });
    const focusedInside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
    expect(focusedInside, "Focus did not move into the dialog.");
    for (let index = 0; index < 12; index += 1) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), "Tab left the dialog.");
    await page.keyboard.press("Escape");
    expect((await dialog.count()) === 0, "Escape did not close the dialog.");
    await ctx.close();
  });

  console.log("\nPages and links");
  await report.check("every footer link opens a real page", async () => {
    const { ctx, page } = await visitor();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const links = await page.locator("footer a[href]").evaluateAll((items) => items.map((item) => item.getAttribute("href")));
    expect(links.length >= 9, `Only ${links.length} footer links.`);
    for (const href of links) {
      if (href.startsWith("mailto:")) continue;
      const response = await ctx.request.get(`${BASE}${href}`);
      expect(response.status() === 200, `${href} answered ${response.status()}`);
    }
    expect(links.includes("mailto:support@selestial.io"), "No contact link.");
    expect((await page.locator("footer").getByRole("button", { name: "Cookie preferences" }).count()) === 1, "No cookie preferences control in the footer.");
    await ctx.close();
  });

  await report.check("each policy page shows its version and date, and security.txt names the security contact", async () => {
    const { ctx, page } = await visitor();
    for (const path of ["/privacy", "/terms", "/cookies", "/messaging", "/security"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const text = await page.locator("main").innerText();
      expect(/In effect from \w+ \d+, \d{4}/.test(text) || /Being finalized/.test(text), `${path} shows no effective date.`);
      expect(/Version history/.test(text), `${path} has no version history.`);
    }
    await shot(page, "03-security");
    const txt = await ctx.request.get(`${BASE}/.well-known/security.txt`);
    const body = await txt.text();
    expect(txt.status() === 200 && /Contact: mailto:security@selestial\.io/.test(body) && /Expires: /.test(body), `security.txt: ${txt.status()} ${body.slice(0, 120)}`);
    await ctx.close();
  });

  await report.check("the landing page shows only verified claims, and no unsupported badge words", async () => {
    const { ctx, page } = await visitor();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const section = page.locator("#trust");
    await section.waitFor({ timeout: 15000 });
    await section.scrollIntoViewIfNeeded();
    await settle(page);
    await shot(page, "04-landing-trust");
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const banned of ["soc 2", "iso 27001", "hipaa", "gdpr compliant", "bank-level", "100% secure", "never leaves selestial", "never use your data for training", "all actions require approval"]) {
      expect(!text.includes(banned), `The page says "${banned}".`);
    }
    await section.getByRole("link", { name: "Explore security & privacy" }).waitFor();
    await section.getByRole("link", { name: "Ask a security question" }).waitFor();
    await ctx.close();
  });

  console.log("\nForms");
  const run = Date.now().toString(36);
  await report.check("a privacy request is saved and answered with a reference", async () => {
    const { ctx, page } = await visitor();
    await page.goto(`${BASE}/privacy/requests`, { waitUntil: "networkidle" });
    await shot(page, "05-privacy-request");
    await page.getByRole("button", { name: /Send/ }).click();
    await page.locator('[role="alert"]').first().waitFor({ timeout: 15000 });
    await page.getByLabel("Your email").fill(`e2e-${run}@example.com`);
    await page.getByLabel("What would you like to do?").selectOption({ index: 1 });
    await page.getByLabel("Your relationship to Selestial").selectOption({ index: 1 });
    await page.getByLabel("Details").fill("Synthetic test request from the trust browser run. Please ignore.");
    await page.getByRole("button", { name: /Send/ }).click();
    await page.getByText("Received").waitFor({ timeout: 20000 });
    expect(/reference [A-Z0-9-]{6,}/i.test(await page.locator("main").innerText()), "No reference was shown.");
    await ctx.close();
  });

  await report.check("a vulnerability report needs no business name and no marketing consent", async () => {
    const { ctx, page } = await visitor();
    await page.goto(`${BASE}/security/report`, { waitUntil: "networkidle" });
    const labels = (await page.locator("main label").allInnerTexts()).join(" | ").toLowerCase();
    expect(!labels.includes("business") && !labels.includes("marketing"), `Labels: ${labels}`);
    await page.getByLabel("Your email").fill(`researcher-${run}@example.com`);
    await page.getByLabel("What is affected").fill("Synthetic test: /example");
    await page.getByLabel("What you found").fill("Synthetic test report from the trust browser run. Please ignore.");
    await page.getByRole("button", { name: /Send/ }).click();
    await page.getByText("Received").waitFor({ timeout: 20000 });
    await ctx.close();
  });

  console.log("\nPhone");
  await report.check("trust pages fit a phone without sideways scrolling", async () => {
    const { ctx, page } = await visitor({ viewport: { width: 390, height: 844 } });
    for (const path of ["/", "/security", "/security/subprocessors", "/privacy", "/terms", "/cookies", "/messaging", "/privacy/requests", "/security/report", "/security/review"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(!wide, `${path} scrolls sideways on a phone.`);
    }
    await page.goto(`${BASE}/security/subprocessors`, { waitUntil: "networkidle" });
    await shot(page, "06-phone-subprocessors");
    await ctx.close();
  });
} catch (error) {
  console.log(`\nStopped early: ${String(error?.message ?? error).split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

const failed = report.done();
process.exit(failed > 0 || process.exitCode ? 1 : 0);
