/**
 * Onboarding requirements: the company's template, and a person's review of what a cleaner submitted.
 *
 * The template is the Owner's. Each requirement says what an unmet one holds up (work, payment, or nothing),
 * which relationship types it applies to, who may review it, and how long it stays valid. A submission is
 * never a verification: only a named reviewer accepts, asks for changes, or waives with a reason. Every
 * change is recorded on the cleaner's history and, for a hire, on Recruiter's handoff too.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, managerMutation, ownerMutation, type MemberAccess } from "./lib/builders";
import { companyDefinitions } from "./lib/cleaners/records";
import { ENGAGEMENTS, requirementEffectValidator, requirementKindValidator, engagementValidator } from "./lib/cleaners/schema";
import { DAY, DEFAULT_DEFINITIONS, type Definition } from "./lib/cleaners/settings";
import { syncHandoffRequirement } from "./lib/cleaners/handoff";
import { notAllowed, userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { isManager, isOwner, type Role } from "./lib/roles";
import { optionalText, text } from "./lib/text";

// ── The template ─────────────────────────────────────────────────────────────────────────────────

export const template = companyQuery({
  args: {},
  handler: async (ctx) => {
    const definitions = await companyDefinitions(ctx, ctx.company);
    const rows = await ctx.db
      .query("workerRequirements")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId))
      .take(15000);
    const assigned = new Map<string, number>();
    for (const row of rows) assigned.set(row.key, (assigned.get(row.key) ?? 0) + 1);
    return {
      saved: definitions.length > 0 && !definitions[0].isDefault,
      definitions: definitions.map((def) => ({ ...def, assignedTo: assigned.get(def.key) ?? 0 })),
      engagements: ENGAGEMENTS,
    };
  },
});

/** The first time an Owner changes the template, the starting template becomes the company's own rows. */
async function materialize(ctx: MutationCtx & MemberAccess): Promise<void> {
  const existing = await ctx.db
    .query("requirementDefinitions")
    .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId))
    .take(1);
  if (existing.length > 0) return;
  const start = await companyDefinitions(ctx, ctx.company);
  for (const def of start) await insertDefinition(ctx, def);
}

async function insertDefinition(ctx: MutationCtx & MemberAccess, def: Omit<Definition, "isDefault">) {
  await ctx.db.insert("requirementDefinitions", {
    companyId: ctx.companyId,
    key: def.key,
    label: def.label,
    description: def.description,
    kind: def.kind,
    effect: def.effect,
    appliesTo: def.appliesTo,
    reviewer: def.reviewer,
    validForDays: def.validForDays,
    providedBy: def.providedBy,
    forServices: def.forServices,
    cleanerCompletes: def.cleanerCompletes,
    agreementDocType: def.agreementDocType,
    order: def.order,
    status: "active",
    updatedBy: ctx.member._id,
    updatedAt: Date.now(),
  });
}

const definitionInput = {
  key: v.optional(v.string()),
  label: v.string(),
  description: v.optional(v.string()),
  kind: requirementKindValidator,
  effect: requirementEffectValidator,
  appliesTo: v.array(engagementValidator),
  reviewer: v.union(v.literal("manager"), v.literal("owner")),
  validForDays: v.optional(v.union(v.number(), v.null())),
  providedBy: v.optional(v.union(v.literal("company"), v.literal("cleaner"), v.literal("crew"), v.null())),
  forServices: v.optional(v.array(v.string())),
  cleanerCompletes: v.boolean(),
  agreementDocType: v.optional(v.union(v.string(), v.null())),
};

function keyFrom(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "requirement";
}

