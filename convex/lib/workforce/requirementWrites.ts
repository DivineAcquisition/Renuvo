/**
 * Changing where a worker stands on a requirement. Shared by the office (convex/requirements.ts) and the
 * cleaner's own portal (convex/portal.ts), so a submission means the same thing whoever makes it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";

type By = { kind: "member"; memberId: Id<"members"> } | { kind: "cleaner"; cleanerId: Id<"cleaners"> };

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];

export async function rowFor(ctx: MutationCtx, worker: Doc<"cleaners">, requirement: Doc<"onboardingRequirements">): Promise<Doc<"workerRequirements"> | null> {
  const rows = await ctx.db
    .query("workerRequirements")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", worker.companyId).eq("cleanerId", worker._id))
    .take(200);
  return rows.find((row) => row.requirementId === requirement._id) ?? null;
}

async function upsert(ctx: MutationCtx, worker: Doc<"cleaners">, requirement: Doc<"onboardingRequirements">, change: Partial<Doc<"workerRequirements">>): Promise<Doc<"workerRequirements">> {
  const row = await rowFor(ctx, worker, requirement);
  const now = Date.now();
  if (row) {
    await ctx.db.patch(row._id, { ...change, version: requirement.version, updatedAt: now });
    return (await ctx.db.get(row._id))!;
  }
  const id = await ctx.db.insert("workerRequirements", { companyId: worker.companyId, cleanerId: worker._id, requirementId: requirement._id, version: requirement.version, state: "submitted", documentIds: [], updatedAt: now, ...change });
  return (await ctx.db.get(id))!;
}

const actorOf = (by: By): Actor => (by.kind === "member" ? { kind: "member", memberId: by.memberId } : { kind: "cleaner_portal", cleanerId: by.cleanerId });

function checkApplies(worker: Doc<"cleaners">, requirement: Doc<"onboardingRequirements">) {
  if (requirement.companyId !== worker.companyId || requirement.status !== "active") throw userError("That requirement is no longer in use.");
  if (!requirement.appliesTo.includes(worker.engagement)) throw userError("That requirement does not apply to this worker.");
  if (worker.status === "ended") throw userError("Their engagement has ended.");
}

/** The cleaner agrees to the requirement's exact words. Only the cleaner can do this, and it needs no review. */
export async function acknowledge(ctx: MutationCtx, worker: Doc<"cleaners">, requirement: Doc<"onboardingRequirements">, cleanerId: Id<"cleaners">, statementSeen: string): Promise<void> {
  checkApplies(worker, requirement);
  if (requirement.kind !== "acknowledgment" || !requirement.statement) throw userError("That requirement is not something to agree to.");
  // The words shown must be the words in force: an older page cannot agree to newer words.
  if (statementSeen.trim() !== requirement.statement.trim()) throw userError("These words changed since the page was opened. Read them again before agreeing.");
  const now = Date.now();
  await upsert(ctx, worker, requirement, { state: requirement.needsReview ? "awaiting_review" : "accepted", submittedAt: now, submittedBy: { kind: "cleaner", cleanerId }, acknowledged: { statement: requirement.statement, at: now }, feedback: undefined });
  await recordEvent(ctx, { companyId: worker.companyId, type: "cleaner.requirement_acknowledged", actor: { kind: "cleaner_portal", cleanerId }, subject: { table: "cleaners", id: worker._id }, data: { requirementId: requirement._id } });
}

/** Says a requirement was started (payment setup, training). Started is never complete. */
export async function markStarted(ctx: MutationCtx, worker: Doc<"cleaners">, requirement: Doc<"onboardingRequirements">, by: By): Promise<void> {
  checkApplies(worker, requirement);
  if (requirement.kind !== "payment_setup" && requirement.kind !== "training" && requirement.kind !== "equipment" && requirement.kind !== "custom") throw userError("This requirement is not marked as started this way.");
  const row = await rowFor(ctx, worker, requirement);
  if (row && (row.state === "accepted" || row.state === "awaiting_review")) return;
  await upsert(ctx, worker, requirement, { state: "submitted", submittedAt: Date.now(), submittedBy: by });
  await recordEvent(ctx, { companyId: worker.companyId, type: "cleaner.requirement_started", actor: actorOf(by), subject: { table: "cleaners", id: worker._id }, data: { requirementId: requirement._id } });
}

/** Marks a requirement complete and waiting for a person (equipment confirmed, training done, a custom item). */
export async function markDone(ctx: MutationCtx, worker: Doc<"cleaners">, requirement: Doc<"onboardingRequirements">, by: By): Promise<void> {
  checkApplies(worker, requirement);
  if (requirement.kind === "document" || requirement.kind === "acknowledgment" || requirement.kind === "agreement") throw userError("This requirement is completed another way.");
  await upsert(ctx, worker, requirement, { state: requirement.needsReview || requirement.kind === "payment_setup" ? "awaiting_review" : "accepted", submittedAt: Date.now(), submittedBy: by, feedback: undefined });
  await recordEvent(ctx, { companyId: worker.companyId, type: "cleaner.requirement_submitted", actor: actorOf(by), subject: { table: "cleaners", id: worker._id }, data: { requirementId: requirement._id } });
}

/**
 * A file for a document requirement, from storage the uploader was just given. The file's own size and
 * type are read from storage, never taken from the caller. The requirement then waits for a person:
 * an upload is not a verification. The same file sent twice (same `clientKey`) is kept once.
 */
