/**
 * Drives the real applicant pages in a phone-sized browser against a local Convex backend.
 * Nothing here reaches a deployment or a real inbox: the backend is the local one `npx convex dev` runs
 * with no account, and email goes to the mock provider. See docs/recruiter/04-verification.md to run it.
 *
 *   node tests/e2e/applicant-pages.mjs            (expects the site on http://localhost:3100)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright is not a dependency of the app. It is taken from wherever the machine has it installed.
const { chromium } = createRequire(import.meta.url)("playwright");

const SITE = process.env.E2E_SITE ?? "http://localhost:3100";
const SHOTS = process.env.E2E_SHOTS ?? "docs/screenshots/recruiter";
const run = `e2e-${Date.now().toString(36)}`;
const identity = JSON.stringify({ subject: run, email: `${run}@example.com`, emailVerified: true, name: "Owner", issuer: "https://clerk.selestial.test", tokenIdentifier: `https://clerk.selestial.test|${run}` });
const env = { ...process.env };
// This script must only ever talk to the local backend named in .env.local.
delete env.CONVEX_DEPLOY_KEY;

function convex(fn, args = {}) {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args), "--identity", identity], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const text = out.trim();
  return text ? JSON.parse(text) : null;
}

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, ok, what) {
  for (let i = 0; i < 20; i += 1) {
    const value = read();
    if (ok(value)) return value;
    await wait(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// A company clock on which it is mid-morning now, so nothing waits for sending hours.
const shift = new Date().getUTCHours() - 10;
const timezone = shift === 0 ? "Etc/UTC" : `Etc/GMT${shift > 0 ? "+" : "-"}${Math.abs(shift)}`;
const HOUR = 3_600_000;

// ── Synthetic records. No real person or address. ───────────────────────────────────────────────
const companyId = convex("companies:create", { name: "Brightside Cleaning (test)", timezone });
const c = (fn, args = {}) => convex(fn, { companyId, ...args });
c("recruiter:updatePlaybook", { settings: { replyTo: "hiring@brightside.test", sendDays: [0, 1, 2, 3, 4, 5, 6], sendFromMinute: 0, sendUntilMinute: 1440 } });
const needId = c("hiringNeeds:create", {
  title: "House Cleaner",
  responsibilities: "Clean homes to our checklist, alone or with one other cleaner.",
  location: "Austin, TX",
  coverageAreas: ["78701", "78702"],
  requiredAvailability: "At least two weekdays, and Saturdays in busy weeks.",
  engagement: "contractor",
  openings: 2,
  questions: [{ key: "own_supplies", label: "Do you have your own cleaning supplies?", kind: "yes_no", required: true }],
  criteria: [
    { key: "experience", label: "At least one year of paid cleaning experience", field: "experienceYears", test: { kind: "at_least", value: 1 }, fixed: true },
    { key: "supplies", label: "Has their own cleaning supplies", field: "q.own_supplies", test: { kind: "is_true" }, fixed: false },
  ],
});
const approveAll = () => {
  for (const approval of c("approvals:list")) c("approvals:decide", { approvalId: approval._id, decision: "approved" });
};
const invite = async (name, email) => {
  const applicationId = c("applications:addManually", { needId, name, email });
  approveAll();
  await until(() => c("applications:get", { applicationId }).stage, (stage) => stage === "invited", `${name} to be invited`);
  return applicationId;
};
const link = (applicationId, purpose) => c("applications:revealLink", { applicationId, purpose }).url;

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const body = () => page.locator("main").innerText();

try {
  // ── 1. Invitation → application page → draft → return visit → submit ──────────────────────────
  const maria = await invite("Maria Lopez", "maria.lopez@example.test");
  const sent = c("applications:get", { applicationId: maria }).conversation.find((row) => row.direction === "out");
  check("the invitation was handed to the (mock) email service and reported delivered", sent?.purpose === "application_invitation" && sent.status === "delivered", sent?.status);
  const applyUrl = link(maria, "apply");
  check("the application link is on the link host under /c/apply", applyUrl.startsWith(`${SITE}/c/apply/`));

  // A mail scanner fetches the address without running the page. Nothing may change.
  const preview = await fetch(applyUrl);
  const previewBody = await preview.text();
  check("fetching the address returns a page that is not indexable and leaks no referrer", preview.status === 200 && (preview.headers.get("x-robots-tag") ?? "").includes("noindex") && preview.headers.get("referrer-policy") === "no-referrer", `${preview.status} ${preview.headers.get("x-robots-tag")} ${preview.headers.get("referrer-policy")}`);
  check("the fetched page carries none of the applicant's details", !previewBody.includes("maria.lopez"));

  await page.goto(applyUrl);
  await page.getByTestId("next").waitFor();
  let text = await body();
  check("the page names the company and the role", /brightside cleaning \(test\)/i.test(text) && text.includes("House Cleaner application"));
  check("it says what happens next and that answers are saved", text.includes("Nothing is sent to the hiring team until you submit") && text.includes("come back with the same link"));
  check("it shows no estimated completion time", !/minutes|takes about/i.test(text));
  check("verified details are prefilled for correction", (await page.getByTestId("field-fullName").inputValue()) === "Maria Lopez" && (await page.getByTestId("field-email").inputValue()) === "maria.lopez@example.test");
  await page.reload();
  await page.getByTestId("next").waitFor();
  check("opening and reloading the page started and submitted nothing", c("applications:get", { applicationId: maria }).stage === "invited");
  await shot("01-application-start");

  await page.getByTestId("field-phone").fill("512-555-0142");
  await page.getByTestId("field-smsConsent").check();
  await page.getByTestId("field-city").fill("Austin");
  await page.getByTestId("next").click();
  await page.getByTestId("field-experienceYears").waitFor();
  check("saving the first step marks the application started", c("applications:get", { applicationId: maria }).stage === "application_started");
  check("the continue button waits for required answers", await page.getByTestId("next").isDisabled());
  await page.getByTestId("field-experienceYears").fill("3");
  await page.getByTestId("field-experienceSummary").fill("Three years cleaning homes and two short-term rentals.");
  await page.getByTestId("save-later").click();
  await page.getByTestId("saved").waitFor();
  await shot("02-application-draft-saved");

  // A return visit in a fresh browser: the draft comes back from the server, not from this phone.
  const second = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const back = await second.newPage();
  await back.goto(applyUrl);
  await back.getByTestId("next").waitFor();
  check("a return visit on another device has the saved answers", (await back.getByTestId("field-phone").inputValue()) === "15125550142" && (await back.getByTestId("field-city").inputValue()) === "Austin");
  await back.getByTestId("next").click();
  await back.getByTestId("field-experienceYears").waitFor();
  check("including the step that was saved for later", (await back.getByTestId("field-experienceYears").inputValue()) === "3");
  await second.close();

  await page.getByTestId("next").click();
  await page.getByTestId("field-availableDays-Tuesday").click();
  await page.getByTestId("field-availableDays-Saturday").click();
  await page.getByTestId("field-hoursPerWeek").fill("25");
  await page.getByTestId("field-serviceAreas-78701").click();
  await page.getByTestId("next").click();
  await page.getByTestId("field-q.own_supplies-yes").click();
  await page.getByTestId("next").click();
  await page.getByTestId("attest").waitFor();
  text = await body();
  check("the review step shows the answers before anything is submitted", text.includes("Tuesday, Saturday") && text.includes("Three years cleaning homes") && (await page.getByTestId("review-experienceYears").innerText()) === "3");
  check("submit is not possible before the confirmation is ticked", await page.getByTestId("submit").isDisabled());
  await page.getByTestId("file-input").setInputFiles([{ name: "Maria-Resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic resume for a test") }]);
  await page.getByText("Maria-Resume.pdf").waitFor();
  check("a resume uploads to private storage and is listed", c("applications:get", { applicationId: maria }).attachments.length === 1);
  await shot("03-application-review");
  check("still nothing submitted", c("applications:get", { applicationId: maria }).completion.submittedAt === null);
  await page.getByTestId("attest").check();
  await page.getByTestId("submit").click();
  await page.getByTestId("state-submitted").waitFor();
  text = await body();
  check("the confirmation explains the next stage without promising an interview or a job", text.includes("will review what you sent") && text.includes("does not guarantee an interview or a job"));
  await shot("04-application-submitted");
  const screened = c("applications:get", { applicationId: maria });
  check("the submitted application was screened with evidence and is with the owner", screened.stage === "screening" && screened.screening.recommendation === "advance" && screened.screening.results[0].evidence.includes('Answered "3"') && screened.nextAction.by === "owner");
  check("permission to text was recorded from the applicant's own tick", screened.applicant.mayBeTexted === true);
  await page.reload();
  await page.getByTestId("state-submitted").waitFor();
  check("the link now shows only that it was submitted", !(await body()).includes("512"));

  // ── 2. Interview: choose a time, and a second applicant cannot take it ────────────────────────
  const ownerId = c("members:list")[0].id;
  const start = Math.ceil((Date.now() + 26 * HOUR) / HOUR) * HOUR;
  c("interviews:addSlots", { interviewerId: ownerId, startsAt: start, endsAt: start + HOUR });
  c("applications:decide", { applicationId: maria, decision: "interview" });
  await wait(1000);
  const interviewUrl = link(maria, "interview");
  await page.goto(interviewUrl);
  await page.getByTestId(`slot-${start}`).waitFor();
  check("the interview page offers the open times and names the time zone", (await body()).includes(`Times are in ${timezone}`));
  check("opening it reserved nothing", c("interviews:board").interviews[0].status === "proposed");
  await shot("05-interview-choose");
  await page.getByTestId(`slot-${start}`).click();
  await page.getByTestId("state-confirmed").waitFor();
  check("choosing a time confirms it once the slot is reserved", c("interviews:board").interviews[0].status === "confirmed");
  await shot("06-interview-confirmed");

  const lee = await invite("Lee Wong", "lee.wong@example.test");
  // Lee's page was loaded before Maria booked; the stale button must not double-book.
  c("applications:revealLink", { applicationId: lee, purpose: "apply" });
  const leeApply = link(lee, "apply");
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const leePage = await other.newPage();
  await leePage.goto(leeApply);
  await leePage.getByTestId("withdraw").waitFor();
  await leePage.getByTestId("withdraw").click();
  await leePage.getByTestId("confirm-withdraw").click();
  await leePage.getByTestId("state-withdrawn").waitFor();
  check("an applicant can withdraw on the page, and the application is withdrawn", c("applications:get", { applicationId: lee }).stage === "withdrawn");
  await other.close();

  // ── 3. Offer: opening accepts nothing; accepting hands off to onboarding ──────────────────────
  // The interview is in the future, so the Owner goes straight to an offer here.
  c("hiringNeeds:setCompensation", { needId, pay: { kind: "share", shareBps: 4500 } });
  c("interviews:cancelTime", { interviewId: c("interviews:board").interviews[0].interviewId, reason: "Met in person instead." });
  c("applications:decide", { applicationId: maria, decision: "offer" });
  const offerId = c("hiringOffers:draft", { applicationId: maria, startConditions: "After onboarding is complete.", expectations: "Two weekdays and busy Saturdays." });
  c("hiringOffers:requestSend", { offerId });
  check("the drafted offer is not sent until a person approves it", c("applications:get", { applicationId: maria }).stage === "decision_pending");
  approveAll();
  await until(() => c("applications:get", { applicationId: maria }).stage, (stage) => stage === "offer_sent", "the offer to be sent");
  const offerUrl = link(maria, "hiring-offer");
  await fetch(offerUrl);
  await page.goto(offerUrl);
  await page.getByTestId("accept").waitFor();
  await page.reload();
  await page.getByTestId("accept").waitFor();
  check("fetching, opening and reloading the offer accepted nothing", c("applications:get", { applicationId: maria }).stage === "offer_sent");
  text = await body();
  check("the offer page shows the approved terms and says it is not the agreement", (await page.getByTestId("pay").innerText()) === "45% of each job's price" && text.includes("Independent contractor") && text.includes("not the agreement"));
  await shot("07-offer");
  await page.getByTestId("accept").click();
  check("accepting asks for confirmation first", c("applications:get", { applicationId: maria }).stage === "offer_sent");
  await page.getByTestId("confirm-accept").click();
  await page.getByTestId("state-accepted").waitFor();
  await shot("08-offer-accepted");
  const handoff = c("onboarding:queue")[0];
  check("acceptance created the onboarding handoff with every requirement outstanding", handoff?.applicant === "Maria Lopez" && handoff.requirements.every((row) => row.status === "outstanding"));
  check("the new worker is not dispatch-ready", handoff.workerStatus === "onboarding" && handoff.dispatchReady === false);

  // ── 4. Links that name nothing ────────────────────────────────────────────────────────────────
  await page.goto(`${applyUrl}x`);
  await page.getByTestId("state-invalid").waitFor();
  check("a tampered link shows the same plain message as any invalid link", true);
  await page.goto(applyUrl.replace("/c/apply/", "/c/hiring-offer/"));
  await page.getByTestId("state-invalid").waitFor();
  check("an application link does not open the offer page", true);
  await shot("09-invalid-link");
} catch (error) {
  check(`the run finished (${error instanceof Error ? error.message.split("\n")[0] : error})`, false);
  await shot("failure").catch(() => {});
} finally {
  await browser.close();
}

const failed = checks.filter((row) => !row.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