/** Adds or changes one requirement. A change applies to everyone who has it; a new one applies to new people until it is added to others on purpose. */
export const saveDefinition = ownerMutation({
  args: definitionInput,
  handler: async (ctx, args) => {
    await materialize(ctx);
    const label = text(args.label, "The requirement's name", 80);
    if (args.appliesTo.length === 0) throw userError("Choose who it applies to.");
    if (args.validForDays !== undefined && args.validForDays !== null && (!Number.isInteger(args.validForDays) || args.validForDays < 1 || args.validForDays > 3650)) throw userError("Validity is a whole number of days, from 1 to 3650.");
    if (args.kind !== "equipment" && args.providedBy) throw userError("Only equipment has a provider.");
    if (args.kind === "equipment" && !args.providedBy) throw userError("Say who provides the equipment: the company, the cleaner or the crew.");
    const forServices = [...new Set((args.forServices ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    const rows = await ctx.db
      .query("requirementDefinitions")
      .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId))
      .take(200);
    const key = args.key ?? keyFrom(label);
    const current = rows.find((row) => row.key === key);
    const fields = {
      label,
      description: optionalText(args.description, "The description", 400),
      kind: args.kind,
      effect: args.effect,
      appliesTo: [...new Set(args.appliesTo)],
      reviewer: args.reviewer,
      validForDays: args.validForDays ?? undefined,
      providedBy: args.providedBy ?? undefined,
      forServices,
      cleanerCompletes: args.cleanerCompletes,
      agreementDocType: args.agreementDocType ?? undefined,
      status: "active" as const,
      updatedBy: ctx.member._id,
      updatedAt: Date.now(),
    };
    if (current) {
      await ctx.db.patch(current._id, fields);
      await recordEvent(ctx, { companyId: ctx.companyId, type: "requirement.changed", actor: byMember(ctx), subject: { table: "requirementDefinitions", id: current._id }, data: { key } });
      return key;
    }
    if (args.key) throw userError("That requirement is not in the template.");
    if (rows.some((row) => row.key === key)) throw userError("A requirement with that name already exists.");
    const id = await ctx.db.insert("requirementDefinitions", { companyId: ctx.companyId, key, order: Math.max(0, ...rows.map((row) => row.order)) + 10, ...fields });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "requirement.added", actor: byMember(ctx), subject: { table: "requirementDefinitions", id }, data: { key } });
    return key;
  },
});

/** Takes a requirement out of the template. People keep their record of it, and it stops counting. */
export const retireDefinition = ownerMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    await materialize(ctx);
    const row = (
      await ctx.db
        .query("requirementDefinitions")
        .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("key", args.key))
        .take(1)
    )[0];
    if (!row) throw userError("That requirement is not in the template.");
    await ctx.db.patch(row._id, { status: "retired", updatedBy: ctx.member._id, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "requirement.retired", actor: byMember(ctx), subject: { table: "requirementDefinitions", id: row._id }, data: { key: args.key } });
    return null;
  },
});

/** Puts the starting template back, keeping the company's own requirements retired rather than removed. */
export const restoreDefaults = ownerMutation({
  args: {},
  handler: async (ctx) => {
    await materialize(ctx);
    const rows = await ctx.db
      .query("requirementDefinitions")
      .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId))
      .take(200);
    for (const def of DEFAULT_DEFINITIONS) {
      const row = rows.find((item) => item.key === def.key);
      if (row) await ctx.db.patch(row._id, { label: def.label, description: def.description, kind: def.kind, effect: def.effect, appliesTo: def.appliesTo, reviewer: def.reviewer, validForDays: def.validForDays, providedBy: def.providedBy, forServices: def.forServices, cleanerCompletes: def.cleanerCompletes, status: "active", updatedBy: ctx.member._id, updatedAt: Date.now() });
      else await insertDefinition(ctx, def);
    }
    return null;
  },
});

// ── Reviewing one cleaner's requirement ──────────────────────────────────────────────────────────

function mayReview(role: Role, def: Pick<Definition, "reviewer">): boolean {
  return def.reviewer === "owner" ? isOwner(role) : isManager(role);
}

async function rowFor(ctx: (QueryCtx | MutationCtx) & { companyId: Id<"companies"> }, cleanerId: Id<"cleaners">, key: string): Promise<Doc<"workerRequirements"> | null> {
  return (
    await ctx.db
      .query("workerRequirements")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleanerId).eq("key", key))
      .take(1)
  )[0] ?? null;
}

