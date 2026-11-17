/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, HOUR, NOW, readyMessaging, refusal, start, withLinkSecret, workTextsAllowed, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mockOutbox } from "./lib/messaging/provider";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";

const DAY = 24 * HOUR;
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const tokenOf = (url: string) => url.split("/c/portal/")[1];

async function setup(phone = "+15125550101") {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const { cleanerId } = await as.mutation(api.workforce.add, { companyId, person: { name: "Rosa Diaz", engagement: "contractor", phone, email: "rosa@example.com", serviceAreas: ["78701"] } });
  return { t, as, companyId, cleanerId };
}

async function portalFor(s: Awaited<ReturnType<typeof setup>>) {
  const { linkId } = (await s.as.mutation(api.portalAccess.invite, { companyId: s.companyId, cleanerId: s.cleanerId })) as { linkId: Id<"portalLinks"> };
  const { url } = await s.as.mutation(api.portalAccess.reveal, { companyId: s.companyId, linkId });
  return { linkId, token: tokenOf(url) };
}

async function file(t: T, type = "application/pdf") {
  return t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 test"], { type })));
}

describe("onboarding requirements", () => {
  it("lets only the Owner change the template, and a new requirement holds up only the people it is given to", async () => {
    const s = await setup();
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    const input = { label: "Floor machine training", kind: "training" as const, effect: "blocks_assignments" as const, appliesTo: ["contractor" as const], reviewer: "manager" as const, cleanerCompletes: false, forServices: ["commercial"] };
    expect(await refusal(manager.mutation(api.requirements.saveDefinition, { companyId: s.companyId, ...input }))).toBe(NOT_ALLOWED);
    const key = await s.as.mutation(api.requirements.saveDefinition, { companyId: s.companyId, ...input });
    const template = await s.as.query(api.requirements.template, { companyId: s.companyId });
    expect(template.saved).toBe(true);
    expect(template.definitions.find((def) => def.key === key)).toMatchObject({ label: "Floor machine training", assignedTo: 0, forServices: ["commercial"] });
    // Rosa was added before it existed: nothing about her changed until it is applied to her on purpose.
    const before = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: NOW });
    expect(before.notAssigned.map((row) => row.key)).toEqual([key]);
    await s.as.mutation(api.workforce.applyTemplateTo, { companyId: s.companyId, cleanerIds: [s.cleanerId], keys: [key] });
    const after = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: NOW });
    // It is for commercial work only, so it is reported apart and holds up no other job.
    expect(after.readiness.serviceBlockers.map((row) => row.key)).toEqual([key]);
    expect(after.readiness.blockers.map((row) => row.key)).not.toContain(key);
    await s.as.mutation(api.requirements.retireDefinition, { companyId: s.companyId, key });
    expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: NOW })).readiness.serviceBlockers).toEqual([]);
  });

  it("is reviewed only by the role the template names, and never by a submission alone", async () => {
    const s = await setup();
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    const storageId = await file(s.t);
    await manager.mutation(api.requirements.submitFor, { companyId: s.companyId, cleanerId: s.cleanerId, key: "documents", storageIds: [storageId] });
    let profile = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: NOW });
    expect(profile.requirements.find((row) => row.key === "documents")).toMatchObject({ state: "awaiting_review", met: false, filesCount: 1 });
    // Office sees the state and the count of files, never the files.
    const seen = await office.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: NOW });
    expect(seen.requirements.find((row) => row.key === "documents")).toMatchObject({ files: null, filesCount: 1, mayReview: false });
    expect(await refusal(office.query(api.requirements.fileUrl, { companyId: s.companyId, cleanerId: s.cleanerId, key: "documents", index: 0 }))).toBe(NOT_ALLOWED);
    expect(await refusal(office.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key: "documents", decision: "accept" }))).toBe(NOT_ALLOWED);
    // The tax form is the Owner's to review.
    expect(await refusal(manager.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key: "tax_form", decision: "waive", note: "x" }))).toBe(NOT_ALLOWED);
    expect(await refusal(manager.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key: "documents", decision: "needs_changes" }))).toContain("Say what needs to change");
    await manager.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key: "documents", decision: "needs_changes", note: "The photo is blurry. Please send a clearer one." });
    profile = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: NOW });
    expect(profile.requirements.find((row) => row.key === "documents")).toMatchObject({ state: "needs_changes", reviewNote: "The photo is blurry. Please send a clearer one." });
    // A paper agreement is accepted by its reviewer, with a note saying how it was signed.
    expect(await refusal(s.as.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key: "agreement", decision: "accept" }))).toContain("Say how it was signed");
    // Weekly hours are read from the record, never ticked.
    expect(await refusal(s.as.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key: "availability", decision: "accept" }))).toContain("read from their record");
  });

  it("expires an accepted requirement on its date, and readiness follows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const s = await setup();
      for (const key of ["contact", "documents", "policies"]) await s.as.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key, decision: "accept", ...(key === "documents" ? { expiresAt: NOW + 3 * DAY } : {}) });
      await s.as.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key: "agreement", decision: "accept", note: "Signed on paper, kept in the office file." });
      await s.as.mutation(api.availability.setWeek, { companyId: s.companyId, cleanerId: s.cleanerId, windows: [{ weekday: 2, startMinute: 480, endMinute: 1020 }] });
      await s.as.mutation(api.cleanerProfile.setEngagementStatus, { companyId: s.companyId, cleanerId: s.cleanerId, status: "ready" });
      expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: NOW })).readiness.eligible).toBe(true);
      vi.setSystemTime(NOW + 4 * DAY);
      expect(await s.t.mutation(internal.requirements.expireDue, {})).toBe(1);
      const profile = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: NOW + 4 * DAY });
      expect(profile.readiness).toMatchObject({ state: "blocked", eligible: false });
      expect(profile.attention.map((item) => item.title)).toContain("Identity documents: expired");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the cleaner portal", () => {
  beforeEach(() => {
    process.env.MESSAGING_PROVIDER = "mock";
  });
  afterEach(() => {
    delete process.env.MESSAGING_PROVIDER;
  });

  it("takes an invited cleaner through onboarding, the owner reviews, and readiness updates", async () => {
    await withLinkSecret(async () => {
      const s = await setup();
      await readyMessaging(s.t, s.companyId);
      // Without a recorded permission the invitation is not sent, and the office is told why; the link still works to share by hand.
      const first = await s.as.mutation(api.portalAccess.invite, { companyId: s.companyId, cleanerId: s.cleanerId });
      expect(first).toMatchObject({ status: "not_sent" });
      expect(first.words).toContain("no recorded permission");
      await workTextsAllowed(s.as, s.companyId, s.cleanerId);
      vi.useFakeTimers();
      try {
        // A second invitation replaces the first link.
        const second = (await s.as.mutation(api.portalAccess.invite, { companyId: s.companyId, cleanerId: s.cleanerId })) as { status: string; linkId: Id<"portalLinks"> };
        expect(second.status).toBe("sent");
        await settle(s.t);
        const access = await s.as.query(api.portalAccess.access, { companyId: s.companyId, cleanerId: s.cleanerId });
        expect(access.links.filter((link) => link.state === "active")).toHaveLength(1);
        expect(access.messages[0]).toMatchObject({ what: "Portal invitation", status: "delivered" });
        // The text carried a real link; the stored message never holds the token.
        const text = mockOutbox.filter((row) => row.to === "+15125550101").at(-1)!.body;
        const token = tokenOf(text.slice(text.indexOf("http")));
        expect((await s.t.run((ctx) => ctx.db.get(access.messages[0].messageId)))!.body).toContain("{link}");

        // Opening the portal changes nothing.
        const view = await s.t.query(api.portal.view, { token, asOf: Date.now() });
        expect(view).toMatchObject({ state: "active", firstName: "Rosa", engagement: "onboarding" });
        expect((await s.t.run((ctx) => ctx.db.get(second.linkId)))!.lastActionAt).toBeUndefined();

        // The cleaner does their part.
        expect(await s.t.mutation(api.portal.confirmContact, { token, phone: "+1 512 555 0101", email: "rosa@example.com", workTexts: true })).toEqual({ status: "accepted" });
        await s.t.mutation(api.portal.acknowledge, { token, key: "policies", words: "Read and acknowledge how the company works." });
        await s.t.mutation(api.portal.setAvailability, { token, windows: [{ weekday: 2, startMinute: 480, endMinute: 1020 }] });
        const upload = await file(s.t, "image/jpeg");
        expect(await s.t.mutation(api.portal.submitRequirement, { token, key: "documents", storageIds: [upload] })).toEqual({ status: "awaiting_review" });
        expect(await refusal(s.t.mutation(api.portal.submitRequirement, { token, key: "agreement", storageIds: [] }))).toBe("The office records this step.");
        const bad = await s.t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "application/zip" })));
        expect(await refusal(s.t.mutation(api.portal.submitRequirement, { token, key: "tax_form", storageIds: [bad] }))).toContain("PDF or a photo");

        // Nothing they uploaded counts until a person reviews it.
        let profile = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() });
        expect(profile.readiness.blockers.map((row) => row.key)).toEqual(["agreement", "documents"]);
        expect(profile.attention.find((item) => item.kind === "review_waiting")?.title).toBe("1 item to review");
        await s.as.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key: "documents", decision: "accept" });
        await s.as.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key: "agreement", decision: "accept", note: "Signed on paper." });
        profile = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() });
        expect(profile.readiness).toMatchObject({ state: "onboarding", blockers: [] });
        await s.as.mutation(api.cleanerProfile.setEngagementStatus, { companyId: s.companyId, cleanerId: s.cleanerId, status: "ready" });
        profile = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() });
        expect(profile.readiness).toMatchObject({ state: "ready", eligible: true, payoutReady: false });

        // An agreement is to exact words. When the Owner changes the policies, Rosa is asked again, and the old words cannot be agreed to.
        await s.as.mutation(api.requirements.saveDefinition, { companyId: s.companyId, key: "policies", label: "Company policies", description: "Read and acknowledge how the company works, including the new key-handling policy.", kind: "acknowledgment", effect: "blocks_assignments", appliesTo: ["employee", "contractor", "subcontractor"], reviewer: "manager", cleanerCompletes: true });
        profile = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() });
        expect(profile.readiness.blockers.map((row) => row.key)).toEqual(["policies"]);
        expect(await refusal(s.t.mutation(api.portal.acknowledge, { token, key: "policies", words: "Read and acknowledge how the company works." }))).toContain("changed since this page opened");
        await s.t.mutation(api.portal.acknowledge, { token, key: "policies", words: "Read and acknowledge how the company works, including the new key-handling policy." });
        profile = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() });
        expect(profile.readiness).toMatchObject({ state: "ready", blockers: [] });
        // Renaming the step leaves the words alone, so nothing is asked again.
        const policies = (words: string, label = "Company policies") => s.as.mutation(api.requirements.saveDefinition, { companyId: s.companyId, key: "policies", label, description: words, kind: "acknowledgment", effect: "blocks_assignments", appliesTo: ["employee", "contractor", "subcontractor"], reviewer: "manager", cleanerCompletes: true });
        vi.setSystemTime(Date.now() + HOUR);
        await policies("Read and acknowledge how the company works, including the new key-handling policy.", "House rules");
        expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() })).readiness.blockers).toEqual([]);
        // An agreement made before the words were stored with it still counts until the words change, then is asked again.
        await s.t.run(async (ctx) => {
          const row = (await ctx.db.query("workerRequirements").withIndex("by_company_cleaner", (q) => q.eq("companyId", s.companyId).eq("cleanerId", s.cleanerId).eq("key", "policies")).unique())!;
          await ctx.db.patch(row._id, { acknowledged: undefined });
        });
        expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() })).readiness.blockers).toEqual([]);
        vi.setSystemTime(Date.now() + HOUR);
        await policies("Read and acknowledge how the company works. Keys are returned the same day.");
        expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() })).readiness.blockers.map((row) => row.key)).toEqual(["policies"]);
        await s.t.mutation(api.portal.acknowledge, { token, key: "policies", words: "Read and acknowledge how the company works. Keys are returned the same day." });
        expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() })).readiness).toMatchObject({ state: "ready", blockers: [] });
        // Each act is in their history, as theirs.
        const history = await s.as.query(api.cleanerProfile.activity, { companyId: s.companyId, cleanerId: s.cleanerId });
        expect(history.filter((row) => row.whoKind === "cleaner").map((row) => row.text)).toEqual(expect.arrayContaining(["submitted Identity documents", "had their weekly availability set (1 window)"]));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("refuses an expired, revoked, wrong or out-of-scope link, and nothing changes through an ended engagement", async () => {
    await withLinkSecret(async () => {
      const s = await setup();
      const { linkId, token } = await portalFor(s);
      expect(await refusal(s.t.query(api.portal.view, { token: `${token.slice(0, -2)}xx`, asOf: Date.now() }))).toBe(NOT_FOUND);
      expect(await refusal(s.t.query(api.portal.view, { token: "nonsense", asOf: Date.now() }))).toBe(NOT_FOUND);
      await s.as.mutation(api.portalAccess.revoke, { companyId: s.companyId, linkId });
      expect(await s.t.query(api.portal.view, { token, asOf: Date.now() })).toEqual({ state: "revoked", company: "Alpha Cleaning" });
      expect(await refusal(s.t.mutation(api.portal.confirmAvailability, { token }))).toBe("This link is no longer active.");

      const fresh = await portalFor(s);
      await s.t.run((ctx) => ctx.db.patch(fresh.linkId, { expiresAt: Date.now() - 1 }));
      expect(await s.t.query(api.portal.view, { token: fresh.token, asOf: Date.now() })).toMatchObject({ state: "expired" });
      expect(await refusal(s.t.mutation(api.portal.confirmAvailability, { token: fresh.token }))).toContain("expired");

      // A link for one onboarding step opens that step only.
      const task = await s.t.run(async (ctx) => {
        const { issuePortalLink, portalTokenFor } = await import("./lib/cleaners/portal");
        const link = await issuePortalLink(ctx, { companyId: s.companyId, holder: { cleanerId: s.cleanerId }, purpose: "task", requirementKey: "documents", expiresAt: Date.now() + DAY, issuedBy: { kind: "system" }, actor: { kind: "system" } });
        return portalTokenFor(link!);
      });
      expect(await refusal(s.t.mutation(api.portal.acknowledge, { token: task!, key: "policies", words: "Read and acknowledge how the company works." }))).toBe("This link is for a different step.");
      expect(await refusal(s.t.mutation(api.portal.claimSkill, { token: task!, skill: "windows" }))).toBe(NOT_ALLOWED);

      // Ending the engagement ends portal access (the company's default), and the record is kept.
      const live = await portalFor(s);
      const requestId = await s.as.mutation(api.personnel.request, { companyId: s.companyId, kind: "end_engagement", cleanerId: s.cleanerId, reason: "Moved away." });
      await s.as.mutation(api.personnel.decide, { companyId: s.companyId, requestId, decision: "approved" });
      expect(await s.t.query(api.portal.view, { token: live.token, asOf: Date.now() })).toMatchObject({ state: "revoked" });
      expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() })).status).toBe("ended");
    });
  });

  it("answers a second invitation within minutes with the first, and says plainly when a text failed", async () => {
    await withLinkSecret(async () => {
      // 0001 is a number the mock carrier can never deliver to.
      const s = await setup("+15125550001");
      await readyMessaging(s.t, s.companyId);
      await workTextsAllowed(s.as, s.companyId, s.cleanerId);
      vi.useFakeTimers();
      try {
        const first = await s.as.mutation(api.portalAccess.invite, { companyId: s.companyId, cleanerId: s.cleanerId });
        expect(first.status).toBe("sent");
        await settle(s.t);
        let access = await s.as.query(api.portalAccess.access, { companyId: s.companyId, cleanerId: s.cleanerId });
        expect(access.messages[0]).toMatchObject({ status: "failed", words: "not delivered" });
        expect(access.messages[0].problem).toContain("cannot receive texts");
        // A failed text is not an invitation on its way, so inviting again makes a new one.
        const again = await s.as.mutation(api.portalAccess.invite, { companyId: s.companyId, cleanerId: s.cleanerId, channel: "sms" });
        expect(again.status).toBe("sent");
        access = await s.as.query(api.portalAccess.access, { companyId: s.companyId, cleanerId: s.cleanerId });
        expect(access.links.filter((link) => link.state === "active")).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
      const ok = await setup("+15125550109");
      await readyMessaging(ok.t, ok.companyId);
      await workTextsAllowed(ok.as, ok.companyId, ok.cleanerId);
      expect((await ok.as.mutation(api.portalAccess.invite, { companyId: ok.companyId, cleanerId: ok.cleanerId })).status).toBe("sent");
      const repeat = await ok.as.mutation(api.portalAccess.invite, { companyId: ok.companyId, cleanerId: ok.cleanerId });
      expect(repeat.status).toBe("already");
      expect((await ok.t.run((ctx) => ctx.db.query("messages").collect())).filter((row) => row.purpose === "portal_invitation")).toHaveLength(1);
    });
  });

  it("unlocks pay only with a one-time code that is never stored", async () => {
    await withLinkSecret(async () => {
      const s = await setup("+15125550120");
      await readyMessaging(s.t, s.companyId);
      await workTextsAllowed(s.as, s.companyId, s.cleanerId);
      await s.as.mutation(api.cleaners.setPay, { companyId: s.companyId, cleanerId: s.cleanerId, pay: { kind: "share", shareBps: 4500 } });
      const { token } = await portalFor(s);
      expect(await s.t.query(api.portal.earnings, { token, asOf: Date.now() })).toEqual({ locked: true });
      vi.useFakeTimers();
      try {
        const sent = await s.t.mutation(api.portal.requestCode, { token });
        expect(sent.sentTo).toBe("•••0120");
        await settle(s.t);
        const text = mockOutbox.filter((row) => row.to === "+15125550120").at(-1)!.body;
        const code = /\b(\d{6})\b/.exec(text)![1];
        const stored = await s.t.run((ctx) => ctx.db.query("messages").collect());
        expect(stored.find((row) => row.purpose === "verification_code")!.body).toContain("{code}");
        expect(JSON.stringify(stored)).not.toContain(code);
        expect(await refusal(s.t.mutation(api.portal.verifyCode, { token, code: code === "000000" ? "111111" : "000000" }))).toContain("not right");
        await s.t.mutation(api.portal.verifyCode, { token, code });
        expect(await s.t.query(api.portal.earnings, { token, asOf: Date.now() })).toMatchObject({ locked: false, arrangement: "45% of each job's price" });
        // A code works once.
        expect(await refusal(s.t.mutation(api.portal.verifyCode, { token, code }))).toContain("expired");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("routine onboarding reminders", () => {
  beforeEach(() => {
    process.env.MESSAGING_PROVIDER = "mock";
  });
  afterEach(() => {
    delete process.env.MESSAGING_PROVIDER;
  });

  it("asks a person first, sends once approved, never duplicates, and hands over after the limit without any consequence", async () => {
    await withLinkSecret(async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      try {
        const s = await setup("+15125550130");
        await readyMessaging(s.t, s.companyId);
        await workTextsAllowed(s.as, s.companyId, s.cleanerId);
        // Not before a day has passed since they were added.
        await s.t.mutation(internal.cleanerFollowUps.sweep, {});
        let rows = await s.as.query(api.cleanerFollowUps.forCleaner, { companyId: s.companyId, cleanerId: s.cleanerId });
        expect(rows).toMatchObject([{ status: "scheduled", agent: "Recruiter" }]);
        expect(rows[0].summary).toContain("contact details");
        vi.setSystemTime(NOW + DAY + HOUR);
        await s.t.mutation(internal.cleanerFollowUps.sweep, {});
        await s.t.mutation(internal.cleanerFollowUps.sweep, {});
        rows = await s.as.query(api.cleanerFollowUps.forCleaner, { companyId: s.companyId, cleanerId: s.cleanerId });
        // Every company starts on review: the reminder waits in Approvals, once.
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: "awaiting_approval" });
        const approvals = await s.as.query(api.approvals.list, { companyId: s.companyId });
        expect(approvals.filter((row) => row.action === "recruiter.onboarding_reminder")).toHaveLength(1);
        const decided = await s.as.mutation(api.approvals.decide, { companyId: s.companyId, approvalId: approvals[0]._id, decision: "approved" });
        expect(decided.carriedOut).toMatchObject({ ok: true });
        await settle(s.t);
        rows = await s.as.query(api.cleanerFollowUps.forCleaner, { companyId: s.companyId, cleanerId: s.cleanerId });
        expect(rows[0]).toMatchObject({ status: "sent", attempt: 1, message: { status: "delivered" } });
        // Another routine message within the window waits, whoever would send it.
        expect(await s.as.mutation(api.cleanerFollowUps.sendNow, { companyId: s.companyId, cleanerId: s.cleanerId, topic: "onboarding" })).toMatchObject({ detail: "Another message went to them recently; this one waits." });

        // Loosen to Execute and let the limit run out without a reply.
        await s.as.mutation(api.permissions.set, { companyId: s.companyId, action: "recruiter.onboarding_reminder", level: "execute" });
        for (let i = 0; i < 4; i += 1) {
          vi.setSystemTime(Date.now() + 49 * HOUR);
          await s.t.mutation(internal.cleanerFollowUps.sweep, {});
          await settle(s.t);
        }
        rows = await s.as.query(api.cleanerFollowUps.forCleaner, { companyId: s.companyId, cleanerId: s.cleanerId });
        expect(rows[0]).toMatchObject({ status: "stopped", attempt: 3 });
        expect(rows[0].stopReason).toContain("A person was asked to reach out");
        const tasks = await s.as.query(api.tasks.list, { companyId: s.companyId, status: "needs_decision" });
        expect(tasks.some((task) => task.title === "Check in with Rosa Diaz yourself")).toBe(true);
        // Silence changed nothing about them.
        expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleanerId, asOf: Date.now() })).status).toBe("onboarding");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("checks again as the message goes: what was done, or a paused engagement, stops it", async () => {
    await withLinkSecret(async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      try {
        const s = await setup("+15125550140");
        await readyMessaging(s.t, s.companyId);
        await workTextsAllowed(s.as, s.companyId, s.cleanerId);
        await s.as.mutation(api.permissions.set, { companyId: s.companyId, action: "recruiter.onboarding_reminder", level: "execute" });
        vi.setSystemTime(NOW + DAY + HOUR);
        await s.t.mutation(internal.cleanerFollowUps.sweep, {});
        await s.t.mutation(internal.cleanerFollowUps.sweep, {});
        // Before the queued text is handed to the carrier, the person finishes everything they were asked for.
        for (const key of ["contact", "documents", "policies", "tax_form", "payment_setup", "equipment"]) await s.as.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleanerId, key, decision: "waive", note: "Done at the office." });
        await s.as.mutation(api.availability.setWeek, { companyId: s.companyId, cleanerId: s.cleanerId, windows: [{ weekday: 2, startMinute: 480, endMinute: 1020 }] });
        await settle(s.t);
        const messages = await s.t.run((ctx) => ctx.db.query("messages").collect());
        const reminder = messages.find((row) => row.purpose === "onboarding_reminder")!;
        expect(reminder).toMatchObject({ status: "not_sent", problem: "What it was about is done." });
        expect(mockOutbox.some((row) => row.to === "+15125550140" && row.body.includes("reminder"))).toBe(false);
        // A paused engagement gets no routine reminders at all.
        await s.as.mutation(api.cleanerProfile.setEngagementStatus, { companyId: s.companyId, cleanerId: s.cleanerId, status: "ready" });
        await s.as.mutation(api.cleanerProfile.setEngagementStatus, { companyId: s.companyId, cleanerId: s.cleanerId, status: "paused" });
        expect(await refusal(s.as.mutation(api.cleanerFollowUps.sendNow, { companyId: s.companyId, cleanerId: s.cleanerId, topic: "onboarding" }))).toContain("nothing to remind");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
