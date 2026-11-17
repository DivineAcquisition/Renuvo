/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv, flush, setup } from "../tests/dispatchHarness";
import { addMember, HOUR, NOW, refusal } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED } from "./lib/errors";
import { mockOutbox } from "./lib/messaging/provider";

const DAY = 24 * HOUR;

type S = Awaited<ReturnType<typeof setup>>;

async function requirementSet(s: S) {
  const c = (args: Parameters<typeof s.as.mutation<typeof api.requirements.create>>[1]) => s.as.mutation(api.requirements.create, args);
  const photoId = await c({ companyId: s.companyId, label: "Photo ID", kind: "document", appliesTo: ["contractor", "employee"], blocks: "assignments", needsReview: true, reviewBy: "manager", ownerOnly: false, validMonths: 12 });
  const policies = await c({ companyId: s.companyId, label: "Policies", kind: "acknowledgment", appliesTo: ["contractor", "employee"], blocks: "assignments", needsReview: false, reviewBy: "manager", ownerOnly: false, statement: "I will follow the job-day guide." });
  const taxForm = await c({ companyId: s.companyId, label: "Tax form", kind: "document", appliesTo: ["contractor", "employee"], blocks: "payment", needsReview: true, reviewBy: "owner", ownerOnly: true });
  return { photoId, policies, taxForm };
}

async function upload(s: S, bytes = "%PDF-1.4 test", type = "application/pdf") {
  return s.t.run(async (ctx) => ctx.storage.store(new Blob([bytes], { type })));
}

/** The newest portal link texted to a number, and the newest code. */
function texted(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const texts = mockOutbox.filter((row) => row.to.endsWith(digits) && row.result === "accepted").reverse();
  const link = texts.map((row) => row.body.match(/\/c\/portal\/([A-Za-z0-9_.-]+)/)?.[1]).find(Boolean) ?? null;
  const code = texts.map((row) => row.body.match(/code is (\d{6})/)?.[1]).find(Boolean) ?? null;
  return { link, code };
}