export async function attachDocument(ctx: MutationCtx, worker: Doc<"cleaners">, requirement: Doc<"onboardingRequirements">, by: By, input: { storageId: Id<"_storage">; fileName: string; clientKey: string }): Promise<Id<"workerDocuments">> {
  checkApplies(worker, requirement);
  if (requirement.kind !== "document") throw userError("This requirement does not take a file.");
  const existing = await ctx.db
    .query("workerDocuments")
    .withIndex("by_company_key", (q) => q.eq("companyId", worker.companyId).eq("cleanerId", worker._id).eq("clientKey", input.clientKey.slice(0, 80)))
    .first();
  if (existing) return existing._id;
  const meta = await ctx.db.system.get(input.storageId);
  if (!meta) throw userError("The file did not arrive. Try again.");
  const contentType = meta.contentType ?? "";
  if (!ALLOWED_TYPES.includes(contentType)) {
    await ctx.storage.delete(input.storageId);
    throw userError("Send a PDF or a photo (JPEG, PNG, HEIC or WebP).");
  }
  if (meta.size > MAX_DOCUMENT_BYTES) {
    await ctx.storage.delete(input.storageId);
    throw userError("That file is larger than 15 MB.");
  }
  const documentId = await ctx.db.insert("workerDocuments", {
    companyId: worker.companyId,
    cleanerId: worker._id,
    requirementId: requirement._id,
    storageId: input.storageId,
    fileName: input.fileName.trim().slice(0, 160) || "Document",
    contentType,
    size: meta.size,
    uploadedBy: by,
    clientKey: input.clientKey.slice(0, 80),
    uploadedAt: Date.now(),
  });
  const row = await rowFor(ctx, worker, requirement);
  await upsert(ctx, worker, requirement, { state: "awaiting_review", submittedAt: Date.now(), submittedBy: by, documentIds: [...(row?.documentIds ?? []), documentId].slice(-10), feedback: undefined, expiresAt: undefined });
  await recordEvent(ctx, { companyId: worker.companyId, type: "cleaner.requirement_submitted", actor: actorOf(by), subject: { table: "cleaners", id: worker._id }, data: { requirementId: requirement._id, file: true } });
  return documentId;
}

/** A person accepts what was submitted, or sends it back with words the cleaner will see. */
export async function review(
  ctx: MutationCtx,
  worker: Doc<"cleaners">,
  requirement: Doc<"onboardingRequirements">,
  member: Doc<"members">,
  input: { decision: "accept" | "needs_changes"; feedback?: string; note?: string; validUntil?: number },
): Promise<void> {
  checkApplies(worker, requirement);
  if (requirement.kind === "agreement") throw userError("Agreements are signed in Agreements. Their signing is what meets this requirement.");
  if (requirement.kind === "acknowledgment" && input.decision === "accept") {
    const row = await rowFor(ctx, worker, requirement);
    if (!row?.acknowledged || row.version !== requirement.version) throw userError("Only the cleaner can agree to these words. Nothing from them is on record yet.");
  }
  const row = await rowFor(ctx, worker, requirement);
  if (requirement.kind === "document" && input.decision === "accept" && (!row || row.documentIds.length === 0)) throw userError("No file was submitted. Upload it first, or set the requirement aside with a reason.");
  const feedback = input.feedback?.trim().slice(0, 500) || undefined;
  if (input.decision === "needs_changes" && !feedback) throw userError("Say what needs to change. The cleaner will see these words.");
  const now = Date.now();
  let expiresAt: number | undefined;
  if (input.decision === "accept" && requirement.kind === "document") {
    if (input.validUntil !== undefined) {
      if (!Number.isSafeInteger(input.validUntil) || input.validUntil <= now) throw userError("The expiry date must be in the future.");
      expiresAt = input.validUntil;
    } else if (requirement.validMonths) {
      const date = new Date(now);
      date.setUTCMonth(date.getUTCMonth() + requirement.validMonths);
      expiresAt = date.getTime();
    }
  }
  await upsert(ctx, worker, requirement, {
    state: input.decision === "accept" ? "accepted" : "needs_changes",
    reviewedAt: now,
    reviewedBy: member._id,
    feedback: input.decision === "needs_changes" ? feedback : undefined,
    note: input.note?.trim().slice(0, 1000) || row?.note,
    expiresAt,
  });
  await recordEvent(ctx, { companyId: worker.companyId, type: input.decision === "accept" ? "cleaner.requirement_accepted" : "cleaner.requirement_returned", actor: { kind: "member", memberId: member._id }, subject: { table: "cleaners", id: worker._id }, data: { requirementId: requirement._id } });
}

/** A person sets a requirement aside for this worker, with the reason. It is recorded as waived, never as accepted. */
export async function waive(ctx: MutationCtx, worker: Doc<"cleaners">, requirement: Doc<"onboardingRequirements">, member: Doc<"members">, reason: string | null): Promise<void> {
  checkApplies(worker, requirement);
  const row = await rowFor(ctx, worker, requirement);
  if (reason === null) {
    if (!row?.waived) return;
    await ctx.db.patch(row._id, { waived: undefined, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: worker.companyId, type: "cleaner.requirement_unwaived", actor: { kind: "member", memberId: member._id }, subject: { table: "cleaners", id: worker._id }, data: { requirementId: requirement._id } });
    return;
  }
  const why = reason.trim();
  if (why.length < 3) throw userError("Say why it is being set aside.");
  await upsert(ctx, worker, requirement, { state: row?.state ?? "submitted", waived: { by: member._id, at: Date.now(), reason: why.slice(0, 500) } });
  await recordEvent(ctx, { companyId: worker.companyId, type: "cleaner.requirement_waived", actor: { kind: "member", memberId: member._id }, subject: { table: "cleaners", id: worker._id }, data: { requirementId: requirement._id } });
}
