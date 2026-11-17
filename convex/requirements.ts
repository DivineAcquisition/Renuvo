/**
 * Onboarding requirements: what the company asks of each kind of worker (the Owner sets these; they are
 * company policy), and each worker's progress, which managers review. Files are read only by the roles
 * allowed to see them, and a tax or payout document by the Owner alone.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyQuery, managerMutation, ownerMutation, ownerQuery } from "./lib/builders";
import { notAllowed, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { instant, optionalText, text } from "./lib/text";
import { maySeePersonnelNotes } from "./lib/workforce/access";
import { attachDocument, markDone, markStarted, review, waive } from "./lib/workforce/requirementWrites";
import { activeRequirements, factDetail, mayReview, workerFacts } from "./lib/workforce/requirements";
import { blocksValidator, engagementListValidator, requirementKindValidator } from "./lib/workforce/schema";

const definition = {
  label: v.string(),
  instructions: v.optional(v.string()),
  kind: requirementKindValidator,
  appliesTo: engagementListValidator,
  blocks: blocksValidator,
  needsReview: v.boolean(),
  reviewBy: v.union(v.literal("manager"), v.literal("owner")),
  validMonths: v.optional(v.number()),
  statement: v.optional(v.string()),
  ownerOnly: v.boolean(),
};

function checked(input: { label: string; instructions?: string; kind: Doc<"onboardingRequirements">["kind"]; appliesTo: Doc<"onboardingRequirements">["appliesTo"]; blocks: Doc<"onboardingRequirements">["blocks"]; needsReview: boolean; reviewBy: "manager" | "owner"; validMonths?: number; statement?: string; ownerOnly: boolean }) {
  const appliesTo = [...new Set(input.appliesTo)];
  if (appliesTo.length === 0) throw userError("Choose at least one worker type it applies to.");
  const statement = optionalText(input.statement, "The statement", 4000);
  if (input.kind === "acknowledgment" && !statement) throw userError("Write the words the cleaner agrees to.");
  if (input.validMonths !== undefined && (!Number.isInteger(input.validMonths) || input.validMonths < 1 || input.validMonths > 120)) throw userError("Valid for is a whole number of months, 1 to 120.");
  return {
    label: text(input.label, "Name", 120),
    instructions: optionalText(input.instructions, "Instructions", 1000),
    kind: input.kind,
    appliesTo,
    blocks: input.blocks,
    // An upload is never a verification: a file always waits for a person. Payment setup is confirmed by a person too.
    needsReview: input.kind === "document" || input.kind === "payment_setup" ? true : input.kind === "agreement" ? false : input.needsReview,
    reviewBy: input.ownerOnly ? ("owner" as const) : input.reviewBy,
    validMonths: input.kind === "document" ? input.validMonths : undefined,
    statement: input.kind === "acknowledgment" ? statement : undefined,
    ownerOnly: input.ownerOnly,
  };
}

/** The company's requirements, in order, with how many people each applies to now. Everyone may read them. */
export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await activeRequirements(ctx, ctx.companyId);
    return rows.map((row) => ({ id: row._id, label: row.label, instructions: row.instructions ?? null, kind: row.kind, appliesTo: row.appliesTo, blocks: row.blocks, needsReview: row.needsReview, reviewBy: row.reviewBy, validMonths: row.validMonths ?? null, statement: row.statement ?? null, ownerOnly: row.ownerOnly, version: row.version }));
  },
});

export const create = ownerMutation({
  args: definition,
  handler: async (ctx, args) => {
    const values = checked(args);
    const existing = await activeRequirements(ctx, ctx.companyId);
    if (existing.length >= 40) throw userError("A company can have up to 40 onboarding requirements.");
    if (existing.some((row) => row.label.trim().toLowerCase() === values.label.toLowerCase())) throw userError(`There is already a requirement called ${values.label}.`);
    const now = Date.now();
    const id = await ctx.db.insert("onboardingRequirements", { companyId: ctx.companyId, ...values, order: existing.length, version: 1, status: "active", createdBy: ctx.member._id, createdAt: now, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "onboardingRequirements.created", actor: byMember(ctx), subject: { table: "onboardingRequirements", id } });
    return id;
  },
});

/**
 * Changes a requirement. A change to what it asks (its kind, its words, who it applies to, what it blocks)
 * is a new version: an acknowledgment of the old words no longer counts for the new ones.
 */