describe("onboarding requirements", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("keeps the Owner's policy with the Owner, and lets readiness and Dispatch block on the same requirement", async () => {
    const s = await setup(["Lena"]);
    const manager = await addMember(s.t, s.as, s.companyId, "manager-r", "manager");
    expect(await refusal(manager.mutation(api.requirements.create, { companyId: s.companyId, label: "X", kind: "custom", appliesTo: ["contractor"], blocks: "info", needsReview: true, reviewBy: "manager", ownerOnly: false }))).toBe(NOT_ALLOWED);
    const { photoId } = await requirementSet(s);
    const lena = s.cleaners.Lena;

    const row = async () => (await s.as.query(api.workforce.workspace, { companyId: s.companyId, asOf: Date.now() })).rows.find((item) => item.cleanerId === lena)!;
    // Active, with hours, areas and pay: still not ready while a requirement that blocks work is open.
    expect((await row()).readiness).toMatchObject({ state: "blocked", headline: "Needs Photo ID and Policies" });
    // The tax form blocks payment, not work, so it is not in the headline.
    expect((await row()).readiness.checks.find((check) => check.label === "Tax form")).toMatchObject({ state: "unmet", blocks: "payment" });

    // Dispatch reads the same blocker: an offer made earlier cannot be accepted.
    const jobId = await s.as.mutation(api.jobs.create, { companyId: s.companyId, customerId: s.place.customerId, propertyId: s.place.propertyId, serviceType: "standard", scope: "x", startsAt: Date.now() + 2 * DAY, endsAt: Date.now() + 2 * DAY + 2 * HOUR, priceCents: 16000 });
    void jobId;
    const fileId = await upload(s);
    await manager.mutation(api.requirements.attachFor, { companyId: s.companyId, cleanerId: lena, requirementId: photoId, storageId: fileId, fileName: "id.pdf", clientKey: "k-1" });
    // The same file sent twice is kept once.
    await manager.mutation(api.requirements.attachFor, { companyId: s.companyId, cleanerId: lena, requirementId: photoId, storageId: fileId, fileName: "id.pdf", clientKey: "k-1" });
    const items = await s.as.query(api.requirements.forWorker, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() });
    const photo = items.find((item) => item.label === "Photo ID")!;
    // An upload is not a verification.
    expect(photo).toMatchObject({ state: "awaiting_review", met: false });
    expect(photo.documents).toHaveLength(1);
    expect((await row()).readiness.state).toBe("blocked");
    const workspace = await s.as.query(api.workforce.workspace, { companyId: s.companyId, asOf: Date.now() });
    expect(workspace.attention.map((item) => item.kind)).toContain("review_waiting");

    expect(await refusal(manager.mutation(api.requirements.decide, { companyId: s.companyId, cleanerId: lena, requirementId: photoId, decision: "needs_changes" }))).toContain("Say what needs to change");
    await manager.mutation(api.requirements.decide, { companyId: s.companyId, cleanerId: lena, requirementId: photoId, decision: "needs_changes", feedback: "The photo is blurry." });
    expect((await s.as.query(api.requirements.forWorker, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() })).find((item) => item.label === "Photo ID")).toMatchObject({ state: "needs_changes", feedback: "The photo is blurry." });
    await manager.mutation(api.requirements.attachFor, { companyId: s.companyId, cleanerId: lena, requirementId: photoId, storageId: await upload(s, "%PDF clearer"), fileName: "id-2.pdf", clientKey: "k-2" });
    await manager.mutation(api.requirements.decide, { companyId: s.companyId, cleanerId: lena, requirementId: photoId, decision: "accept" });
    const accepted = (await s.as.query(api.requirements.forWorker, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() })).find((item) => item.label === "Photo ID")!;
    expect(accepted).toMatchObject({ state: "accepted", met: true });
    // Twelve months of validity, from the requirement.
    expect(accepted.expiresAt! - Date.now()).toBeGreaterThan(360 * DAY);
    expect((await row()).readiness.headline).toBe("Needs Policies");
  });

  it("never lets a person agree for the cleaner, and keeps owner-only files and decisions with the Owner", async () => {
    const s = await setup(["Lena"]);
    const manager = await addMember(s.t, s.as, s.companyId, "manager-o", "manager");
    const office = await addMember(s.t, s.as, s.companyId, "office-o", "office");
    const { policies, taxForm } = await requirementSet(s);
    const lena = s.cleaners.Lena;
    expect(await refusal(manager.mutation(api.requirements.decide, { companyId: s.companyId, cleanerId: lena, requirementId: policies, decision: "accept" }))).toContain("Only the cleaner can agree");
    expect(await refusal(manager.mutation(api.requirements.attachFor, { companyId: s.companyId, cleanerId: lena, requirementId: taxForm, storageId: await upload(s), fileName: "w9.pdf", clientKey: "t-1" }))).toBe(NOT_ALLOWED);
    await s.as.mutation(api.requirements.attachFor, { companyId: s.companyId, cleanerId: lena, requirementId: taxForm, storageId: await upload(s), fileName: "w9.pdf", clientKey: "t-1" });
    const asManager = (await manager.query(api.requirements.forWorker, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() })).find((item) => item.label === "Tax form")!;
    expect(asManager).toMatchObject({ state: "awaiting_review", documents: [], filesHidden: true, mayReview: false });
    expect(await refusal(manager.mutation(api.requirements.decide, { companyId: s.companyId, cleanerId: lena, requirementId: taxForm, decision: "accept" }))).toBe(NOT_ALLOWED);
    const asOwner = (await s.as.query(api.requirements.forWorker, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() })).find((item) => item.label === "Tax form")!;
    expect(await refusal(manager.query(api.requirements.documentUrl, { companyId: s.companyId, documentId: asOwner.documents[0].id }))).toBe(NOT_ALLOWED);
    expect(await refusal(office.query(api.requirements.documentUrl, { companyId: s.companyId, documentId: asOwner.documents[0].id }))).toBe(NOT_ALLOWED);
    expect((await s.as.query(api.requirements.documentUrl, { companyId: s.companyId, documentId: asOwner.documents[0].id })).fileName).toBe("w9.pdf");
    // Office sees where things stand, never the files or notes.
    const asOffice = (await office.query(api.requirements.forWorker, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() })).find((item) => item.label === "Tax form")!;
    expect(asOffice).toMatchObject({ state: "awaiting_review", documents: [], note: null, reviewedBy: null });

    // Setting a requirement aside needs a reason and is shown as set aside, never as accepted.
    expect(await refusal(s.as.mutation(api.requirements.waiveFor, { companyId: s.companyId, cleanerId: lena, requirementId: policies, reason: "" }))).toContain("Say why");
    await s.as.mutation(api.requirements.waiveFor, { companyId: s.companyId, cleanerId: lena, requirementId: policies, reason: "Signed the paper handbook in person." });
    const waived = (await s.as.query(api.requirements.forWorker, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() })).find((item) => item.label === "Policies")!;
    expect(waived).toMatchObject({ met: true, waived: { reason: "Signed the paper handbook in person." } });
    expect(waived.state).not.toBe("accepted");
  });

  it("reads expiry from the clock and warns before it", async () => {
    const s = await setup(["Lena"]);
    const { photoId } = await requirementSet(s);
    const lena = s.cleaners.Lena;
    await s.as.mutation(api.requirements.attachFor, { companyId: s.companyId, cleanerId: lena, requirementId: photoId, storageId: await upload(s), fileName: "id.pdf", clientKey: "e-1" });
    await s.as.mutation(api.requirements.decide, { companyId: s.companyId, cleanerId: lena, requirementId: photoId, decision: "accept", validUntil: Date.now() + 10 * DAY });
    const soon = await s.as.query(api.workforce.workspace, { companyId: s.companyId, asOf: Date.now() });
    expect(soon.attention.map((item) => item.kind)).toContain("document_expiring");
    const later = await s.as.query(api.requirements.forWorker, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() + 11 * DAY });
    expect(later.find((item) => item.label === "Photo ID")).toMatchObject({ state: "expired", met: false });
  });
});

