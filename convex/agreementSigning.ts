/**
 * Sending an approved agreement for signature, and everything that follows: the provider's reports,
 * reminders, withdrawal, expiry and the exact signed document.
 *
 * Public functions are for people and check their role. The provider's own reports arrive through the
 * verified webhook (http.ts) and the internal mutation below, never through a public function.
 * With no provider connected nothing here sends anything and every answer says so.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { companyMutation, companyQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { mayRead } from "./lib/agreements/access";
import { signingProvider, signingStatus } from "./lib/agreements/signing";
import { sha256Bytes } from "./lib/agreements/hash";
import { load, versionRow } from "./lib/agreements/store";
import { applyEvent, expireDue, markDispatchFailed, markDispatched, remind, sendBlockers, startRequest, withdraw } from "./lib/agreements/signingStore";
import { eventSchema } from "./lib/agreements/eventSchema";

export const status = companyQuery({ args: {}, handler: async () => signingStatus() });

/** Why this agreement cannot be sent now, in words, so a disabled button can explain itself. */
export const blockers = companyQuery({
  args: { agreementId: v.string() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    return { blockers: await sendBlockers(ctx as never, agreement), signing: signingStatus() };
  },
});

/** Sends the approved version for signature. The request names that exact version and its hash. */
export const send = companyMutation({
  args: { agreementId: v.string(), expiresInDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const requestId = await startRequest(ctx, agreement, { expiresInDays: args.expiresInDays });
    await ctx.scheduler.runAfter(0, internal.agreementSigning.dispatch, { requestId });
    return requestId;
  },
});

export const forDispatch = internalQuery({
  args: { requestId: v.id("agreementSignatureRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status !== "queued") return null;
    const agreement = await ctx.db.get(request.agreementId);
    if (!agreement) return null;
    const version = await ctx.db.query("agreementVersions").withIndex("by_company_agreement_version", (q) => q.eq("companyId", request.companyId).eq("agreementId", request.agreementId).eq("version", request.version)).unique();
    if (!version || version.hash !== request.hash) return { problem: "The text no longer matches what was approved." as const };
    return { title: agreement.title, markdown: version.markdown, hash: version.hash, version: version.version, signers: request.signers.map((s) => ({ role: s.role, name: s.name, email: s.email, order: s.order })), expiresAt: request.expiresAt, agreementId: agreement._id as string };
  },
});

export const dispatchResult = internalMutation({
  args: { requestId: v.id("agreementSignatureRequests"), providerRequestId: v.optional(v.string()), problem: v.optional(v.string()) },
  handler: async (ctx, args) => (args.providerRequestId ? markDispatched(ctx, args.requestId, args.providerRequestId) : markDispatchFailed(ctx, args.requestId, args.problem ?? "The signing service did not accept the request.")),
});

/** Hands the request to the provider. The provider's acceptance is "sent", not delivered and not signed. */
export const dispatch = internalAction({
  args: { requestId: v.id("agreementSignatureRequests") },
  handler: async (ctx, args): Promise<null> => {
    const data = await ctx.runQuery(internal.agreementSigning.forDispatch, args);
    if (!data) return null;
    const provider = signingProvider();
    if (!provider) {
      await ctx.runMutation(internal.agreementSigning.dispatchResult, { requestId: args.requestId, problem: signingStatus().why });
      return null;
    }
    if ("problem" in data) {
      await ctx.runMutation(internal.agreementSigning.dispatchResult, { requestId: args.requestId, problem: data.problem });
      return null;
    }
    const result = await provider.createRequest({ agreementId: data.agreementId, version: data.version, hash: data.hash, title: data.title, markdown: data.markdown, signers: data.signers, expiresAt: data.expiresAt, idempotencyKey: `agreement-request-${args.requestId}` });
    await ctx.runMutation(internal.agreementSigning.dispatchResult, result.ok ? { requestId: args.requestId, providerRequestId: result.providerRequestId } : { requestId: args.requestId, problem: result.problem });
    return null;
  },
});

export const withdrawRequest = companyMutation({
  args: { agreementId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const request = await withdraw(ctx, agreement, args.reason ?? "");
    if (request?.providerRequestId) await ctx.scheduler.runAfter(0, internal.agreementSigning.withdrawAtProvider, { requestId: request._id });
    return null;
  },
});

export const forWithdraw = internalQuery({ args: { requestId: v.id("agreementSignatureRequests") }, handler: async (ctx, args) => (await ctx.db.get(args.requestId)) ?? null });

export const noteProblem = internalMutation({
  args: { requestId: v.id("agreementSignatureRequests"), problem: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, { problem: args.problem.slice(0, 300) });
    return null;
  },
});

