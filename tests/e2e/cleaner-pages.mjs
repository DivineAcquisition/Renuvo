/**
 * Drives the real cleaner pages in a phone-sized browser against a local Convex backend.
 * Nothing here reaches a deployment or a phone: the backend is the local one `npx convex dev` runs
 * with no account, and texts go to the mock provider. See docs/dispatch/04-verification.md to run it.
 *
 *   node tests/e2e/cleaner-pages.mjs            (expects the site on http://localhost:3100)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright is not a dependency of the app. It is taken from wherever the machine has it installed.
const { chromium } = createRequire(import.meta.url)("playwright");

const SITE = process.env.E2E_SITE ?? "http://localhost:3100";
const SHOTS = process.env.E2E_SHOTS ?? "docs/screenshots/dispatch";
const run = `e2e-${Date.now().toString(36)}`;
const identity = JSON.stringify({ subject: run, email: `${run}@example.com`, emailVerified: true, name: "Owner", issuer: "https://clerk.selestial.test", tokenIdentifier: `https://clerk.selestial.test|${run}` });
const env = { ...process.env };
// This script must only ever talk to the local backend named in .env.local.
delete env.CONVEX_DEPLOY_KEY;

function convex(fn, args = {}) {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args), "--identity", identity], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const text = out.trim();
  // A function that returns nothing prints nothing.
  return text ? JSON.parse(text) : null;
}

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const HOUR = 3_600_000;
// A company clock on which it is mid-morning now, so today's jobs never cross midnight.
const utcHour = new Date().getUTCHours();
const shift = utcHour - 9;
const timezone = shift === 0 ? "Etc/UTC" : `Etc/GMT${shift > 0 ? "+" : "-"}${Math.abs(shift)}`;
const now = Date.now();
const at = (hours) => Math.round((now + hours * HOUR) / 60_000) * 60_000;

// ── Synthetic records ───────────────────────────────────────────────────────────────────────────
const companyId = convex("companies:create", { name: "Brightside Cleaning (test)", timezone });
const c = (fn, args = {}) => convex(fn, { companyId, ...args });
const customerId = c("customers:create", { name: "Dana Whitfield", kind: "home" });
const propertyId = c("properties:create", { customerId, kind: "home", address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" }, accessInstructions: "Lockbox on the side gate, code from the office" });
const week = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));
const cleaner = (name, phone) => {
  const cleanerId = c("cleaners:create", { name, engagement: "contractor", phone, serviceAreas: ["78701"] });
  c("cleaners:setStatus", { cleanerId, status: "ready" });
  c("availability:setWeek", { cleanerId, windows: week });
  c("cleaners:setPay", { cleanerId, pay: { kind: "share", shareBps: 5000 } });
  return cleanerId;
};
const lena = cleaner("Lena Park", "+15550101010");
const rosa = cleaner("Rosa Diaz", "+15550102020");
for (const action of ["dispatch.request_acceptance", "dispatch.send_replacement_offer", "dispatch.run_backup_coverage", "dispatch.send_reminder"]) c("permissions:set", { action, level: "execute" });
c("dispatchOps:setPolicy", { policy: { beforePhotosRequired: 1, afterPhotosRequired: 1 } });
const newJob = (startHours, hours) => c("jobs:create", { customerId, propertyId, serviceType: "Standard clean", scope: "3 bed, 2 bath. Kitchen, bathrooms, floors, dusting.", priceCents: 16000, startsAt: at(startHours), endsAt: at(startHours + hours), instructions: "Dog is friendly. Please use the unscented products." });

const linkUrl = (jobId, cleanerId, purpose) => {
  const record = c("dispatchViews:jobRecord", { jobId });
  const link = record.links.find((row) => row.recipient.cleanerId === cleanerId && row.purpose === purpose && row.status === "active");
  if (!link) throw new Error(`no active ${purpose} link for that cleaner`);
  return { url: c("dispatchOps:revealActionLink", { linkId: link.linkId }).url, record };
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const file = (name) => ({ name, mimeType: "image/png", buffer: png });

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, geolocation: { latitude: 30.2672, longitude: -97.7431 }, permissions: ["geolocation"] });
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

try {
  // ── 1. Offer text → offer page → accept → job page ────────────────────────────────────────────
  const jobId = newJob(1, 2);
  c("dispatchOps:setChecklist", { jobId, items: [{ label: "Kitchen counters and sink", section: "Kitchen" }, { label: "Inside the oven", section: "Kitchen", requiresPhoto: true }, { label: "Balcony" }] });
  await wait(1500);
  const offer = linkUrl(jobId, lena, "offer");
  const offerText = offer.record.messages.find((row) => row.purpose === "offer");
  check("the offer text was handed to the (mock) provider and reported delivered", offerText?.status === "delivered", offerText?.status);
  check("the stored text has no link in it", offerText?.body.includes("{link}") && !offerText.body.includes("/c/offer/"));

  // A link previewer fetches the address without running the page. Nothing may change.
  const preview = await fetch(offer.url);
  const previewBody = await preview.text();
  check("fetching the offer address returns a page", preview.status === 200);
  check("the fetched page carries no address and is not indexable", !previewBody.includes("12 Elm") && (preview.headers.get("x-robots-tag") ?? "").includes("noindex") && preview.headers.get("referrer-policy") === "no-referrer");

  await page.goto(offer.url);
  await page.getByTestId("accept").waitFor();
  const offerBody = await page.locator("main").innerText();
  check("the offer page names the company and the task", offerBody.includes("BRIGHTSIDE CLEANING (TEST)") || offerBody.includes("Brightside Cleaning (test)"));
  check("the offer page shows pay, area, role and the deadline", (await page.getByTestId("pay").innerText()) === "$80.00" && offerBody.includes("Austin 78701") && offerBody.includes("Solo job") && offerBody.includes("Answer by"));
  check("the offer page does not show the street or how to get in", !offerBody.includes("12 Elm") && !offerBody.includes("Lockbox"));
  await page.reload();
  await page.getByTestId("accept").waitFor();
  check("opening and reloading the offer page accepted nothing", c("jobs:get", { jobId }).assignments[0].status === "offered");
  await shot("01-offer");

  await page.getByTestId("accept").click();
  await page.getByTestId("state-accepted").waitFor();
  check("after accepting, the page confirms and the job has its cleaner", c("jobs:get", { jobId }).coverage === "covered");
  await shot("02-accepted");
  await page.getByTestId("open-job").click();
  await page.getByTestId("check-in").waitFor();
  const jobBody = await page.locator("main").innerText();
  check("the job page shows the address and access instructions only now", jobBody.includes("12 Elm St") && jobBody.includes("Lockbox on the side gate"));
  check("the job page shows scope, instructions, role and pay", jobBody.includes("3 bed, 2 bath") && jobBody.includes("unscented") && jobBody.includes("Solo job") && jobBody.includes("$80.00"));
  await shot("03-assigned-job");
  const jobUrl = page.url();

  // ── 2. Check-in → before photos → checklist → add-on → after photos → submit ──────────────────
  await page.getByTestId("check-in").click();
  await page.getByTestId("checked-in").waitFor();
  const afterCheckIn = c("dispatchViews:board", { from: at(-2), to: at(8) }).jobs.find((row) => row.jobId === jobId);
  check("check-in is recorded with the phone's position and the job is in progress", afterCheckIn.crew[0].checkedInAt !== null && afterCheckIn.crew[0].checkInHasPosition === true && afterCheckIn.status === "in_progress");

  await page.getByTestId("before-input").setInputFiles([file("before-1.png")]);
  await page.getByTestId("before-count").filter({ hasText: "1 added" }).waitFor();
  check("a before photo uploads to storage and is counted", true);
  await page.reload();
  await page.getByTestId("before-count").filter({ hasText: "1 added" }).waitFor();
  check("reopening the page shows the photo already uploaded", true);

  await page.getByTestId("done-0").click();
  await page.getByTestId("item-0").getByText("Done by Lena").waitFor();
  await page.getByTestId("skip-2").click();
  await page.getByTestId("skip-reason").fill("Balcony door is locked");
  await page.getByTestId("confirm-skip").click();
  await page.getByTestId("item-2").getByText("Skipped by Lena: Balcony door is locked").waitFor();
  await page.getByTestId("done-1").click();
  await page.getByText("Add the photo for this item first.").waitFor();
  await page.getByTestId("item-1").getByTestId("item-input").setInputFiles([file("oven.png")]);
  await page.getByTestId("item-1").locator("img").waitFor();
  await page.getByTestId("done-1").click();
  await page.getByTestId("item-1").getByText("Done by Lena").waitFor();
  check("checklist: done, skipped with a reason, and a photo required before an item can be done", true);

  await page.getByTestId("kind-addon_request").click();
  await page.getByTestId("report-text").fill("Customer asked for inside the fridge too");
  // A draft survives a reload before it is sent.
  await page.reload();
  await page.getByTestId("report-text").waitFor();
  check("a typed draft is still there after the page is reopened", (await page.getByTestId("report-text").inputValue()) === "Customer asked for inside the fridge too");
  await page.getByTestId("kind-addon_request").click();
  await page.getByTestId("send-report").click();
  await page.getByTestId("report").getByText("Waiting for the office to decide").waitFor();
  check("an add-on request shows as waiting for a decision and changes no price", c("jobs:get", { jobId }).job.priceCents === 16000);

  check("submit is blocked until the after photo is in", await page.getByTestId("submit").isDisabled());
  await page.getByTestId("after-input").setInputFiles([file("after-1.png")]);
  await page.getByTestId("after-count").filter({ hasText: "1 added" }).waitFor();
  await shot("04-in-progress");
  await page.getByTestId("submit").click();
  await page.getByTestId("state-submitted").waitFor();
  const submittedBody = await page.locator("main").innerText();
  check("the confirmation says submitted for review, and claims no approval or payment", submittedBody.includes("Submitted for review") && submittedBody.includes("This is not an approval"));
  await shot("05-submitted");

  const board = c("dispatchViews:board", { from: at(-2), to: at(8) }).jobs.find((row) => row.jobId === jobId);
  const review = c("tasks:list", { status: "needs_decision" }).filter((task) => task.handoffTo === "quality");
  check("the owner's side: awaiting completion review, still in progress, one task in the Quality queue", board.group === "awaiting_completion_review" && board.status === "in_progress" && review.length === 1, review[0]?.title);
  const record = c("dispatchViews:jobRecord", { jobId });
  const jobLink = record.links.find((row) => row.purpose === "job");
  check("the job record shows the link's last action and does not claim it was opened", jobLink.lastAction === "complete" && jobLink.opened === null && jobLink.nextAction.startsWith("Submitted for review"));

  // ── 3. Decline ────────────────────────────────────────────────────────────────────────────────
  const declineJob = newJob(5, 1);
  await wait(1500);
  await page.goto(linkUrl(declineJob, lena, "offer").url);
  await page.getByTestId("decline").click();
  await page.getByTestId("confirm-decline").click();
  await page.getByTestId("state-declined").waitFor();
  await wait(1500);
  const afterDecline = c("jobs:get", { jobId: declineJob });
  check("declining asks to confirm, then the next cleaner is offered the job", afterDecline.assignments.some((row) => row.cleanerId === rosa && row.status === "offered"));
  await shot("06-declined");

  // ── 4. Backup: delay, then cannot attend, then the replacement ────────────────────────────────
  const rosaOffer = linkUrl(declineJob, rosa, "offer");
  await page.goto(rosaOffer.url);
  await page.getByTestId("accept").click();
  await page.getByTestId("open-job").click();
  await page.getByTestId("to-delay").click();
  await page.getByTestId("eta-20").click();
  await page.getByTestId("delay-reason").fill("Stuck behind an accident");
  await shot("07-delay");
  await page.getByTestId("send-eta").click();
  await page.getByTestId("delay-sent").waitFor();
  const live = c("dispatchViews:liveJobs", { from: at(-2), to: at(8) }).jobs.find((row) => row.jobId === declineJob);
  check("a reported delay is recorded with its ETA and is not a missed check-in", live.crew[0].late !== null && live.crew[0].contactStage === null);
  const rosaJobUrl = page.url().replace(/\/delay$/, "");
  await page.getByTestId("cannot").click();
  await page.getByTestId("cannot-reason").fill("Car will not start");
  await page.getByTestId("confirm-cannot").click();
  await page.getByTestId("state-ended").waitFor();
  await shot("08-no-longer-assigned");
  await page.goto(rosaJobUrl);
  await page.getByTestId("state-ended").waitFor();
  check("after dropping out, the old job link shows nothing about the job", !(await page.locator("main").innerText()).includes("12 Elm"));
  const afterDrop = c("dispatchViews:offersAndCoverage", { from: at(-2), to: at(8) });
  check("the drop opened a coverage request, and nobody is left so it is unresolved, not hidden", afterDrop.coverage.some((row) => row.jobId === declineJob && row.cause === "drop" && row.status === "unresolved"));

  // ── 5. Closed states ──────────────────────────────────────────────────────────────────────────
  await page.goto(offer.url);
  await page.getByTestId("state-accepted").waitFor();
  check("the spent offer link shows 'accepted' and cannot accept again", (await page.getByTestId("accept").count()) === 0);
  await page.goto(`${SITE}/c/offer/not-a-real-token`);
  await page.getByTestId("state-invalid").waitFor();
  check("a made-up link shows one plain message and nothing else", true);
  const jobLinkRow = c("dispatchViews:jobRecord", { jobId }).links.find((row) => row.purpose === "job" && row.status === "active");
  c("dispatchOps:revokeActionLink", { linkId: jobLinkRow.linkId, reason: "End of test" });
  await page.goto(jobUrl);
  await page.getByTestId("state-ended").waitFor();
  check("a revoked job link shows that it is closed, with no address", !(await page.locator("main").innerText()).includes("12 Elm"));
} catch (error) {
  check(`run stopped: ${error.message.split("\n")[0]}`, false);
  await shot("failure").catch(() => {});
} finally {
  await browser.close();
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