describe("the cleaner portal", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("takes an invited cleaner through onboarding, and readiness follows the review", async () => {
    const s = await setup(["Lena"]);
    const { photoId, policies, taxForm } = await requirementSet(s);
    const lena = s.cleaners.Lena;
    const invited = await s.as.mutation(api.workforce.invitePortal, { companyId: s.companyId, cleanerId: lena });
    expect(invited.status).toBe("queued");
    await flush(s.t);
    const { link } = texted(s.phone.Lena);
    expect(link).toBeTruthy();
    const status = await s.as.query(api.workforce.portalStatus, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() });
    expect(status.invitation).toMatchObject({ state: "active", usedWords: "Has not confirmed a code yet" });
    expect(["Sent", "Delivered"]).toContain(status.invitation!.text!.words);

    // Opening the link shows a first name and the company, nothing else, and changes nothing.
    const before = await s.t.query(api.portal.link, { token: link! });
    expect(before).toEqual({ state: "active", company: "Alpha Cleaning", firstName: "Lena", phoneHint: expect.stringMatching(/10$/), canText: true, purpose: "portal" });
    expect(await refusal(s.t.query(api.portal.home, { session: "made-up", asOf: Date.now() }))).toContain("session has ended");

    await s.t.mutation(api.portal.sendCode, { token: link! });
    await flush(s.t);
    const { code } = texted(s.phone.Lena);
    expect(code).toMatch(/^\d{6}$/);
    // The code is never stored: no message body holds it.
    const stored = await s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).map((row) => row.body).join("\n"));
    expect(stored).not.toContain(code!);
    expect((await s.t.mutation(api.portal.verify, { token: link!, code: "000000" === code ? "111111" : "000000" })).status).toBe("wrong");
    const opened = await s.t.mutation(api.portal.verify, { token: link!, code: code! });
    expect(opened.status).toBe("ok");
    const session = opened.session!;

    let home = await s.t.query(api.portal.home, { session, asOf: Date.now() });
    expect(home.ready).toBe(false);
    expect(home.tasks.map((task) => [task.label, task.state])).toEqual([
      ["Photo ID", "not_started"],
      ["Policies", "not_started"],
      ["Tax form", "not_started"],
    ]);
    // The words shown must be the words agreed to.
    expect(await refusal(s.t.mutation(api.portal.acknowledgeTask, { session, requirementId: policies, statement: "Something else" }))).toContain("changed since the page was opened");
    await s.t.mutation(api.portal.acknowledgeTask, { session, requirementId: policies, statement: "I will follow the job-day guide." });
    const fileId = await upload(s);
    await s.t.mutation(api.portal.attachFile, { session, requirementId: photoId, storageId: fileId, fileName: "my-id.jpg", clientKey: "p-1" });
    home = await s.t.query(api.portal.home, { session, asOf: Date.now() });
    expect(home.tasks.find((task) => task.label === "Photo ID")).toMatchObject({ state: "awaiting_review", stateWords: "Sent, waiting for review" });
    expect(home.tasks.find((task) => task.label === "Policies")).toMatchObject({ state: "accepted" });
    // A file the portal cannot read is refused, not stored.
    expect(await refusal(s.t.mutation(api.portal.attachFile, { session, requirementId: taxForm, storageId: await upload(s, "MZ", "application/x-msdownload"), fileName: "x.exe", clientKey: "p-2" }))).toContain("PDF or a photo");

    // The office reviews; readiness updates.
    await s.as.mutation(api.requirements.decide, { companyId: s.companyId, cleanerId: lena, requirementId: photoId, decision: "accept" });
    home = await s.t.query(api.portal.home, { session, asOf: Date.now() });
    expect(home.ready).toBe(true);
    const row = (await s.as.query(api.workforce.workspace, { companyId: s.companyId, asOf: Date.now() })).rows.find((item) => item.cleanerId === lena)!;
    expect(row.readiness.state).toBe("ready");
    expect((await s.as.query(api.workforce.portalStatus, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() })).invitation!.usedWords).toMatch(/^Confirmed their code/);

    // Pay needs a fresh code; a session older than that sees no amounts.
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect((await s.t.query(api.portal.earnings, { session, asOf: Date.now() })).needsCode).toBe(true);
    await s.t.mutation(api.portal.sendStepUpCode, { session });
    await flush(s.t);
    expect((await s.t.mutation(api.portal.confirmStepUp, { session, code: texted(s.phone.Lena).code! })).status).toBe("ok");
    expect((await s.t.query(api.portal.earnings, { session, asOf: Date.now() })).needsCode).toBe(false);

    // Help goes to a person.
    await s.t.mutation(api.portal.askForHelp, { session, topic: "pay", text: "When is payday?" });
    expect((await s.as.query(api.workforce.workspace, { companyId: s.companyId, asOf: Date.now() })).attention.map((item) => item.kind)).toContain("help_requested");
  });

  it("closes old, expired and revoked links, and ending an engagement closes the portal", async () => {
    const s = await setup(["Lena"]);
    const lena = s.cleaners.Lena;
    await s.as.mutation(api.workforce.invitePortal, { companyId: s.companyId, cleanerId: lena });
    await flush(s.t);
    const first = texted(s.phone.Lena).link!;
    // A second invitation stops the first link.
    await s.as.mutation(api.workforce.invitePortal, { companyId: s.companyId, cleanerId: lena });
    await flush(s.t);
    const second = texted(s.phone.Lena).link!;
    expect(second).not.toBe(first);
    expect((await s.t.query(api.portal.link, { token: first })).state).toBe("revoked");
    expect(await refusal(s.t.mutation(api.portal.sendCode, { token: first }))).toContain("no longer active");
    expect((await s.t.query(api.portal.link, { token: `${second.split(".")[0]}.forged` })).state).toBe("unknown");

    await s.t.mutation(api.portal.sendCode, { token: second });
    await flush(s.t);
    const opened = await s.t.mutation(api.portal.verify, { token: second, code: texted(s.phone.Lena).code! });
    const session = opened.session!;
    // A used code cannot be used again.
    expect((await s.t.mutation(api.portal.verify, { token: second, code: texted(s.phone.Lena).code! })).status).toBe("no_code");

    // Ending the engagement closes the portal; history stays.
    await s.as.mutation(api.workforce.setStatus, { companyId: s.companyId, cleanerId: lena, status: "ended", reason: "Moved away" });
    expect(await refusal(s.t.query(api.portal.home, { session, asOf: Date.now() }))).toContain("session has ended");
    expect((await s.t.query(api.portal.link, { token: second })).state).toBe("revoked");

    // A link left unused runs out.
    const t2 = await setup(["Rosa"]);
    await t2.as.mutation(api.workforce.invitePortal, { companyId: t2.companyId, cleanerId: t2.cleaners.Rosa });
    await flush(t2.t);
    const stale = texted(t2.phone.Rosa).link!;
    vi.advanceTimersByTime(15 * DAY);
    expect((await t2.t.query(api.portal.link, { token: stale })).state).toBe("expired");
    expect(await refusal(t2.t.mutation(api.portal.sendCode, { token: stale }))).toContain("expired");
  });

  it("says plainly when the invitation cannot be texted, and the office can hand over the link", async () => {
    const s = await setup(["Lena"]);
    const lena = s.cleaners.Lena;
    // No permission for work texts: the one send gate refuses, and the invitation says so.
    await s.t.run(async (ctx) => {
      for (const row of await ctx.db.query("contactPermissions").collect()) await ctx.db.delete(row._id);
    });
    const invited = await s.as.mutation(api.workforce.invitePortal, { companyId: s.companyId, cleanerId: lena });
    expect(invited.status).toBe("not_sent");
    expect(invited.problem).toContain("permission");
    const status = await s.as.query(api.workforce.portalStatus, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() });
    expect(status.invitation!.text).toMatchObject({ words: "Not sent" });
    const url = await s.as.mutation(api.workforce.portalLink, { companyId: s.companyId, cleanerId: lena });
    expect(url).toMatch(/\/c\/portal\//);
    // The code cannot be texted either, and the page says so instead of pretending.
    const token = url.split("/c/portal/")[1];
    const sent = await s.t.mutation(api.portal.sendCode, { token });
    expect(sent.status).toBe("not_sent");
  });
});