async function definitionFor(ctx: (QueryCtx | MutationCtx) & { company: Doc<"companies"> }, key: string): Promise<Definition> {
  const def = (await companyDefinitions(ctx, ctx.company)).find((row) => row.key === key);
  if (!def) throw userError("That requirement is no longer in the template.");
  return def;
}

const WORDS = { accept: "accepted", needs_changes: "asked for changes to", waive: "waived", reopen: "reopened" } as const;

/**
 * accept: a person checked it. needs_changes: what is wrong goes back to the cleaner. waive: set aside, with
 * a reason, by whoever the template names. reopen: back to not started, for example when a document must be
 * replaced. Who may do each is the template's reviewer for that requirement.
 */
export const review = companyMutation({
  args: {
    cleanerId: v.id("cleaners"),
    key: v.string(),
    decision: v.union(v.literal("accept"), v.literal("needs_changes"), v.literal("waive"), v.literal("reopen")),
    note: v.optional(v.string()),
    /** Overrides the template's validity for this acceptance, for example a document's real expiry date. */
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const def = await definitionFor(ctx, args.key);
    if (!mayReview(ctx.role, def)) notAllowed();
    if (cleaner.status === "ended") throw userError("This engagement has ended. Its record is kept as it was.");
    const row = await rowFor(ctx, cleaner._id, args.key);
    if (!row) throw userError(`${def.label} is not part of ${cleaner.name}'s onboarding. Add it first.`);
    const note = optionalText(args.note, "The note", 1000);
    const now = Date.now();
    if (args.decision === "needs_changes" && !note) throw userError("Say what needs to change. The cleaner reads it.");
    if (args.decision === "waive" && !note) throw userError("Say why it is waived. It is kept on their record.");
    if (args.decision === "accept" && def.kind === "agreement" && !note) throw userError("Say how it was signed, for example a paper copy kept at the office. An agreement signed in Agreements counts by itself.");
    if (args.decision === "accept" && (def.kind === "availability" || def.kind === "service_areas")) throw userError(`${def.label} is read from their record: add it there.`);
    if (args.expiresAt !== undefined && (!Number.isSafeInteger(args.expiresAt) || args.expiresAt <= now)) throw userError("An expiry date must be in the future.");
    const patch: Partial<Doc<"workerRequirements">> =
      args.decision === "accept"
        ? { status: "accepted", reviewedAt: now, reviewedBy: ctx.member._id, reviewNote: note, acceptedAt: now, expiresAt: args.expiresAt ?? (def.validForDays ? now + def.validForDays * DAY : undefined), waiver: undefined }
        : args.decision === "needs_changes"
          ? { status: "needs_changes", reviewedAt: now, reviewedBy: ctx.member._id, reviewNote: note, acceptedAt: undefined, expiresAt: undefined }
          : args.decision === "waive"
            ? { status: "waived", reviewedAt: now, reviewedBy: ctx.member._id, waiver: { by: ctx.member._id, at: now, reason: note! }, acceptedAt: undefined, expiresAt: undefined }
            : { status: "not_started", reviewedAt: now, reviewedBy: ctx.member._id, reviewNote: note, acceptedAt: undefined, expiresAt: undefined, waiver: undefined };
    await ctx.db.patch(row._id, { ...patch, updatedAt: now });
    const type = args.decision === "accept" ? "cleaner.requirement_accepted" : args.decision === "needs_changes" ? "cleaner.requirement_needs_changes" : args.decision === "waive" ? "cleaner.requirement_waived" : "cleaner.requirement_reset";
    await recordEvent(ctx, { companyId: ctx.companyId, type, actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { key: args.key } });
    await syncHandoffRequirement(ctx, cleaner, args.key, args.decision === "accept" || args.decision === "waive", byMember(ctx), note);
    return { words: `${def.label} ${WORDS[args.decision]}.` };
  },
});

