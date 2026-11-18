/**
 * Selestial-hosted signing: a signer opens their own link, reads the exact approved version, types their
 * name and agrees. The signature records the version and its hash, the words they agreed to, and when.
 * The request is completed through the same path an outside provider's report takes
 * (lib/agreements/signingStore.ts applyEvent), so every downstream step behaves the same.
 *
 * A staff note that terms were discussed never stands in for this.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { applyEvent, isOpen } from "./lib/agreements/signingStore";
import { HOSTED } from "./lib/agreements/signing";
import { salesLinkMutation, salesLinkQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { recordEvent } from "./lib/events";
import { optionalText, text } from "./lib/text";

export const CONSENT = "I have read this agreement, I agree to its terms, and I intend my typed name below to be my electronic signature. I agree to sign electronically.";

async function resolve(ctx: QueryCtx | MutationCtx, publicId: string) {
  const link = await ctx.db
    .query("agreementSigningLinks")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  if (!link) return null;
  const request = await ctx.db.get(link.requestId);
  const agreement = await ctx.db.get(link.agreementId);
  const company = await ctx.db.get(link.companyId);
  if (!request || !agreement || !company) return null;
  return { link, request, agreement, company };
}

type Resolved = NonNullable<Awaited<ReturnType<typeof resolve>>>;

function state(r: Resolved): "open" | "signed" | "declined" | "expired" | "withdrawn" | "closed" {
  if (r.link.signature) return "signed";
  if (r.link.declined) return "declined";
  if (r.request.status === "expired" || r.request.expiresAt < Date.now()) return "expired";
  if (r.request.status === "withdrawn") return "withdrawn";
  return isOpen(r.request.status) ? "open" : "closed";
}

export const view = salesLinkQuery({
  kind: "sign",
  resolve,
  args: {},
  handler: async (ctx) => {
    const r = ctx.link;
    if (!r) return null;
    const version = await ctx.db
      .query("agreementVersions")
      .withIndex("by_company_agreement_version", (q) => q.eq("companyId", r.request.companyId).eq("agreementId", r.request.agreementId).eq("version", r.request.version))
      .unique();
    // Only the version the request names is ever shown, and only if its text is unchanged.
    if (!version || version.hash !== r.request.hash) return { state: "closed" as const, company: r.company.name, title: r.agreement.title };
    return {
      state: state(r),
      company: r.company.name,
      title: r.agreement.title,
      markdown: version.markdown,
      version: version.version,
      hash: version.hash,
      signer: { name: r.link.signerName, email: r.link.signerEmail },
      signature: r.link.signature ? { typedName: r.link.signature.typedName, at: r.link.signature.at } : null,
      others: r.request.signers.filter((s) => s.email !== r.link.signerEmail).map((s) => ({ name: s.name, signed: s.status === "signed" })),
      expiresAt: r.request.expiresAt,
      consent: CONSENT,
    };
  },
});

/** Notes the first time the signer opened the document. Opening changes nothing else. */
export const opened = salesLinkMutation({
  kind: "sign",
  resolve,
  args: {},
  handler: async (ctx) => {
    const r = ctx.link as Resolved;
    if (r.link.viewedAt || state(r) !== "open") return null;
    await ctx.db.patch(r.link._id, { viewedAt: Date.now() });
    if (r.request.provider === HOSTED && r.request.providerRequestId) await applyEvent(ctx, HOSTED, { eventId: `viewed:${r.link._id}`, requestId: r.request.providerRequestId, type: "viewed", signerEmail: r.link.signerEmail, at: Date.now() });
    return null;
  },
});

export const signNow = salesLinkMutation({
  kind: "sign",
  resolve,
  args: { typedName: v.string(), hash: v.string(), agreed: v.boolean(), userAgent: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const r = ctx.link as Resolved;
    // Signing twice from two tabs records one signature.
    if (r.link.signature) return { signed: true, already: true };
    const now = state(r);
    if (now !== "open") throw userError(now === "expired" ? "This signing link has expired. Ask the company for a new one." : "This document can no longer be signed here.");
    if (!args.agreed) throw userError("Check the box to agree before signing.");
    if (args.hash !== r.request.hash) throw userError("The document changed since you opened it. Reload and read the current version.");
    const typed = text(args.typedName, "Your full name", 120);
    if (typed.replace(/[^a-z]/gi, "").length < 2) throw userError("Type your full name to sign.");
    if (r.request.provider !== HOSTED || !r.request.providerRequestId) throw userError("This document is signed through another service.");
    const at = Date.now();
    await ctx.db.patch(r.link._id, { signature: { typedName: typed, at, hash: r.request.hash, version: r.request.version, consent: CONSENT, userAgent: optionalText(args.userAgent, "Browser", 300) } });
    const result = await applyEvent(ctx, HOSTED, { eventId: `signed:${r.link._id}`, requestId: r.request.providerRequestId, type: "signed", signerEmail: r.link.signerEmail, at });
    await recordEvent(ctx, { companyId: r.request.companyId, type: "agreement.signer_signed", actor: { kind: "system" }, subject: { table: "agreements", id: r.agreement._id }, data: { version: r.request.version, via: HOSTED } });
    if (result.completed) await ctx.scheduler.runAfter(0, internal.bookings.agreementChanged, { agreementId: r.agreement._id });
    return { signed: true, already: false };
  },
});

export const decline = salesLinkMutation({
  kind: "sign",
  resolve,
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const r = ctx.link as Resolved;
    if (r.link.signature || r.link.declined) return null;
    if (state(r) !== "open") throw userError("This document can no longer be answered here.");
    const at = Date.now();
    await ctx.db.patch(r.link._id, { declined: { at, reason: optionalText(args.reason, "Reason", 1000) } });
    if (r.request.providerRequestId) await applyEvent(ctx, HOSTED, { eventId: `declined:${r.link._id}`, requestId: r.request.providerRequestId, type: "declined", signerEmail: r.link.signerEmail, at });
    await ctx.scheduler.runAfter(0, internal.bookings.agreementChanged, { agreementId: r.agreement._id });
    return null;
  },
});

export type SignView = Doc<"agreementSigningLinks">;