/** Tells the provider to stop. If it cannot, the problem is recorded: the request may still reach the signers. */
export const withdrawAtProvider = internalAction({
  args: { requestId: v.id("agreementSignatureRequests") },
  handler: async (ctx, args): Promise<null> => {
    const request = await ctx.runQuery(internal.agreementSigning.forWithdraw, args);
    const provider = signingProvider();
    if (!request?.providerRequestId || !provider) return null;
    const result = await provider.withdraw(request.providerRequestId);
    if (!result.ok) await ctx.runMutation(internal.agreementSigning.noteProblem, { requestId: args.requestId, problem: `Withdrawn in Selestial, but the signing service said: ${result.problem} The signers may still be able to sign.` });
    return null;
  },
});

/** At most one reminder a day. A repeat finds the first and does nothing. */
export const remindSigners = companyMutation({
  args: { agreementId: v.string(), signerEmail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const { request, emails } = await remind(ctx, agreement, args.signerEmail);
    await ctx.scheduler.runAfter(0, internal.agreementSigning.remindAtProvider, { requestId: request._id, emails });
    return { reminded: emails.length };
  },
});

export const remindAtProvider = internalAction({
  args: { requestId: v.id("agreementSignatureRequests"), emails: v.array(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const request = await ctx.runQuery(internal.agreementSigning.forWithdraw, { requestId: args.requestId });
    const provider = signingProvider();
    if (!request?.providerRequestId || !provider) return null;
    for (const email of args.emails) {
      const result = await provider.remind(request.providerRequestId, email);
      if (!result.ok) await ctx.runMutation(internal.agreementSigning.noteProblem, { requestId: args.requestId, problem: `A reminder could not be sent to ${email}: ${result.problem}` });
    }
    return null;
  },
});

/** A replacement request: the open one is withdrawn and a new one is made for the current approved version. */
export const replace = companyMutation({
  args: { agreementId: v.string(), reason: v.optional(v.string()), expiresInDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const old = await withdraw(ctx, agreement, args.reason ?? "Replaced by a new request");
    if (old?.providerRequestId) await ctx.scheduler.runAfter(0, internal.agreementSigning.withdrawAtProvider, { requestId: old._id });
    // Withdrawal returns the agreement to a state it can be sent from again, provided the approved version still stands.
    const fresh = await load(ctx, args.agreementId);
    await ctx.db.patch(fresh._id, { workflow: fresh.approvedVersion === fresh.currentVersion && fresh.approvedHash ? "approved" : "draft" });
    const requestId = await startRequest(ctx, (await load(ctx, args.agreementId)), { expiresInDays: args.expiresInDays });
    if (old) await ctx.db.patch(old._id, { replacedBy: requestId });
    await ctx.scheduler.runAfter(0, internal.agreementSigning.dispatch, { requestId });
    return requestId;
  },
});

// ── The provider's reports ───────────────────────────────────────────────────────────────────────

/** Applies one verified report. Called only by the webhook. A report delivered twice is applied once. */
export const receipt = internalMutation({
  args: { provider: v.string(), event: eventSchema },
  handler: async (ctx, args) => {
    const result = await applyEvent(ctx, args.provider, args.event as never);
    if (result.completed && result.requestId) await ctx.scheduler.runAfter(0, internal.agreementSigning.fetchSigned, { requestId: result.requestId });
    return result.outcome;
  },
});

export const saveSigned = internalMutation({
  args: { requestId: v.id("agreementSignatureRequests"), storageId: v.optional(v.id("_storage")), hash: v.optional(v.string()), evidence: v.optional(v.string()), problem: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return null;
    if (request.signedFileId) {
      // Already stored: the second copy is not kept.
      if (args.storageId) await ctx.storage.delete(args.storageId);
      return null;
    }
    await ctx.db.patch(request._id, args.storageId ? { signedFileId: args.storageId, signedFileHash: args.hash, evidenceNote: args.evidence?.slice(0, 500), problem: undefined } : { problem: args.problem?.slice(0, 300) ?? "The signed copy could not be retrieved." });
    await recordEvent(ctx, { companyId: request.companyId, type: args.storageId ? "agreement.signed_copy_stored" : "agreement.signed_copy_failed", actor: { kind: "system" }, subject: { table: "agreementSignatureRequests", id: request._id } });
    return null;
  },
});

/** Retrieves the exact completed document from the provider and keeps it. If it cannot be had, that is said; the signature record stands. */
export const fetchSigned = internalAction({
  args: { requestId: v.id("agreementSignatureRequests") },
  handler: async (ctx, args): Promise<null> => {
    const request = await ctx.runQuery(internal.agreementSigning.forWithdraw, args);
    const provider = signingProvider();
    if (!request?.providerRequestId || !provider || request.signedFileId) return null;
    const result = await provider.fetchSigned(request.providerRequestId);
    if (!result.ok) {
      await ctx.runMutation(internal.agreementSigning.saveSigned, { requestId: args.requestId, problem: result.problem });
      return null;
    }
    const storageId = await ctx.storage.store(new Blob([result.bytes.slice().buffer as ArrayBuffer], { type: result.contentType }));
    await ctx.runMutation(internal.agreementSigning.saveSigned, { requestId: args.requestId, storageId, hash: sha256Bytes(result.bytes), evidence: result.evidence });
    return null;
  },
});

/** Asks again for a signed copy that could not be retrieved. */
export const retrySigned = companyMutation({
  args: { agreementId: v.string() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    if (agreement.workflow !== "signed" || agreement.provenance !== "provider_signed") throw userError("There is no provider-signed copy to retrieve.");
    const rows = await ctx.db.query("agreementSignatureRequests").withIndex("by_company_agreement", (q) => q.eq("companyId", ctx.companyId).eq("agreementId", agreement._id)).order("desc").take(5);
    const done = rows.find((r) => r.status === "completed");
    if (!done) throw userError("There is no completed request.");
    if (done.signedFileId) throw userError("The signed copy is already stored.");
    await ctx.scheduler.runAfter(0, internal.agreementSigning.fetchSigned, { requestId: done._id });
    return null;
  },
});

/** A short-lived link to the exact document the provider completed. The download is recorded. */
export const signedDownload = companyMutation({
  args: { agreementId: v.string() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    if (!mayRead(ctx.role, agreement.access)) throw userError("Not found.", "not_found");
    const rows = await ctx.db.query("agreementSignatureRequests").withIndex("by_company_agreement", (q) => q.eq("companyId", ctx.companyId).eq("agreementId", agreement._id)).order("desc").take(10);
    const done = rows.find((r) => r.status === "completed" && r.signedFileId);
    if (!done?.signedFileId) throw userError("The signed copy has not been retrieved from the signing service.");
    const url = await ctx.storage.getUrl(done.signedFileId);
    if (!url) throw userError("The signed copy is no longer available.");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement.signed_copy_downloaded", actor: byMember(ctx), subject: { table: "agreementSignatureRequests", id: done._id } });
    const version = await versionRow(ctx, agreement, done.version);
    return { url, hash: done.signedFileHash ?? null, matchesApprovedText: done.hash === version.hash, evidence: done.evidenceNote ?? null };
  },
});

export const sweep = internalMutation({ args: {}, handler: async (ctx) => expireDue(ctx, Date.now()) });

export type RequestId = Id<"agreementSignatureRequests">;
