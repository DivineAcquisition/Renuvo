/**
 * The sign-in browser run: real pages, a real browser, the real sign-in service and the dev record.
 *
 *   NODE_USE_ENV_PROXY=1 CLERK_SECRET_KEY=... node tests/e2e/auth.mjs [screenshot-directory]
 *
 * Needs the app running (AUTH_E2E_BASE, default http://localhost:3200) against a DEVELOPMENT sign-in
 * instance. Every person it makes has an address ending "+clerk_test@example.com": no email is sent to
 * anyone, and the fixed code 424242 stands in for the emailed one. It removes the people it made.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

import { activeSessions, assertDevelopment, BASE, CODE, expect, makePerson, passBotCheck, removePerson, reporter } from "./auth-lib.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const shots = process.argv[2] ?? null;
if (shots) mkdirSync(shots, { recursive: true });

const run = Date.now().toString(36);
const password = (label) => `Tidy-${label}-Harbor-${run}-91`;
const INVALID = "That email and password do not match an account";
const pages = [];
/** On a failure, every open page is photographed, so the report shows what was on screen. */
const report = reporter(async (count) => {
  if (!shots) return;
  for (const [index, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: `${shots}/fail-${count}-page${index}.png` }).catch(() => undefined);
});
const made = [];

const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined });

async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, ...options });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await passBotCheck(ctx);
  ctx.on("page", (page) => pages.push(page));
  return ctx;
}

const path = (page) => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
};
const heading = (page) => page.locator("h1").first().innerText();
const notice = (page) => page.locator('form [role="alert"], form [role="status"]').filter({ hasText: /\S/ });
const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};
async function settle(page, test, what, timeout = 30000) {
  await page.waitForFunction(test, undefined, { timeout }).catch(() => {
    throw new Error(`Timed out waiting for ${what}. At ${page.url().replace(BASE, "")}`);
  });
}

/** Signs a person in through the real form, answering the new-device code when it is asked for. */
async function signIn(page, person, target = "/login") {
  await page.goto(`${BASE}${target}`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await settle(page, () => !location.pathname.startsWith("/login") || document.querySelector("h1")?.textContent === "Confirm it is you" || Boolean(document.querySelector('form [role="alert"]')), "the sign-in to answer");
  if ((await heading(page)) === "Confirm it is you") {
    await page.getByLabel("Code").fill(CODE);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await settle(page, () => !location.pathname.startsWith("/login") && !location.pathname.startsWith("/auth/callback"), "the session to open");
}

async function openSettings(page) {
  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Settings", exact: true }).first().waitFor({ timeout: 30000 });
}

/** Invites someone from Settings and returns the link, read from the clipboard the way an Owner would copy it. */
async function invite(page, name, email, role) {
  await openSettings(page);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Invite", exact: true }) });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Email", { exact: true }).fill(email);
  await form.getByLabel("Role").selectOption(role);
  await form.getByRole("button", { name: "Invite", exact: true }).click();
  const row = page.locator("li").filter({ hasText: email });
  await row.getByRole("button", { name: "Copy link" }).click();
  await row.getByRole("button", { name: "Copied" }).waitFor({ timeout: 15000 });
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link.startsWith(`${BASE}/invite/`), "The copied text is not an invitation link.");
  return link;
}