describe("onboarding reminders", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("proposes first, sends once, stops for a help request, and never treats silence as a no", async () => {
    const s = await setup(["Lena"]);
    await requirementSet(s);
    const lena = s.cleaners.Lena;
    await s.as.mutation(api.workforce.invitePortal, { companyId: s.companyId, cleanerId: lena });
    await flush(s.t);
    // Inside Recruiter's sending hours (Tuesday mid-morning in Chicago), two days after the invitation.
    vi.setSystemTime(NOW + 2 * DAY + 4 * HOUR);
    await s.t.mutation(internal.workforce.reminders, {});
    const proposals = (await s.as.query(api.approvals.list, { companyId: s.companyId })).filter((row) => row.proposal?.kind === "send_onboarding_reminder");
    expect(proposals).toHaveLength(1);
    // The sweep again proposes nothing new for the same reminder.
    await s.t.mutation(internal.workforce.reminders, {});
    expect((await s.as.query(api.approvals.list, { companyId: s.companyId })).filter((row) => row.proposal?.kind === "send_onboarding_reminder")).toHaveLength(1);
    const before = mockOutbox.length;
    const decided = await s.as.mutation(api.approvals.decide, { companyId: s.companyId, approvalId: proposals[0]._id, decision: "approved" });
    await flush(s.t);
    expect(decided).toMatchObject({ carriedOut: { ok: true } });
    expect(mockOutbox.length).toBe(before + 1);
    expect(mockOutbox[mockOutbox.length - 1].body).toContain("Photo ID");

    // With Execute, the next one goes by itself when due, and only once.
    await s.allow("recruiter.onboarding_reminder", "execute");
    vi.setSystemTime(NOW + 7 * DAY + 6 * HOUR);
    await s.t.mutation(internal.workforce.reminders, {});
    await s.t.mutation(internal.workforce.reminders, {});
    await flush(s.t);
    expect(mockOutbox.length).toBe(before + 2);
    // The company allows two; there is no third, and nothing is decided about the person.
    vi.setSystemTime(NOW + 20 * DAY + 4 * HOUR);
    await s.t.mutation(internal.workforce.reminders, {});
    await flush(s.t);
    expect(mockOutbox.length).toBe(before + 2);
    const status = await s.as.query(api.workforce.reminderStatus, { companyId: s.companyId, cleanerId: lena, asOf: Date.now() });
    expect(status.sent).toHaveLength(2);
    const worker = (await s.as.query(api.workforce.workspace, { companyId: s.companyId, asOf: Date.now() })).rows.find((row) => row.cleanerId === lena)!;
    expect(worker.status).toBe("ready");
  });

  it("holds reminders while the cleaner's help request is open", async () => {
    const s = await setup(["Lena"]);
    await requirementSet(s);
    const lena = s.cleaners.Lena;
    await s.allow("recruiter.onboarding_reminder", "execute");
    await s.as.mutation(api.workforce.invitePortal, { companyId: s.companyId, cleanerId: lena });
    await flush(s.t);
    const link = texted(s.phone.Lena).link!;
    await s.t.mutation(api.portal.sendCode, { token: link });
    await flush(s.t);
    const { session } = await s.t.mutation(api.portal.verify, { token: link, code: texted(s.phone.Lena).code! });
    await s.t.mutation(api.portal.askForHelp, { session: session!, topic: "onboarding", text: "Which ID do you need?" });
    expect(await refusal(s.as.mutation(api.workforce.remindNow, { companyId: s.companyId, cleanerId: lena }))).toContain("asked the office for help");
    const count = mockOutbox.length;
    vi.setSystemTime(NOW + 3 * DAY + 4 * HOUR);
    await s.t.mutation(internal.workforce.reminders, {});
    await flush(s.t);
    expect(mockOutbox.length).toBe(count);
    const [help] = await s.as.query(api.workforce.helpRequests, { companyId: s.companyId, asOf: Date.now() });
    await s.as.mutation(api.workforce.answerHelp, { companyId: s.companyId, helpRequestId: help.id });
    await s.t.mutation(internal.workforce.reminders, {});
    await flush(s.t);
    expect(mockOutbox.length).toBe(count + 1);
  });
});

export type { Id };