/** A person records something on the cleaner's behalf, for example a document handed in at the office. It still needs a review. */
export const submitFor = managerMutation({
  args: { cleanerId: v.id("cleaners"), key: v.string(), text: v.optional(v.string()), storageIds: v.optional(v.array(v.id("_storage"))) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const def = await definitionFor(ctx, args.key);
    if (!mayReview(ctx.role, def)) notAllowed();
    const row = await rowFor(ctx, cleaner._id, args.key);
    if (!row) throw userError(`${def.label} is not part of ${cleaner.name}'s onboarding.`);
    await recordSubmission(ctx, row, { text: args.text, storageIds: args.storageIds ?? [] }, { kind: "member", memberId: ctx.member._id }, byMember(ctx));
    return null;
  },
});

export const uploadUrl = managerMutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Keeps what was submitted and marks the requirement awaiting review. Files are checked for type and size;
 * a file that is not a PDF or a photo is removed. Nothing is accepted here.
 */
export async function recordSubmission(
  ctx: MutationCtx,
  row: Doc<"workerRequirements">,
  input: { text?: string; storageIds: Id<"_storage">[] },
  by: Doc<"workerRequirements">["submittedBy"] & object,
  actor: Actor,
): Promise<void> {
  if (row.status === "accepted" || row.status === "waived") throw userError("This is already done. Ask the office if it needs to change.");
  if (input.storageIds.length > 5) throw userError("Send up to five files at a time.");
  const files = [...(row.status === "needs_changes" ? [] : (row.evidence?.files ?? []))];
  for (const storageId of input.storageIds) {
    const meta = await ctx.db.system.get(storageId);
    if (!meta) throw userError("A file did not finish uploading. Please try again.");
    if (!FILE_TYPES.includes(meta.contentType ?? "") || meta.size > MAX_FILE_BYTES) {
      await ctx.storage.delete(storageId);
      throw userError("Send a PDF or a photo, under 10 MB.");
    }
    files.push({ storageId, name: `${row.key}-${files.length + 1}.${(meta.contentType ?? "").split("/")[1] ?? "file"}`, contentType: meta.contentType ?? "", size: meta.size, uploadedAt: Date.now() });
  }
  const textValue = optionalText(input.text, "What you wrote", 1000);
  if (files.length === 0 && !textValue) throw userError("Add a file or a few words.");
  await ctx.db.patch(row._id, { status: "awaiting_review", evidence: { ...(row.evidence ?? {}), files: files.slice(-10), text: textValue ?? row.evidence?.text }, submittedAt: Date.now(), submittedBy: by, reviewNote: undefined, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: row.companyId, type: "cleaner.requirement_submitted", actor, subject: { table: "cleaners", id: row.cleanerId }, data: { key: row.key, files: files.length } });
}

/** A private address for one submitted file, for whoever reviews that requirement. */
export const fileUrl = companyQuery({
  args: { cleanerId: v.id("cleaners"), key: v.string(), index: v.number() },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const def = await definitionFor(ctx, args.key);
    if (!mayReview(ctx.role, def)) notAllowed();
    const row = await rowFor(ctx, cleaner._id, args.key);
    const file = row?.evidence?.files?.[args.index];
    if (!file) return null;
    return { url: await ctx.storage.getUrl(file.storageId), name: file.name, contentType: file.contentType };
  },
});

/** Runs every hour: an accepted requirement past its validity becomes expired, on the record and in the history. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("workerRequirements")
      .withIndex("by_status_expires", (q) => q.eq("status", "accepted").gt("expiresAt", 0).lte("expiresAt", Date.now()))
      .take(200);
    let expired = 0;
    for (const row of due) {
      if (row.expiresAt === undefined) continue;
      await ctx.db.patch(row._id, { status: "expired", updatedAt: Date.now() });
      await recordEvent(ctx, { companyId: row.companyId, type: "cleaner.requirement_expired", actor: { kind: "system" }, subject: { table: "cleaners", id: row.cleanerId }, data: { key: row.key } });
      expired += 1;
    }
    return expired;
  },
});
