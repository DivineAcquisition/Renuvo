/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { company, NOW, refusal, seedVisit, start, type T } from "../tests/harness";
import { ADMIN, REVIEWER, staffSetup } from "../tests/trustHarness";
import { api, internal } from "./_generated/api";
import { MAX_NOTIFY_ATTEMPTS, notifyBackoff, PER_EMAIL_PER_DAY, PER_VISITOR_PER_HOUR } from "./requests";
import { mockEmailOutbox } from "./lib/email/provider";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { SEED } from "./lib/trust/seed";

const secret = "test-form-secret";
const privacy = { secret, kind: "privacy" as const, subtype: "access", email: "Dana@Example.com", relationship: "customer_of_a_cleaning_company", businessName: "Alpha Cleaning", details: "Please send me what you hold about me.", visitorKey: "visitor-1" };
const vulnerability = { secret, kind: "vulnerability" as const, email: "researcher@example.org", affected: "The cleaner job page", details: "A step-by-step report.", visitorKey: "visitor-2" };
const review = { secret, kind: "security_review" as const, email: "buyer@bigclean.example", company: "Big Clean", role: "IT lead", questions: "Do you support SSO?", visitorKey: "visitor-3" };

async function flush(t: T) {
  for (let i = 0; i < 4; i += 1) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

const requests = (t: T) => t.run((ctx) => ctx.db.query("trustRequests").collect());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("PUBLIC_FORM_SECRET", secret);
  vi.stubEnv("STAFF_BOOTSTRAP_EMAIL", ADMIN.email);
  vi.stubEnv("EMAIL_PROVIDER", "mock");
  mockEmailOutbox.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("public requests", () => {
  it("is closed to anyone who is not the web server", async () => {
    const t = start();
    expect(await refusal(t.mutation(api.requests.submit, { ...privacy, secret: "wrong" }))).toBe(NOT_FOUND);
    expect(await requests(t)).toEqual([]);
  });

  it("saves the request first and then tells the verified inbox, with a short reference and none of the details", async () => {
    const { t } = await staffSetup(start());
    const answer = await t.mutation(api.requests.submit, privacy);
    expect(answer).toMatchObject({ status: "saved" });
    const reference = (answer as { reference: string }).reference;
    expect(reference).toMatch(/^SR-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    let [row] = await requests(t);
    expect(row).toMatchObject({ reference, kind: "privacy", subtype: "access", requester: { email: "dana@example.com", relationship: "customer_of_a_cleaning_company" }, status: "received", routing: "selestial", notify: { state: "pending", attempts: 0 } });
    expect(row._id).not.toContain(reference);
    await flush(t);
    [row] = await requests(t);
    expect(row.notify).toMatchObject({ state: "sent", attempts: 1 });
    expect(mockEmailOutbox).toHaveLength(1);
    expect(mockEmailOutbox[0].to).toBe(SEED.settings.contacts.privacy);
    expect(mockEmailOutbox[0].subject).toContain(reference);
    // The email says something arrived. What the person wrote stays in the record.
    for (const secretWord of ["Please send me", "dana@example.com", "Alpha Cleaning"]) expect(mockEmailOutbox[0].text).not.toContain(secretWord);
    // No IP address or device data is kept: the visitor key was only counted.
    expect(JSON.stringify(row)).not.toContain("visitor-1");
  });

  it("sends security reports to the security inbox", async () => {
    const { t } = await staffSetup(start());
    await t.mutation(api.requests.submit, vulnerability);
    await t.mutation(api.requests.submit, review);
    await flush(t);
    expect(mockEmailOutbox.map((row) => row.to)).toEqual([SEED.settings.contacts.security, SEED.settings.contacts.security]);
  });

  it("keeps the request when the email service throws, tries again with backoff, and marks the email failed after the last try", async () => {
    const { t, admin } = await staffSetup(start());
    await admin.mutation(api.trust.updateSettings, { contacts: { ...SEED.settings.contacts, security: "security@throw.test" }, note: "Test inbox." });
    const answer = await t.mutation(api.requests.submit, vulnerability);
    expect(answer.status).toBe("saved");
    for (let attempt = 1; attempt <= MAX_NOTIFY_ATTEMPTS; attempt += 1) {
      await flush(t);
      const [row] = await requests(t);
      expect(row.notify.attempts).toBe(attempt);
      expect(row.notify.state).toBe(attempt < MAX_NOTIFY_ATTEMPTS ? "pending" : "failed");
      if (attempt < MAX_NOTIFY_ATTEMPTS) vi.advanceTimersByTime(notifyBackoff(attempt));
    }
    expect(mockEmailOutbox.filter((row) => row.result === "threw")).toHaveLength(MAX_NOTIFY_ATTEMPTS);
    // The same idempotency key on every try, so a provider that did take one never sends two.
    expect(new Set(mockEmailOutbox.map((row) => row.idempotencyKey)).size).toBe(1);
    const [row] = await requests(t);
    expect(row).toMatchObject({ status: "received", details: vulnerability.details, notify: { state: "failed", problem: "The email service did not answer." } });
  });

  it("saves the request and says email is not set up when the inbox is not verified or email is not connected", async () => {
    const { t, admin } = await staffSetup(start());
    await admin.mutation(api.trust.updateSettings, { verified: { ...SEED.settings.verified, privacy: false }, note: "Not verified." });
    expect((await t.mutation(api.requests.submit, privacy)).status).toBe("saved");
    vi.stubEnv("EMAIL_PROVIDER", "");
    expect((await t.mutation(api.requests.submit, vulnerability)).status).toBe("saved");
    await flush(t);
    const rows = await requests(t);
    expect(rows.map((row) => row.notify.state)).toEqual(["not_configured", "not_configured"]);
    expect(rows[0].notify.problem).toBe("No verified inbox is set for this kind of request.");
    expect(rows[1].notify.problem).toBe("Email sending isn't set up yet, so the email wasn't sent.");
    expect(mockEmailOutbox).toEqual([]);
  });

  it("tells a bot it worked and saves nothing", async () => {
    const t = start();
    const answer = await t.mutation(api.requests.submit, { ...privacy, website: "https://spam.example" });
    expect(answer.status).toBe("saved");
    expect(await requests(t)).toEqual([]);
  });

  it("says which field is wrong", async () => {
    const t = start();
    const cases: [Record<string, unknown>, string][] = [
      [{ ...privacy, email: "not-an-email" }, "email"],
      [{ ...privacy, subtype: "everything" }, "subtype"],
      [{ ...privacy, subtype: undefined }, "subtype"],
      [{ ...privacy, relationship: undefined }, "relationship"],
      [{ ...privacy, relationship: "landlord" }, "relationship"],
      [{ ...privacy, businessName: " " }, "businessName"],
      [{ ...privacy, details: "" }, "details"],
      [{ ...privacy, details: "x".repeat(4001) }, "details"],
      [{ ...privacy, name: "x".repeat(121) }, "name"],
      [{ ...vulnerability, affected: "" }, "affected"],
      [{ ...vulnerability, affected: "x".repeat(501) }, "affected"],
      [{ ...review, company: "" }, "company"],
      [{ ...review, questions: "" }, "questions"],
    ];
    for (const [input, field] of cases) {
      const answer = await t.mutation(api.requests.submit, input as typeof privacy);
      expect(answer, field).toMatchObject({ status: "invalid", field });
    }
    // Exactly 4000 characters is allowed.
    expect((await t.mutation(api.requests.submit, { ...privacy, details: "x".repeat(4000) })).status).toBe("saved");
    // Someone who is not tied to a cleaning company does not have to name one.
    expect((await t.mutation(api.requests.submit, { ...privacy, relationship: "other", businessName: undefined, visitorKey: "v-9" })).status).toBe("saved");
  });

  it("takes a vulnerability report from anyone: no business name, no consent box", async () => {
    const t = start();
    expect((await t.mutation(api.requests.submit, vulnerability)).status).toBe("saved");
    const [row] = await requests(t);
    expect(row).toMatchObject({ kind: "vulnerability", affected: "The cleaner job page", requester: { relationship: "other" } });
    expect(row.businessName).toBeUndefined();
  });

  it("limits each visitor and each address", async () => {
    const t = start();
    for (let i = 0; i < PER_VISITOR_PER_HOUR; i += 1) expect((await t.mutation(api.requests.submit, { ...vulnerability, email: `r${i}@example.org` })).status).toBe("saved");
    expect(await t.mutation(api.requests.submit, { ...vulnerability, email: "another@example.org" })).toEqual({ status: "limited" });
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect((await t.mutation(api.requests.submit, { ...vulnerability, email: "another@example.org" })).status).toBe("saved");

    // The same address from many visitors.
    for (let i = 1; i < PER_EMAIL_PER_DAY; i += 1) expect((await t.mutation(api.requests.submit, { ...vulnerability, email: "Another@Example.org", visitorKey: `v-${i}` })).status).toBe("saved");
    expect(await t.mutation(api.requests.submit, { ...vulnerability, email: "another@example.org", visitorKey: "v-new" })).toEqual({ status: "limited" });
    // The limit table never holds the address.
    const limits = JSON.stringify(await t.run((ctx) => ctx.db.query("rateLimits").collect()));
    expect(limits).not.toContain("another@example.org");
  });

  it("never exports, erases or reveals anything because of a submission", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const visit = await seedVisit(as, companyId);
    await as.mutation(api.customers.update, { companyId, customerId: visit.customerId, email: "dana@example.com" });
    const before = await t.run(async (ctx) => ({ customer: await ctx.db.get(visit.customerId), cleaner: await ctx.db.get(visit.cleanerId) }));
    for (const subtype of ["access", "deletion", "correction"]) {
      const answer = await t.mutation(api.requests.submit, { ...privacy, subtype, visitorKey: `v-${subtype}` });
      expect(answer.status).toBe("saved");
      // The answer is the reference and nothing else: no records, no company, no match.
      expect(Object.keys(answer).sort()).toEqual(["reference", "status"]);
    }
    await flush(t);
    const after = await t.run(async (ctx) => ({
      customer: await ctx.db.get(visit.customerId),
      cleaner: await ctx.db.get(visit.cleanerId),
      exports: await ctx.db.query("dataExports").collect(),
      deletions: await ctx.db.query("deletionRecords").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(after.customer).toEqual(before.customer);
    expect(after.cleaner).toEqual(before.cleaner);
    expect(after.exports).toEqual([]);
    expect(after.deletions).toEqual([]);
    expect(after.scheduled.every((row) => row.name.startsWith("requests"))).toBe(true);
    // Each saved request is routed to Selestial, unverified, for a person to look at.
    for (const row of await requests(t)) expect(row).toMatchObject({ routing: "selestial", verification: {}, status: "received" });
  });
});

describe("the staff request queue", () => {
  it("is staff only: anyone else is told it does not exist", async () => {
    const { t, outsider } = await staffSetup(start());
    await t.mutation(api.requests.submit, privacy);
    const [row] = await requests(t);
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    for (const who of [outsider, as, t]) {
      expect(await refusal(who.query(api.requests.queue, {}))).toBe(NOT_FOUND);
      expect(await refusal(who.query(api.requests.get, { requestId: row._id }))).toBe(NOT_FOUND);
      expect(await refusal(who.mutation(api.requests.note, { requestId: row._id, text: "hi" }))).toBe(NOT_FOUND);
      expect(await refusal(who.mutation(api.requests.route, { requestId: row._id, routing: "business", companyId }))).toBe(NOT_FOUND);
    }
  });

  it("lets a reviewer work a request from start to finish, recording each step, but not change trust settings", async () => {
    const { t, admin, reviewer } = await staffSetup(start());
    const { companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await t.mutation(api.requests.submit, privacy);
    await t.mutation(api.requests.submit, vulnerability);
    const [row] = await requests(t);
    const requestId = row._id;

    expect((await reviewer.query(api.requests.queue, { kind: "privacy" })).map((item) => item.reference)).toEqual([row.reference]);
    expect(await reviewer.query(api.requests.queue, { kind: "vulnerability", status: "completed" })).toEqual([]);
    expect(await reviewer.query(api.requests.queue, {})).toHaveLength(2);

    const helper = (await admin.query(api.staff.list, {})).find((item) => item.email === REVIEWER.email)!;
    await reviewer.mutation(api.requests.assign, { requestId, staffId: helper.id });
    await reviewer.mutation(api.requests.setStatus, { requestId, status: "verifying", note: "Asked them to reply from the address." });
    await reviewer.mutation(api.requests.setDue, { requestId, dueOn: "2027-03-20" });
    expect(await refusal(reviewer.mutation(api.requests.setDue, { requestId, dueOn: "next week" }))).toContain("YYYY-MM-DD");
    await reviewer.mutation(api.requests.note, { requestId, text: "Customer of Alpha Cleaning." });
    // Completing an access request needs a recorded verification first.
    expect(await refusal(reviewer.mutation(api.requests.complete, { requestId, outcome: "Sent." }))).toContain("Record how the person was verified");
    await reviewer.mutation(api.requests.recordVerification, { requestId, method: "Replied from the address on the request." });
    expect((await reviewer.query(api.requests.findCompanies, { search: "alpha" })).map((item) => item.name)).toEqual(["Alpha Cleaning"]);
    await reviewer.mutation(api.requests.route, { requestId, routing: "business", companyId });
    expect(await refusal(reviewer.mutation(api.requests.setStatus, { requestId, status: "completed" }))).toContain("Use Complete");
    await reviewer.mutation(api.requests.complete, { requestId, outcome: "Passed to Alpha Cleaning, who hold the records." });

    const full = await reviewer.query(api.requests.get, { requestId });
    expect(full).toMatchObject({ status: "completed", routing: "business", companyId, companyName: "Alpha Cleaning", assignedTo: helper.id, dueOn: "2027-03-20", verification: { method: "Replied from the address on the request." } });
    expect(full.actions.map((item) => item.action)).toEqual(["received", "assigned", "status", "due", "note", "verified", "routed", "completed"]);
    expect(full.notes).toMatchObject([{ text: "Customer of Alpha Cleaning." }]);
    expect(full.names[helper.id]).toBe("Helper");

    // A reviewer works requests; only an admin changes what Selestial says in public.
    expect(await refusal(reviewer.mutation(api.trust.updateSettings, { governingPlace: "Elsewhere", note: "x" }))).toBe(NOT_ALLOWED);
  });

  it("closes with a limitation when the person cannot be verified", async () => {
    const { t, reviewer } = await staffSetup(start());
    await t.mutation(api.requests.submit, { ...privacy, subtype: "deletion" });
    const [row] = await requests(t);
    await reviewer.mutation(api.requests.complete, { requestId: row._id, outcome: "No reply to the verification email.", limitation: "Could not verify the requester." });
    expect((await reviewer.query(api.requests.get, { requestId: row._id }))).toMatchObject({ status: "closed_with_limitation", completion: { limitation: "Could not verify the requester." } });
    expect(await t.mutation(internal.requests.settleNotify, { requestId: row._id, attempt: 9, outcome: { kind: "sent" } })).toBeNull();
  });
});
