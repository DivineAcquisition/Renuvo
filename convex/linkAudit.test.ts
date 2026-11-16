/**
 * @vitest-environment edge-runtime
 *
 * An audit of the cleaner action links (convex/lib/dispatch/links.ts, convex/links.ts and the link
 * builders). Each test states one property the public trust claim "links-scoped" depends on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accepted, dispatchTestEnv, flush, linkFor, PHONES, setup } from "../tests/dispatchHarness";
import { company, dispatchCleaner, dispatchJob, dispatchPlace, JOB_END, readyMessaging, JOB_START, refusal, TEST_LINK_SECRET, type T } from "../tests/harness";
import { api } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import schema from "./schema";

const MINUTE = 60 * 1000;

/** Every row of every table, and everything scheduled, as one string. */
async function everything(t: T): Promise<string> {
  return t.run(async (ctx) => {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(schema.tables).sort()) out[name] = await ctx.db.query(name as TableNames).collect();
    out._scheduled = await ctx.db.system.query("_scheduled_functions").collect();
    out._storage = await ctx.db.system.query("_storage").collect();
    return JSON.stringify(out);
  });
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmac(publicId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TEST_LINK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`selestial.link.v1:${publicId}`)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Flips one character of a token in the given part. */
function tamper(token: string, part: "id" | "signature"): string {
  const dot = token.indexOf(".");
  const at = part === "id" ? 3 : dot + 5;
  const swapped = token[at] === "A" ? "B" : "A";
  return token.slice(0, at) + swapped + token.slice(at + 1);
}

/** A second company, Beta, with its own cleaner (Noor) holding an accepted job. Same test deployment. */
async function beta(t: T) {
  const { as, companyId } = await company(t, "owner-b", "Beta Cleaning");
  await readyMessaging(t, companyId, "Beta Cleaning");
  const place = await dispatchPlace(as, companyId);
  const cleanerId = await dispatchCleaner(as, companyId, "Noor");
  await as.mutation(api.cleaners.update, { companyId, cleanerId, phone: PHONES.Noor });
  for (const action of ["dispatch.request_acceptance", "dispatch.send_replacement_offer", "dispatch.run_backup_coverage", "dispatch.send_reminder"]) {
    await as.mutation(api.permissions.set, { companyId, action, level: "execute" });
  }
  const jobId = await dispatchJob(as, companyId, place);
  await flush(t);
  const answer = await t.mutation(api.links.acceptOffer, { token: linkFor(PHONES.Noor, "offer") });
  await flush(t);
  await as.mutation(api.dispatchOps.setChecklist, { companyId, jobId, items: [{ label: "Beta kitchen" }] });
  return { as, companyId, jobId, jobToken: answer.jobToken! };
}