try {
  await assertDevelopment();
  const owner = await makePerson(run, "owner", password("owner"), "Olive Owner");
  const staff = await makePerson(run, "staff", password("staff"), "Sam Staff");
  const other = await makePerson(run, "other", password("other"), "Otto Other");
  made.push(owner, staff, other);
  const company = `E2E Cleaning ${run}`;
  console.log(`Run ${run} against ${BASE}\n`);

  const ownerCtx = await context();
  const ownerPage = await ownerCtx.newPage();
  ownerPage.on("pageerror", (error) => console.log("        page error:", String(error.message).slice(0, 160)));

  console.log("Signed out");
  await report.check("a workspace page sends a signed-out visitor to sign-in and remembers the page", async () => {
    await ownerPage.goto(`${BASE}/app/approvals`, { waitUntil: "networkidle" });
    expect(path(ownerPage) === "/login?next=%2Fapp%2Fapprovals", `Landed on ${path(ownerPage)}`);
  });
  await report.check("a workspace API route refuses a signed-out request", async () => {
    const response = await ownerCtx.request.get(`${BASE}/app/settings/password-policy`, { maxRedirects: 0 });
    expect(response.status() === 307 && (response.headers().location ?? "").includes("/login"), `Status ${response.status()}`);
  });
  await report.check("the cleaner link pages still open without signing in", async () => {
    const response = await ownerCtx.request.get(`${BASE}/c/offer/not-a-real-link`, { maxRedirects: 0 });
    expect(response.status() === 200, `Status ${response.status()}`);
    await ownerPage.goto(`${BASE}/c/offer/not-a-real-link`, { waitUntil: "networkidle" });
    expect(new URL(ownerPage.url()).pathname === "/c/offer/not-a-real-link", "The link page redirected.");
    expect((await ownerPage.getByLabel("Password", { exact: true }).count()) === 0, "The link page asked for a password.");
  });

  console.log("\nSigning in");
  await report.check("a wrong password and an unknown email get the same answer, and the email stays in the field", async () => {
    await ownerPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await shot(ownerPage, "01-login");
    await ownerPage.getByLabel("Email").fill(owner.email);
    await ownerPage.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await ownerPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await notice(ownerPage).first().waitFor({ timeout: 20000 });
    const wrong = await notice(ownerPage).first().innerText();
    expect(wrong.includes(INVALID), `Wrong password said: ${wrong}`);
    expect((await ownerPage.getByLabel("Email").inputValue()) === owner.email, "The email was cleared.");
    await shot(ownerPage, "02-login-refused");
    await ownerPage.getByLabel("Email").fill(`nobody-${run}+clerk_test@example.com`);
    await ownerPage.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await ownerPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await ownerPage.waitForTimeout(2500);
    const unknown = await notice(ownerPage).first().innerText();
    expect(unknown === wrong, `Unknown email said something different: ${unknown}`);
    expect(path(ownerPage).startsWith("/login"), "A refused sign-in left the page.");
  });
  await report.check("an outside address in the return link is ignored: sign-in lands inside the app", async () => {
    await signIn(ownerPage, owner, `/login?next=${encodeURIComponent("https://evil.example/steal")}`);
    expect(new URL(ownerPage.url()).origin === BASE, `Left the app: ${ownerPage.url()}`);
    expect(new URL(ownerPage.url()).pathname === "/app", `Landed on ${path(ownerPage)}`);
  });
  await report.check("a signed-in person with no company gets workspace setup, and creating it opens the workspace", async () => {
    expect((await heading(ownerPage)) === "Set up your company", `Heading was ${await heading(ownerPage)}`);
    await shot(ownerPage, "03-workspace-setup");
    await ownerPage.getByLabel("Company name").fill(company);
    await ownerPage.getByLabel(/I accept the/).check();
    await ownerPage.getByRole("button", { name: "Create company" }).click();
    await ownerPage.getByText(company).first().waitFor({ timeout: 30000 });
    await ownerPage.getByRole("button", { name: /Account menu/ }).waitFor({ timeout: 30000 });
    await shot(ownerPage, "04-workspace");
  });
  await report.check("a signed-in person who opens sign-in is sent on to the workspace", async () => {
    await ownerPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    expect(new URL(ownerPage.url()).pathname === "/app", `Stayed on ${path(ownerPage)}`);
  });
  await report.check("a workspace API route answers a signed-in request, without caching", async () => {
    const response = await ownerCtx.request.get(`${BASE}/app/settings/password-policy`, { maxRedirects: 0 });
    expect(response.status() === 200, `Status ${response.status()}`);
    expect((response.headers()["cache-control"] ?? "").includes("no-store"), "The answer could be cached.");
    expect(typeof (await response.json())?.min_length === "number", "No password rules came back.");
  });

  console.log("\nInvitations");
  let staffLink = "";
  await report.check("the Owner invites a person and copies a link that is not stored in the page", async () => {
    staffLink = await invite(ownerPage, staff.name, staff.email, "office");
    await shot(ownerPage, "05-settings-people");
    const html = await ownerPage.content();
    expect(!html.includes(staffLink.split("/invite/")[1]), "The token is in the page's markup.");
  });
  await report.check("a tampered link is not valid", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${staffLink.slice(0, -3)}abc`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "This invitation link is not valid" }).waitFor({ timeout: 20000 });
    await ctx.close();
  });
  const otherCtx = await context();
  const otherPage = await otherCtx.newPage();
  await report.check("someone signed in with a different email cannot accept it, and gains nothing", async () => {
    await signIn(otherPage, other);
    await otherPage.goto(staffLink, { waitUntil: "networkidle" });
    await otherPage.getByRole("button", { name: "Accept invitation" }).click();
    await otherPage.getByText("This invitation is for a different email").waitFor({ timeout: 20000 });
    await shot(otherPage, "06-invite-wrong-account");
    await otherPage.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    await otherPage.getByRole("heading", { name: "Set up your company" }).waitFor({ timeout: 20000 });
  });
  const staffCtx = await context();
  const staffPage = await staffCtx.newPage();
  await report.check("the invited person, signed out, sees the company and role, signs in and comes back to the invitation", async () => {
    await staffPage.goto(staffLink, { waitUntil: "networkidle" });
    await staffPage.getByRole("heading", { name: `Join ${company}` }).waitFor({ timeout: 20000 });
    await staffPage.getByText("Office", { exact: true }).first().waitFor();
    await shot(staffPage, "07-invite-signed-out");
    await staffPage.getByRole("button", { name: "I already have an account" }).click();
    await settle(staffPage, () => location.pathname === "/login", "the sign-in page");
    expect(path(staffPage).includes("next=%2Finvite%2F"), `The invitation was not kept: ${path(staffPage)}`);
    await staffPage.getByLabel("Email").fill(staff.email);
    await staffPage.getByLabel("Password", { exact: true }).fill(staff.password);
    await staffPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await settle(staffPage, () => !location.pathname.startsWith("/login") || document.querySelector("h1")?.textContent === "Confirm it is you", "sign-in");
    if ((await heading(staffPage)) === "Confirm it is you") {
      await shot(staffPage, "08-login-new-device-code");
      await staffPage.getByLabel("Code").fill(CODE);
      await staffPage.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await settle(staffPage, () => location.pathname.startsWith("/invite/"), "the return to the invitation");
    await staffPage.getByRole("button", { name: "Accept invitation" }).waitFor({ timeout: 20000 });
    await shot(staffPage, "09-invite-signed-in");
  });
  await report.check("accepting joins that company with the invited role, and nothing more", async () => {
    await staffPage.getByRole("button", { name: "Accept invitation" }).click();
    await settle(staffPage, () => location.pathname === "/app", "the workspace");
    await staffPage.getByText(company).first().waitFor({ timeout: 30000 });
    await openSettings(staffPage);
    await staffPage.getByText(staff.email).first().waitFor({ timeout: 20000 });
    expect((await staffPage.getByRole("heading", { name: "Invite someone" }).count()) === 0, "Office staff can invite people.");
  });
  await report.check("the same link again is already used, for the person who used it and for anyone else", async () => {
    await staffPage.goto(staffLink, { waitUntil: "networkidle" });
    await staffPage.getByRole("heading", { name: "This invitation was already used" }).waitFor({ timeout: 20000 });
    await otherPage.goto(staffLink, { waitUntil: "networkidle" });
    await otherPage.getByRole("heading", { name: "This invitation was already used" }).waitFor({ timeout: 20000 });
  });
  await report.check("someone outside a company cannot open it by naming it", async () => {
    const companyId = await staffPage.evaluate(() => window.localStorage.getItem("selestial.company"));
    expect(Boolean(companyId), "The company id was not remembered for the member.");
    await otherPage.evaluate((id) => window.localStorage.setItem("selestial.company", id), companyId);
    await otherPage.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    await otherPage.getByRole("heading", { name: "Set up your company" }).waitFor({ timeout: 20000 });
    expect((await otherPage.getByText(company).count()) === 0, "The other company's name was shown.");
  });
  await report.check("a withdrawn invitation stops working", async () => {
    const link = await invite(ownerPage, other.name, other.email, "manager");
    const row = ownerPage.locator("li").filter({ hasText: other.email });
    await row.getByRole("button", { name: "Withdraw" }).click();
    await row.getByText("Withdrawn").first().waitFor({ timeout: 20000 });
    await otherPage.goto(link, { waitUntil: "networkidle" });
    await otherPage.getByRole("heading", { name: "This invitation was withdrawn" }).waitFor({ timeout: 20000 });
  });
  await report.check("a new link replaces the old one: the old link stops working and the new one opens", async () => {
    const row = ownerPage.locator("li").filter({ hasText: other.email });
    await row.getByRole("button", { name: "Invite again" }).click();
    await row.getByRole("button", { name: "Copy link" }).waitFor({ timeout: 20000 });
    await row.getByRole("button", { name: "Copy link" }).click();
    await row.getByRole("button", { name: "Copied" }).waitFor({ timeout: 15000 });
    const first = await ownerPage.evaluate(() => navigator.clipboard.readText());
    await row.getByRole("button", { name: "Send a new link" }).click();
    await ownerPage.waitForTimeout(2500);
    await row.getByRole("button", { name: "Copy link" }).click();
    await row.getByRole("button", { name: "Copied" }).waitFor({ timeout: 15000 });
    const second = await ownerPage.evaluate(() => navigator.clipboard.readText());
    expect(first !== second, "The link did not change.");
    await otherPage.goto(first, { waitUntil: "networkidle" });
    await otherPage.getByRole("heading", { name: "This invitation link is not valid" }).waitFor({ timeout: 20000 });
    await otherPage.goto(second, { waitUntil: "networkidle" });
    await otherPage.getByRole("button", { name: "Accept invitation" }).waitFor({ timeout: 20000 });
  });
  console.log("\nSigning out");
  await report.check("signing out leaves the workspace at once and the pages behind it stay closed", async () => {
    await staffPage.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    await staffPage.getByRole("button", { name: /Account menu/ }).click();
    await staffPage.getByRole("menuitem", { name: "Sign out" }).click();
    await settle(staffPage, () => location.pathname === "/login", "the sign-in page");
    expect(path(staffPage).includes("reason=signed_out"), `Landed on ${path(staffPage)}`);
    await staffPage.goBack({ waitUntil: "networkidle" }).catch(() => undefined);
    await staffPage.waitForTimeout(1500);
    expect((await staffPage.getByText(company).count()) === 0, "The workspace is still on screen after going back.");
    await staffPage.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
    expect(new URL(staffPage.url()).pathname === "/login", `Opened ${path(staffPage)} while signed out.`);
  });

  console.log("\nForgotten password");
  await report.check("asking for a reset gives the same neutral answer for an email with no account, and no code works", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/forgot-password`, { waitUntil: "networkidle" });
    await shot(page, "10-forgot");
    await page.getByLabel("Email").fill(`nobody-${run}+clerk_test@example.com`);
    await page.getByRole("button", { name: "Send reset code" }).click();
    await settle(page, () => location.pathname === "/reset-password", "the code screen");
    await page.getByText("If an account exists for this email").first().waitFor({ timeout: 15000 });
    await page.getByLabel("Reset code").fill(CODE);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText("That code is not valid or has expired").first().waitFor({ timeout: 15000 });
    expect((await page.getByLabel("New password").count()) === 0, "The new-password step opened without a valid code.");
    await ctx.close();
  });
  await report.check("the set-new-password page does nothing without a reset started in this browser", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/reset-password?email=${encodeURIComponent(owner.email)}&user_id=${owner.id}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Start your reset here" }).waitFor({ timeout: 15000 });
    expect((await page.getByLabel("New password").count()) === 0, "A password field was shown.");
    await ctx.close();
  });
  const newPassword = password("owner-new");
  const resetCtx = await context();
  const resetPage = await resetCtx.newPage();
  await report.check("a real reset: same neutral answer, a wrong code is refused, the right code allows a new password", async () => {
    expect((await activeSessions(owner.id)).length === 1, "The Owner should have one session before the reset.");
    await resetPage.goto(`${BASE}/forgot-password`, { waitUntil: "networkidle" });
    await resetPage.getByLabel("Email").fill(owner.email);
    await resetPage.getByRole("button", { name: "Send reset code" }).click();
    await settle(resetPage, () => location.pathname === "/reset-password", "the code screen");
    await resetPage.getByText("If an account exists for this email").first().waitFor({ timeout: 15000 });
    await shot(resetPage, "11-reset-code");
    await resetPage.getByLabel("Reset code").fill("000000");
    await resetPage.getByRole("button", { name: "Continue", exact: true }).click();
    await resetPage.getByText("That code is not valid or has expired").first().waitFor({ timeout: 15000 });
    await resetPage.getByLabel("Reset code").fill(CODE);
    await resetPage.getByRole("button", { name: "Continue", exact: true }).click();
    await resetPage.getByLabel("New password", { exact: true }).waitFor({ timeout: 20000 });
    await shot(resetPage, "12-reset-new-password");
  });
  await report.check("a password that breaks the rules is refused in words, and a mismatch is caught", async () => {
    await resetPage.getByLabel("New password", { exact: true }).fill("short");
    await resetPage.getByLabel("Confirm new password").fill("short");
    expect(await resetPage.getByRole("button", { name: "Update password" }).isDisabled(), "A too-short password could be sent.");
    await resetPage.getByLabel("New password", { exact: true }).fill(newPassword);
    await resetPage.getByLabel("Confirm new password").fill(`${newPassword}x`);
    await resetPage.getByLabel("New password", { exact: true }).focus();
    await resetPage.getByText("The two passwords are not the same.").waitFor({ timeout: 10000 });
  });
  await report.check("saving the new password signs this browser in and signs the other session out", async () => {
    await resetPage.getByLabel("Confirm new password").fill(newPassword);
    await resetPage.getByRole("button", { name: "Update password" }).click();
    await settle(resetPage, () => location.pathname === "/auth/password-updated", "the confirmation");
    await resetPage.getByText("Every other session on this account was signed out.").waitFor({ timeout: 15000 });
    await shot(resetPage, "13-password-updated");
    const sessions = await activeSessions(owner.id);
    expect(sessions.length === 1, `The Owner has ${sessions.length} active sessions after the reset.`);
    await resetPage.getByRole("button", { name: "Continue to my workspace" }).click();
    await settle(resetPage, () => location.pathname === "/app", "the workspace");
    await resetPage.getByText(company).first().waitFor({ timeout: 30000 });
    owner.password = newPassword;
  });
  await report.check("the browser that was signed in before the reset is signed out", async () => {
    // The old session is revoked at the sign-in service; the browser notices on its next token refresh.
    let closed = false;
    for (let attempt = 0; attempt < 16 && !closed; attempt += 1) {
      await ownerPage.waitForTimeout(5000);
      await ownerPage.goto(`${BASE}/app`, { waitUntil: "networkidle" }).catch(() => undefined);
      closed = new URL(ownerPage.url()).pathname === "/login";
    }
    expect(closed, "The earlier session could still open the workspace 80 seconds after the reset.");
  });
  await report.check("a finished reset cannot be replayed", async () => {
    await resetPage.goto(`${BASE}/reset-password`, { waitUntil: "networkidle" });
    await resetPage.getByRole("heading", { name: "Start your reset here" }).waitFor({ timeout: 15000 });
  });
  await report.check("the old password no longer signs in, and the new one does, from the keyboard alone", async () => {
    await ownerPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await ownerPage.getByLabel("Email").fill(owner.email);
    await ownerPage.getByLabel("Password", { exact: true }).fill(password("owner"));
    await ownerPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await notice(ownerPage).first().waitFor({ timeout: 20000 });
    expect((await notice(ownerPage).first().innerText()).includes(INVALID), "The old password was not refused.");
    await ownerPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    expect(await ownerPage.getByLabel("Email").evaluate((element) => element === document.activeElement), "The email field does not have focus when the page opens.");
    await ownerPage.keyboard.type(owner.email);
    await ownerPage.keyboard.press("Tab");
    await ownerPage.keyboard.press("Tab");
    expect(await ownerPage.getByLabel("Password", { exact: true }).evaluate((element) => element === document.activeElement), "Tab did not reach the password field after the forgot-password link.");
    await ownerPage.keyboard.type(owner.password);
    await ownerPage.keyboard.press("Enter");
    await settle(ownerPage, () => !location.pathname.startsWith("/login") || document.querySelector("h1")?.textContent === "Confirm it is you", "sign-in");
    if ((await heading(ownerPage)) === "Confirm it is you") {
      await ownerPage.keyboard.type(CODE);
      await ownerPage.keyboard.press("Enter");
    }
    await settle(ownerPage, () => location.pathname === "/app", "the workspace");
  });

  console.log("\nSecurity settings");
  const answerConfirm = async (page, current) => {
    const prompt = page.getByRole("form", { name: "Confirm your password" });
    if (await prompt.count()) {
      await prompt.getByLabel("Password", { exact: true }).fill(current);
      await prompt.getByRole("button", { name: "Confirm" }).click();
    }
  };
  await report.check("signing out other sessions ends them and says how many", async () => {
    expect((await activeSessions(owner.id)).length === 2, "Expected the Owner to have two sessions here.");
    await openSettings(resetPage);
    await resetPage.locator("#security").scrollIntoViewIfNeeded();
    await resetPage.getByRole("button", { name: "Sign out other sessions" }).click();
    await resetPage.getByText("1 other session was signed out.").waitFor({ timeout: 20000 });
    expect((await activeSessions(owner.id)).length === 1, "The other session is still active.");
    await shot(resetPage, "14-settings-security");
  });
  await report.check("changing the password needs the current one, and a wrong current password is refused", async () => {
    const section = resetPage.locator("#security");
    const next = password("owner-third");
    await section.getByLabel("Current password").fill("not-the-current-password");
    await section.getByLabel("New password", { exact: true }).fill(next);
    await section.getByLabel("Confirm new password").fill(next);
    await section.getByRole("button", { name: "Update password" }).click();
    await resetPage.waitForTimeout(1500);
    await answerConfirm(resetPage, owner.password);
    await section.getByText("The current password is not right.").waitFor({ timeout: 20000 });
    await section.getByLabel("Current password").fill(owner.password);
    await section.getByLabel("New password", { exact: true }).fill(next);
    await section.getByLabel("Confirm new password").fill(next);
    await section.getByRole("button", { name: "Update password" }).click();
    await resetPage.waitForTimeout(1500);
    await answerConfirm(resetPage, owner.password);
    await section.getByText(/Password updated\./).waitFor({ timeout: 20000 });
    owner.password = next;
  });
  await report.check("changing the email changes nothing until the code is entered, then it changes", async () => {
    const section = resetPage.locator("#security");
    const address = `sel-owner2-${run}+clerk_test@example.com`;
    await section.getByLabel("New email").fill(address);
    await section.getByRole("button", { name: "Send code" }).click();
    await resetPage.waitForTimeout(1500);
    await answerConfirm(resetPage, owner.password);
    await section.getByText("Waiting for confirmation").waitFor({ timeout: 20000 });
    await section.getByText(`You sign in as ${owner.email}`, { exact: false }).first().waitFor({ timeout: 10000 });
    await shot(resetPage, "15-settings-email-pending");
    await section.getByLabel("Code").fill("000000");
    await section.getByRole("button", { name: "Confirm new email" }).click();
    await section.getByText("That code is not right").waitFor({ timeout: 20000 });
    await section.getByLabel("Code").fill(CODE);
    await section.getByRole("button", { name: "Confirm new email" }).click();
    await resetPage.waitForTimeout(1500);
    await answerConfirm(resetPage, owner.password);
    await section.getByText(`Your sign-in email is now ${address}.`).waitFor({ timeout: 20000 });
    owner.email = address;
  });
  await report.check("an email that belongs to another account is refused", async () => {
    const section = resetPage.locator("#security");
    await section.getByLabel("New email").fill(staff.email);
    await section.getByRole("button", { name: "Send code" }).click();
    await resetPage.waitForTimeout(1500);
    await answerConfirm(resetPage, owner.password);
    await section.getByText("That email is already used by an account.").waitFor({ timeout: 20000 });
  });

  console.log("\nCreating an account");
  const signupCtx = await context();
  const signupPage = await signupCtx.newPage();
  const fresh = { email: `sel-new-${run}+clerk_test@example.com`, password: password("new"), name: "Nia New" };
  let signupOpen = false;
  await report.check("the form explains the password rules as the sign-in service has them", async () => {
    await signupPage.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    await signupPage.getByText(/At least \d+ characters/).first().waitFor({ timeout: 15000 });
    await shot(signupPage, "16-signup");
  });
  await report.check("an email that already has an account is told so, and no second account is made", async () => {
    await signupPage.getByLabel("Full name").fill("Sam Again");
    await signupPage.getByLabel("Work email").fill(staff.email);
    await signupPage.getByLabel("Password", { exact: true }).fill(fresh.password);
    await signupPage.getByLabel("Confirm password").fill(fresh.password);
    await signupPage.getByLabel(/I agree to Selestial/).check();
    await signupPage.getByRole("button", { name: "Create account" }).click();
    await signupPage.getByText("An account with this email already exists").first().waitFor({ timeout: 20000 });
  });
  await report.check("creating an account sends a code and does not claim to be signed in", async () => {
    await signupPage.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    await signupPage.getByLabel("Full name").fill(fresh.name);
    await signupPage.getByLabel("Work email").fill(fresh.email);
    await signupPage.getByLabel("Password", { exact: true }).fill(fresh.password);
    await signupPage.getByLabel("Confirm password").fill(fresh.password);
    expect(await signupPage.getByRole("button", { name: "Create account" }).isDisabled(), "An account could be created without agreeing to the Terms and Privacy Policy.");
    await signupPage.getByLabel(/I agree to Selestial/).check();
    await signupPage.getByRole("button", { name: "Create account" }).click();
    await settle(signupPage, () => location.pathname === "/auth/check-email" || Boolean(document.querySelector('form [role="alert"]')), "the sign-up to answer");
    if (new URL(signupPage.url()).pathname !== "/auth/check-email") {
      const said = await notice(signupPage).first().innerText();
      await shot(signupPage, "17-signup-blocked");
      throw new Error(`Sign-up did not reach the code screen. The form said: ${said}`);
    }
    signupOpen = true;
    await signupPage.getByText(fresh.email).first().waitFor({ timeout: 15000 });
    await signupPage.getByText("You are not signed in yet.", { exact: false }).first().waitFor({ timeout: 10000 });
    await shot(signupPage, "17-check-email");
    const response = await signupCtx.request.get(`${BASE}/app`, { maxRedirects: 0 });
    expect(response.status() === 307, "The workspace opened before the email was confirmed.");
  });
  if (signupOpen) {
    await report.check("a new code can be asked for once, then only after a wait", async () => {
      await signupPage.reload({ waitUntil: "networkidle" });
      await signupPage.getByRole("button", { name: "Send a new code", exact: true }).click();
      await signupPage.getByText("A new code is on its way").waitFor({ timeout: 15000 });
      expect(await signupPage.getByRole("button", { name: /Send a new code in \d+s/ }).isDisabled(), "The resend button was not held back.");
      await signupPage.reload({ waitUntil: "networkidle" });
      expect(await signupPage.getByRole("button", { name: /Send a new code in \d+s/ }).isDisabled(), "Reloading the page reset the wait.");
    });
    await report.check("a wrong code is refused, the right one confirms the email and opens workspace setup", async () => {
      await signupPage.getByLabel("Code").fill("000000");
      await signupPage.getByRole("button", { name: "Confirm email" }).click();
      await signupPage.getByText("That code is not right").waitFor({ timeout: 20000 });
      await signupPage.getByLabel("Code").fill(CODE);
      await signupPage.getByRole("button", { name: "Confirm email" }).click();
      await settle(signupPage, () => location.pathname === "/auth/verify", "the confirmation");
      await signupPage.getByRole("heading", { name: "Your email is confirmed" }).waitFor({ timeout: 15000 });
      await shot(signupPage, "18-verified");
      await signupPage.getByRole("button", { name: "Set up my workspace" }).click();
      await settle(signupPage, () => location.pathname === "/app", "workspace setup");
      await signupPage.getByRole("heading", { name: "Set up your company" }).waitFor({ timeout: 30000 });
    });
    await report.check("sending workspace setup twice makes one company", async () => {
      const name = `E2E New ${run}`;
      await signupPage.getByLabel(/I accept the/).check();
      await signupPage.getByLabel("Company name").fill(name);
      await signupPage.getByRole("button", { name: "Create company" }).dblclick();
      await signupPage.getByRole("button", { name: /Account menu/ }).waitFor({ timeout: 30000 });
      await signupPage.locator("button", { hasText: name }).first().click().catch(() => undefined);
      await signupPage.waitForTimeout(800);
      const listed = await signupPage.getByRole("option", { name }).count().catch(() => 0);
      expect(listed <= 1, `The new Owner has ${listed} companies with that name.`);
    });
    await report.check("a new person invited by email creates an account from the invitation and joins that company only", async () => {
      const invited = { email: `sel-hire-${run}+clerk_test@example.com`, password: password("hire"), name: "Hana Hire" };
      const link = await invite(resetPage, invited.name, invited.email, "manager");
      const ctx = await context();
      const page = await ctx.newPage();
      await page.goto(link, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Create an account" }).click();
      await settle(page, () => location.pathname === "/signup", "the sign-up page");
      expect(path(page).includes("next=%2Finvite%2F"), "The invitation was not kept through sign-up.");
      await page.getByLabel("Full name").fill(invited.name);
      await page.getByLabel("Work email").fill(invited.email);
      await page.getByLabel("Password", { exact: true }).fill(invited.password);
      await page.getByLabel("Confirm password").fill(invited.password);
      await page.getByLabel(/I agree to Selestial/).check();
      await page.getByRole("button", { name: "Create account" }).click();
      await settle(page, () => location.pathname === "/auth/check-email", "the code screen");
      expect(path(page).includes("next=%2Finvite%2F"), "The invitation was lost at the code screen.");
      await page.getByLabel("Code").fill(CODE);
      await page.getByRole("button", { name: "Confirm email" }).click();
      await settle(page, () => location.pathname === "/auth/verify", "the confirmation");
      await page.getByRole("button", { name: "Go to my invitation" }).click();
      await settle(page, () => location.pathname.startsWith("/invite/"), "the invitation");
      await page.getByRole("button", { name: "Accept invitation" }).click();
      await settle(page, () => location.pathname === "/app", "the workspace");
      await page.getByText(company).first().waitFor({ timeout: 30000 });
      expect((await page.getByRole("heading", { name: "Set up your company" }).count()) === 0, "The invited person was asked to create a company.");
      await ctx.close();
    });
  } else {
    for (const name of ["asking for a new code, with its wait", "confirming the email with the code", "one company from a setup sent twice (in the browser)", "a new person accepting an invitation by creating an account"]) {
      report.skip(name, "sign-up could not reach the code screen on this instance");
    }
  }

  console.log("\nPhone layout");
  await report.check("the sign-in screens fit a phone with no sideways scrolling", async () => {
    const ctx = await context({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    for (const [name, url] of [["login", "/login"], ["signup", "/signup"], ["forgot", "/forgot-password"]]) {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(!wide, `${url} scrolls sideways on a phone.`);
      await shot(page, `20-phone-${name}`);
    }
    await ctx.close();
  });
} catch (error) {
  console.log(`\nStopped early: ${String(error?.message ?? error).split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  const people = await fetchAllTestPeople().catch(() => []);
  for (const person of made) await removePerson(person.id);
  for (const id of people) await removePerson(id);
}

/** People this run made through the sign-up form, who are not in `made`. */
async function fetchAllTestPeople() {
  const { api } = await import("./auth-lib.mjs");
  const rows = await api("GET", `/users?limit=50&query=${encodeURIComponent(`-${run}+clerk_test`)}`);
  return (Array.isArray(rows) ? rows : []).map((row) => row.id);
}

const failed = report.done();
process.exit(failed > 0 || process.exitCode ? 1 : 0);