export const update = ownerMutation({
  args: { requirementId: v.id("onboardingRequirements"), ...definition },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.requirementId);
    if (row.status !== "active") throw userError("This requirement is no longer in use.");
    const values = checked(args);
    if (values.kind !== row.kind) throw userError("The kind of a requirement cannot change. Retire it and add a new one.");
    const changed = values.statement !== row.statement || values.blocks !== row.blocks || values.appliesTo.join() !== row.appliesTo.join();
    await ctx.db.patch(row._id, { ...values, version: changed ? row.version + 1 : row.version, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "onboardingRequirements.updated", actor: byMember(ctx), subject: { table: "onboardingRequirements", id: row._id }, data: { newVersion: changed } });
    return null;
  },
});

/** Stops using a requirement. What workers already did is kept; it no longer counts toward readiness. */
export const retire = ownerMutation({
  args: { requirementId: v.id("onboardingRequirements") },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.requirementId);
    if (row.status === "retired") return null;
    await ctx.db.patch(row._id, { status: "retired", updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "onboardingRequirements.retired", actor: byMember(ctx), subject: { table: "onboardingRequirements", id: row._id } });
    return null;
  },
});

/** Starting points the Owner may add. Nothing is added until the Owner chooses it, and every value can be changed. */
export const suggestions = ownerQuery({
  args: {},
  handler: async () => [
    { label: "Signed work agreement", kind: "agreement" as const, appliesTo: ["contractor", "employee"] as const, blocks: "assignments" as const, needsReview: false, reviewBy: "manager" as const, ownerOnly: false, instructions: "Met when a workforce agreement linked to them is fully signed in Agreements." },
    { label: "Photo ID", kind: "document" as const, appliesTo: ["contractor", "employee", "subcontracted"] as const, blocks: "assignments" as const, needsReview: true, reviewBy: "manager" as const, ownerOnly: false, instructions: "A clear photo of a government-issued ID." },
    { label: "Tax form", kind: "document" as const, appliesTo: ["contractor", "employee"] as const, blocks: "payment" as const, needsReview: true, reviewBy: "owner" as const, ownerOnly: true, instructions: "The tax form for how you work with us. Only the Owner sees it." },
    { label: "Payment setup", kind: "payment_setup" as const, appliesTo: ["contractor", "employee"] as const, blocks: "payment" as const, needsReview: true, reviewBy: "owner" as const, ownerOnly: true, instructions: "Set up how you are paid. A person confirms it once it is complete." },
    { label: "Proof of insurance", kind: "document" as const, appliesTo: ["contractor"] as const, blocks: "info" as const, needsReview: true, reviewBy: "manager" as const, validMonths: 12, ownerOnly: false, instructions: "Your current certificate of insurance." },
    { label: "Policies and job-day guide", kind: "acknowledgment" as const, appliesTo: ["contractor", "employee", "subcontracted"] as const, blocks: "assignments" as const, needsReview: false, reviewBy: "manager" as const, ownerOnly: false, statement: "I have read the company's policies and job-day guide, and I will follow them on every visit." },
    { label: "Supplies they bring", kind: "equipment" as const, appliesTo: ["contractor"] as const, blocks: "info" as const, needsReview: true, reviewBy: "manager" as const, ownerOnly: false, instructions: "Confirm the supplies and equipment you bring to each visit, or tell us what you need from us." },
  ],
});

// ── One worker ───────────────────────────────────────────────────────────────────────────────────

/**
 * Where one worker stands on each requirement. Everyone sees the states, because they decide who can be
 * offered work. Files, notes and the reviewer's identity are for managers; an Owner-only file is for the Owner.
 */