describe("link audit: cleaner action links", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("makes each token from 128 random bits and an HMAC, and never stores it", async () => {
    const s = await setup();
    const a = await accepted(s);
    for (const token of [a.offerToken, a.jobToken]) {
      const [publicId, signature] = token.split(".");
      expect(base64urlDecode(publicId)).toHaveLength(16);
      // The signature is HMAC-SHA256 of the public id under the deployment's secret, and nothing else.
      expect(signature).toBe(await hmac(publicId));
      expect(base64urlDecode(signature)).toHaveLength(32);
      // The public id alone is stored; the token and its signature are not, anywhere.
      const stored = await everything(s.t);
      expect(stored).toContain(publicId);
      expect(stored).not.toContain(token);
      expect(stored).not.toContain(signature);
    }
    // Two links never share a public id.
    expect(a.offerToken.split(".")[0]).not.toBe(a.jobToken.split(".")[0]);
  });

  it("changes nothing when a link is opened, however often", async () => {
    const s = await setup();
    const a = await accepted(s);
    const before = await everything(s.t);
    for (let i = 0; i < 3; i += 1) {
      await s.t.query(api.links.offer, { token: a.offerToken });
      await s.t.query(api.links.job, { token: a.jobToken });
      await s.t.query(api.links.job, { token: tamper(a.jobToken, "signature") }).catch(() => null);
    }
    expect(await everything(s.t)).toBe(before);
  });

  it("refuses actions through an expired link", async () => {
    const s = await setup();
    await s.autonomous();
    await dispatchJob(s.as, s.companyId, s.place);
    await flush(s.t);
    const offerToken = linkFor(PHONES.Lena, "offer");
    const [assignment] = (await s.t.run((ctx) => ctx.db.query("assignments").collect())).filter((row) => row.status === "offered");
    vi.setSystemTime(assignment.respondBy + 1);
    expect(await refusal(s.t.mutation(api.links.acceptOffer, { token: offerToken }))).toBe("This link has expired.");
    expect(await refusal(s.t.mutation(api.links.declineOffer, { token: offerToken }))).toBe("This link has expired.");
  });

  it("refuses job actions once the job link has run out, and shows nothing of the job", async () => {
    const s = await setup();
    const a = await accepted(s);
    const link = (await s.t.run((ctx) => ctx.db.query("actionLinks").collect())).find((row) => row.purpose === "job")!;
    // The job link lasts past the end of the visit, then stops.
    expect(link.expiresAt).toBeGreaterThan(JOB_END);
    vi.setSystemTime(link.expiresAt);
    expect(await refusal(s.t.mutation(api.links.checkInJob, { token: a.jobToken }))).toBe("This link has expired.");
    expect(await s.t.query(api.links.job, { token: a.jobToken })).toMatchObject({ state: "expired", detail: null });
  });

  it("refuses a revoked link", async () => {
    const s = await setup();
    const a = await accepted(s);
    const link = (await s.t.run((ctx) => ctx.db.query("actionLinks").collect())).find((row) => row.purpose === "job")!;
    await s.as.mutation(api.dispatchOps.revokeActionLink, { companyId: s.companyId, linkId: link._id, reason: "Phone was lost" });
    vi.setSystemTime(JOB_START);
    expect(await refusal(s.t.mutation(api.links.checkInJob, { token: a.jobToken }))).toBe("This link is no longer active.");
    expect(await s.t.query(api.links.job, { token: a.jobToken })).toMatchObject({ state: "ended", detail: null });
  });

  it("closes the outgoing cleaner's links when an offer is withdrawn or an accepted cleaner is released", async () => {
    const s = await setup();
    // Withdrawn: Lena's open offer is taken back before she answers.
    await s.autonomous();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    await flush(s.t);
    const offerToken = linkFor(PHONES.Lena, "offer");
    const offered = (await s.job(jobId)).assignments.find((row) => row.status === "offered")!;
    await s.as.mutation(api.assignments.release, { companyId: s.companyId, assignmentId: offered._id, reason: "Changed plans", keepWithMe: true });
    expect(await refusal(s.t.mutation(api.links.acceptOffer, { token: offerToken }))).toBe("This link is no longer active.");

    // Released: Rosa accepts the visit, then the office takes her off it.
    await s.as.mutation(api.dispatch.handBack, { companyId: s.companyId, jobId });
    await flush(s.t);
    const rosaOffer = linkFor(PHONES.Rosa, "offer");
    const answer = await s.t.mutation(api.links.acceptOffer, { token: rosaOffer });
    expect(answer.status).toBe("accepted");
    const rosa = (await s.job(jobId)).assignments.find((row) => row.status === "accepted")!;
    await s.as.mutation(api.assignments.release, { companyId: s.companyId, assignmentId: rosa._id, reason: "Customer asked for someone else", keepWithMe: true });
    vi.setSystemTime(JOB_START);
    expect(await refusal(s.t.mutation(api.links.checkInJob, { token: answer.jobToken! }))).toBe("This link is no longer active.");
    expect(await s.t.query(api.links.job, { token: answer.jobToken! })).toMatchObject({ state: "ended", detail: null });
    const links = await s.t.run((ctx) => ctx.db.query("actionLinks").collect());
    expect(links.filter((row) => row.assignmentId === rosa._id || row.assignmentId === offered._id).every((row) => row.revokedAt !== undefined)).toBe(true);
  });

  it("does not lead from the old offer text to a job link issued again after the first was lost", async () => {
    const s = await setup();
    const a = await accepted(s);
    // Right after acceptance, the spent offer page points at the job link, as designed.
    expect((await s.t.query(api.links.offer, { token: a.offerToken })).jobToken).toBe(a.jobToken);
    // Lena loses her phone. The office issues a new job link and texts it.
    await s.as.mutation(api.dispatchOps.reissueLink, { companyId: s.companyId, assignmentId: a.assignmentId });
    await flush(s.t);
    const fresh = linkFor(PHONES.Lena, "job");
    expect(fresh).not.toBe(a.jobToken);
    // Whoever has the lost phone's offer text gets no way to the new link, and the old job link is dead.
    expect((await s.t.query(api.links.offer, { token: a.offerToken })).jobToken).toBeNull();
    expect(await s.t.query(api.links.job, { token: a.jobToken })).toMatchObject({ state: "ended", detail: null });
    expect((await s.t.query(api.links.job, { token: fresh })).state).toBe("active");
  });

  it("does not let an offer link do job actions, or a job link answer an offer", async () => {
    const s = await setup();
    const a = await accepted(s);
    vi.setSystemTime(JOB_START);
    for (const call of [
      () => s.t.mutation(api.links.checkInJob, { token: a.offerToken }),
      () => s.t.mutation(api.links.reportDelayJob, { token: a.offerToken, etaMinutes: 10 }),
      () => s.t.mutation(api.links.cannotAttendJob, { token: a.offerToken, reason: "Sick" }),
      () => s.t.mutation(api.links.photoUploadUrl, { token: a.offerToken }),
      () => s.t.mutation(api.links.submitJob, { token: a.offerToken, incomplete: false }),
    ]) {
      // The spent offer link is closed; were it open, its list of actions still has none of these.
      expect([NOT_ALLOWED, "This link is no longer active.", "This link has expired."]).toContain(await refusal(call()));
    }
    const offerLink = (await s.t.run((ctx) => ctx.db.query("actionLinks").collect())).find((row) => row.purpose === "offer")!;
    expect(offerLink.allowed.sort()).toEqual(["accept", "decline"]);
    // A live offer link, made live again for this check, is still refused every job action.
    await s.t.run((ctx) => ctx.db.patch(offerLink._id, { revokedAt: undefined, expiresAt: JOB_END }));
    expect(await refusal(s.t.mutation(api.links.checkInJob, { token: a.offerToken }))).toBe(NOT_ALLOWED);
    expect(await refusal(s.t.mutation(api.links.submitJob, { token: a.offerToken, incomplete: false }))).toBe(NOT_ALLOWED);
    expect(await refusal(s.t.query(api.links.job, { token: a.offerToken }))).toBe(NOT_FOUND);
    // And the job link cannot accept or decline anything.
    expect(await refusal(s.t.mutation(api.links.acceptOffer, { token: a.jobToken }))).toBe(NOT_ALLOWED);
    expect(await refusal(s.t.mutation(api.links.declineOffer, { token: a.jobToken }))).toBe(NOT_ALLOWED);
    expect(await refusal(s.t.query(api.links.offer, { token: a.jobToken }))).toBe(NOT_FOUND);
  });

  it("keeps a link inside its own company: another company's records are not found", async () => {
    const s = await setup();
    const a = await accepted(s);
    await s.as.mutation(api.dispatchOps.setChecklist, { companyId: s.companyId, jobId: a.jobId, items: [{ label: "Alpha kitchen" }] });
    const b = await beta(s.t);
    vi.setSystemTime(JOB_START);
    await s.t.mutation(api.links.checkInJob, { token: a.jobToken });
    await s.t.mutation(api.links.checkInJob, { token: b.jobToken });

    const bItem = (await s.t.run((ctx) => ctx.db.query("checklistItems").collect())).find((row) => row.companyId === b.companyId)!;
    const bUpload = await s.t.mutation(api.links.photoUploadUrl, { token: b.jobToken });
    expect(typeof bUpload).toBe("string");
    const bPhoto = await s.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["x"], { type: "image/jpeg" }));
      const assignment = (await ctx.db.query("assignments").collect()).find((row) => row.companyId === b.companyId && row.status === "accepted")!;
      return ctx.db.insert("evidence", { companyId: b.companyId, jobId: b.jobId, assignmentId: assignment._id, cleanerId: assignment.cleanerId, kind: "before", storageId, clientKey: "beta-photo-1", uploadedAt: JOB_START });
    });

    // Alpha's link naming Beta's records.
    expect(await refusal(s.t.mutation(api.links.setChecklistItem, { token: a.jobToken, itemId: bItem._id, state: "done" }))).toBe(NOT_FOUND);
    expect(await refusal(s.t.mutation(api.links.removePhoto, { token: a.jobToken, evidenceId: bPhoto }))).toBe(NOT_FOUND);
    const storageId = await s.t.run((ctx) => ctx.storage.store(new Blob(["y"], { type: "image/jpeg" })));
    expect(await refusal(s.t.mutation(api.links.attachPhoto, { token: a.jobToken, storageId, kind: "item", clientKey: "alpha-photo-1", itemId: bItem._id }))).toBe(NOT_FOUND);

    // Alpha's page shows Alpha only.
    const page = JSON.stringify(await s.t.query(api.links.job, { token: a.jobToken }));
    expect(page).toContain("Alpha Cleaning");
    expect(page).not.toContain("Beta");
    expect(page).not.toContain("Noor");
    // Beta's item is untouched.
    expect((await s.t.run((ctx) => ctx.db.get(bItem._id)))!.state).toBe("pending");
  });

  it("refuses a tampered, truncated or unsigned token the same way, and every link when the secret is gone", async () => {
    const s = await setup();
    const a = await accepted(s);
    const [publicId] = a.jobToken.split(".");
    for (const token of [tamper(a.jobToken, "signature"), tamper(a.jobToken, "id"), publicId, `${publicId}.`, `.${a.jobToken.split(".")[1]}`, "", `${a.jobToken}x`, "x".repeat(300)]) {
      expect(await refusal(s.t.query(api.links.job, { token })), token).toBe(NOT_FOUND);
      expect(await refusal(s.t.mutation(api.links.checkInJob, { token })), token).toBe(NOT_FOUND);
    }
    // A token signed with another secret names nothing.
    process.env.ACTION_LINK_SECRET = "another-secret-that-is-long-enough-0123456789";
    expect(await refusal(s.t.query(api.links.job, { token: a.jobToken }))).toBe(NOT_FOUND);
    delete process.env.ACTION_LINK_SECRET;
    expect(await refusal(s.t.query(api.links.job, { token: a.jobToken }))).toBe(NOT_FOUND);
  });

  it("writes no token into any event, however the link was used", async () => {
    const s = await setup();
    const a = await accepted(s);
    vi.setSystemTime(JOB_START - 30 * MINUTE);
    await s.t.mutation(api.links.reportDelayJob, { token: a.jobToken, etaMinutes: 15, reason: "Traffic" });
    vi.setSystemTime(JOB_START);
    await s.t.mutation(api.links.checkInJob, { token: a.jobToken });
    const link = (await s.t.run((ctx) => ctx.db.query("actionLinks").collect())).find((row) => row.purpose === "job")!;
    await s.as.mutation(api.dispatchOps.revealActionLink, { companyId: s.companyId, linkId: link._id });
    await flush(s.t);
    const events = JSON.stringify(await s.t.run((ctx) => ctx.db.query("events").collect()));
    expect(events).toContain("link.action");
    expect(events).toContain("link.revealed");
    for (const token of [a.offerToken, a.jobToken]) {
      expect(events).not.toContain(token);
      expect(events).not.toContain(token.split(".")[1]);
    }
    // Messages hold the link as a placeholder, never the token.
    const messages = await s.t.run((ctx) => ctx.db.query("messages").collect());
    expect(messages.some((row) => row.body.includes("{link}"))).toBe(true);
    expect(JSON.stringify(messages)).not.toContain(a.jobToken.split(".")[1]);
  });
});