export const forWorker = companyQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const now = instant(args.asOf, "The time");
    const facts = await workerFacts(ctx, worker, now);
    const out = [];
    for (const fact of facts) {
      const { requirement, row } = fact;
      const seesFiles = maySeePersonnelNotes(ctx.role) && (!requirement.ownerOnly || ctx.role === "owner");
      const documents = [];
      if (seesFiles && row) {
        for (const id of row.documentIds) {
          const doc = await ctx.db.get(id);
          if (doc && doc.companyId === ctx.companyId) documents.push({ id: doc._id, fileName: doc.fileName, contentType: doc.contentType, size: doc.size, uploadedAt: doc.uploadedAt, byCleaner: doc.uploadedBy.kind === "cleaner" });
        }
      }
      const reviewer = row?.reviewedBy ? await ctx.db.get(row.reviewedBy) : null;
      out.push({
        requirementId: requirement._id,
        label: requirement.label,
        kind: requirement.kind,
        instructions: requirement.instructions ?? null,
        statement: requirement.statement ?? null,
        blocks: requirement.blocks,
        needsReview: requirement.needsReview,
        ownerOnly: requirement.ownerOnly,
        state: fact.state,
        waived: fact.waived ? { reason: row!.waived!.reason, at: row!.waived!.at } : null,
        met: fact.met,
        detail: factDetail(fact, ctx.company.timezone),
        submittedAt: row?.submittedAt ?? null,
        submittedByCleaner: row?.submittedBy?.kind === "cleaner",
        reviewedAt: row?.reviewedAt ?? null,
        reviewedBy: maySeePersonnelNotes(ctx.role) ? (reviewer?.name ?? null) : null,
        feedback: row?.feedback ?? null,
        note: maySeePersonnelNotes(ctx.role) ? (row?.note ?? null) : null,
        expiresAt: row?.expiresAt ?? null,
        documents,
        filesHidden: !seesFiles && Boolean(row && row.documentIds.length > 0),
        mayReview: mayReview(requirement, ctx.role),
      });
    }
    return out;
  },
});

/** An address for one file, for the roles that may read it. It is short-lived; nothing about it is stored. */
export const documentUrl = companyQuery({
  args: { documentId: v.id("workerDocuments") },
  handler: async (ctx, args) => {
    const doc = await owned(ctx, args.documentId);
    const requirement = await ctx.db.get(doc.requirementId);
    if (!maySeePersonnelNotes(ctx.role) || (requirement?.ownerOnly && ctx.role !== "owner")) notAllowed();
    return { url: await ctx.storage.getUrl(doc.storageId), fileName: doc.fileName, contentType: doc.contentType };
  },
});

async function reviewable(ctx: MutationCtx & { role: "owner" | "manager" | "office"; companyId: Id<"companies"> }, cleanerId: Id<"cleaners">, requirementId: Id<"onboardingRequirements">) {
  const worker = await owned(ctx, cleanerId);
  const requirement = await owned(ctx, requirementId);
  if (!mayReview(requirement, ctx.role)) notAllowed();
  return { worker, requirement };
}

export const decide = managerMutation({
  args: { cleanerId: v.id("cleaners"), requirementId: v.id("onboardingRequirements"), decision: v.union(v.literal("accept"), v.literal("needs_changes")), feedback: v.optional(v.string()), note: v.optional(v.string()), validUntil: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { worker, requirement } = await reviewable(ctx, args.cleanerId, args.requirementId);
    await review(ctx, worker, requirement, ctx.member, { decision: args.decision, feedback: args.feedback, note: args.note, validUntil: args.validUntil });
    return null;
  },
});

/** Sets a requirement aside for one worker, with the reason, or withdraws that (reason: null). */
export const waiveFor = managerMutation({
  args: { cleanerId: v.id("cleaners"), requirementId: v.id("onboardingRequirements"), reason: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const { worker, requirement } = await reviewable(ctx, args.cleanerId, args.requirementId);
    await waive(ctx, worker, requirement, ctx.member, args.reason);
    return null;
  },
});

/** A person records something the cleaner gave them outside the portal (paper, in person). It still waits for review where review is needed. */
export const recordFor = managerMutation({
  args: { cleanerId: v.id("cleaners"), requirementId: v.id("onboardingRequirements"), step: v.union(v.literal("started"), v.literal("done")) },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const requirement = await owned(ctx, args.requirementId);
    if (requirement.ownerOnly && ctx.role !== "owner") notAllowed();
    if (args.step === "started") await markStarted(ctx, worker, requirement, { kind: "member", memberId: ctx.member._id });
    else await markDone(ctx, worker, requirement, { kind: "member", memberId: ctx.member._id });
    return null;
  },
});

export const uploadUrl = managerMutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const attachFor = managerMutation({
  args: { cleanerId: v.id("cleaners"), requirementId: v.id("onboardingRequirements"), storageId: v.id("_storage"), fileName: v.string(), clientKey: v.string() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const requirement = await owned(ctx, args.requirementId);
    if (requirement.ownerOnly && ctx.role !== "owner") notAllowed();
    return attachDocument(ctx, worker, requirement, { kind: "member", memberId: ctx.member._id }, { storageId: args.storageId, fileName: args.fileName, clientKey: args.clientKey });
  },
});

