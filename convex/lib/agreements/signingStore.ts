/**
 * The signing workflow's records. A request names one exact version and its hash; a provider's reports
 * move it along; nothing here believes an email was a signature. Every transition is conditional on the
 * state it starts from, so a report that arrives twice, late or out of order changes nothing it should not.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { can, mayRead } from "./access";
import { signingStatus, type ProviderEvent } from "./signing";
import { isEmailAddress } from "./validators";
import { readiness, type Ctx, typeOf, versionRow } from "./store";

const DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_EXPIRY_DAYS = 14;
export const REMINDER_GAP_MS = DAY;
const OPEN: Doc<"agreementSignatureRequests">["status"][] = ["queued", "sent", "partially_signed"];
export const isOpen = (status: Doc<"agreementSignatureRequests">["status"]) => OPEN.includes(status);

export async function openRequest(ctx: MutationCtx | Ctx, agreement: Doc<"agreements">) {
  const rows = await ctx.db.query("agreementSignatureRequests").withIndex("by_company_agreement", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id)).order("desc").take(20);
  return rows.find((row) => isOpen(row.status)) ?? null;
}

/** Why this agreement cannot be sent right now, or null. Used by the send action and to explain a disabled button. */
export async function sendBlockers(ctx: Ctx, agreement: Doc<"agreements">): Promise<string[]> {
  const out: string[] = [];
  const status = signingStatus();
  if (!status.configured) out.push(status.why);
  if (!can(ctx.role, "send") || !mayRead(ctx.role, agreement.access) || (agreement.access === "restricted" && ctx.role !== "owner")) out.push("Your role cannot send this document for signature.");
  if (agreement.archivedAt) out.push("This agreement is archived.");
  if (agreement.workflow !== "approved") out.push(agreement.workflow === "draft" || agreement.workflow === "needs_review" ? "It needs to be approved first." : `It is ${agreement.workflow.replace(/_/g, " ")}.`);
  if (agreement.approvedVersion !== agreement.currentVersion) out.push("The approved version is not the current version. Review the current version.");
  const current = await versionRow(ctx, agreement);
  if (agreement.approvedHash !== current.hash) out.push("The text changed after approval. Approve the current version.");
  if (current.unresolved.length) out.push(`${current.unresolved.length} item${current.unresolved.length === 1 ? " is" : "s are"} still marked TO CONFIRM.`);
  const ready = await readiness(ctx, agreement);
  if (ready.errors.length) out.push(...ready.errors);
  const signers = agreement.parties.filter((party) => party.signer);
  if (signers.length === 0) out.push("No signer is named.");
  for (const signer of signers) if (!signer.email || !isEmailAddress(signer.email)) out.push(`${signer.name || "A signer"} needs a valid email address.`);
  if (await openRequest(ctx, agreement)) out.push("A signature request is already open. Withdraw it first.");
  void typeOf;
  return out;
}

export async function startRequest(ctx: Ctx, agreement: Doc<"agreements">, input: { expiresInDays?: number }): Promise<Id<"agreementSignatureRequests">> {
  const blockers = await sendBlockers(ctx, agreement);
  if (blockers.length) throw userError(blockers.join(" "));
  const days = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw userError("A signing request can stay open for 1 to 90 days.");
  const current = await versionRow(ctx, agreement);
  const status = signingStatus();
  const now = Date.now();
  const signers = agreement.parties
    .filter((party) => party.signer)
    .map((party, index) => ({ role: party.role, name: party.name, email: party.email!.trim().toLowerCase(), order: party.order ?? index + 1, status: "pending" as const }))
    .sort((a, b) => a.order - b.order);
  const id = await ctx.db.insert("agreementSignatureRequests", { companyId: agreement.companyId, agreementId: agreement._id, version: current.version, hash: current.hash, provider: status.provider!, status: "queued", signers, expiresAt: now + days * DAY, sentBy: ctx.member._id, createdAt: now, reminders: 0 });
  await ctx.db.patch(agreement._id, { workflow: "sent", sentVersion: current.version, updatedAt: now });
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.signature_requested", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "agreementSignatureRequests", id }, data: { version: current.version, signers: signers.length } });
  return id;
}

/** The provider accepted the request and began delivery. This is not delivery to a person and not a signature. */
export async function markDispatched(ctx: MutationCtx, requestId: Id<"agreementSignatureRequests">, providerRequestId: string) {
  const request = await ctx.db.get(requestId);
  if (!request || request.status !== "queued") return false;
  await ctx.db.patch(request._id, { status: "sent", providerRequestId, sentAt: Date.now() });
  return true;
}

export async function markDispatchFailed(ctx: MutationCtx, requestId: Id<"agreementSignatureRequests">, problem: string) {
  const request = await ctx.db.get(requestId);
  if (!request || request.status !== "queued") return false;
  await ctx.db.patch(request._id, { status: "failed", problem: problem.slice(0, 300) });
  const agreement = await ctx.db.get(request.agreementId);
  if (agreement && agreement.workflow === "sent") await ctx.db.patch(agreement._id, { workflow: "delivery_failed", updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: request.companyId, type: "agreement.delivery_failed", actor: { kind: "system" }, subject: { table: "agreementSignatureRequests", id: request._id } });
  return true;
}

export type Applied = "applied" | "duplicate" | "unknown_request" | "ignored";

/**
 * Applies one provider report. The event id is recorded in the same transaction, so the same report
 * delivered twice (or concurrently) is applied once. A report for a request that has ended is recorded
 * and ignored.
 */
export async function applyEvent(ctx: MutationCtx, provider: string, event: ProviderEvent): Promise<{ outcome: Applied; requestId?: Id<"agreementSignatureRequests">; completed?: boolean }> {
  const seen = await ctx.db.query("agreementProviderEvents").withIndex("by_provider_event", (q) => q.eq("provider", provider).eq("eventId", event.eventId)).first();
  if (seen) return { outcome: "duplicate" };
  await ctx.db.insert("agreementProviderEvents", { provider, eventId: event.eventId, at: Date.now() });
  const request = await ctx.db.query("agreementSignatureRequests").withIndex("by_provider_request", (q) => q.eq("provider", provider).eq("providerRequestId", event.requestId)).first();
  if (!request) return { outcome: "unknown_request" };
  if (!isOpen(request.status)) return { outcome: "ignored", requestId: request._id };
  const agreement = await ctx.db.get(request.agreementId);
  if (!agreement) return { outcome: "ignored", requestId: request._id };
  const system: Actor = { kind: "system" };
  const now = event.at;
  const signers = request.signers.map((signer) => ({ ...signer }));
  const target = event.signerEmail ? signers.find((signer) => signer.email === event.signerEmail) : undefined;
  const log = (type: string, data?: Record<string, string | number | boolean>) => recordEvent(ctx, { companyId: request.companyId, type, actor: system, subject: { table: "agreementSignatureRequests", id: request._id }, data });

  switch (event.type) {
    case "delivered":
      if (target && target.status === "pending") {
        target.status = "delivered";
        target.deliveredAt = now;
      }
      break;
    case "viewed":
      if (target && (target.status === "pending" || target.status === "delivered")) {
        target.status = "viewed";
        target.viewedAt = now;
      }
      break;
    case "signed":
      if (target && target.status !== "signed" && target.status !== "declined") {
        target.status = "signed";
        target.signedAt = now;
      }
      break;
    case "bounced":
      if (target && target.status !== "signed") {
        target.status = "bounced";
        target.problem = (event.problem ?? "The email could not be delivered.").slice(0, 200);
      }
      break;
    case "declined": {
      if (target) target.status = "declined";
      await ctx.db.patch(request._id, { signers, status: "declined" });
      if (agreement.workflow !== "signed") await ctx.db.patch(agreement._id, { workflow: "declined", updatedAt: Date.now() });
      await log("agreement.declined");
      return { outcome: "applied", requestId: request._id };
    }
    case "expired":
      await ctx.db.patch(request._id, { signers, status: "expired" });
      if (agreement.workflow !== "signed") await ctx.db.patch(agreement._id, { workflow: "expired", updatedAt: Date.now() });
      await log("agreement.signing_expired");
      return { outcome: "applied", requestId: request._id };
    case "failed":
      await ctx.db.patch(request._id, { signers, status: "failed", problem: (event.problem ?? "The signing service reported a failure.").slice(0, 300) });
      if (agreement.workflow === "sent" || agreement.workflow === "partially_signed") await ctx.db.patch(agreement._id, { workflow: "delivery_failed", updatedAt: Date.now() });
      await log("agreement.delivery_failed");
      return { outcome: "applied", requestId: request._id };
    case "completed":
      break;
  }

  const allSigned = signers.every((signer) => signer.status === "signed");
  const anySigned = signers.some((signer) => signer.status === "signed");
  if (allSigned) {
    await ctx.db.patch(request._id, { signers, status: "completed", completedAt: now });
    const lifecycle = agreement.lifecycle.effectiveOn ? agreement.lifecycle : { ...agreement.lifecycle };
    await ctx.db.patch(agreement._id, { workflow: "signed", signedVersion: request.version, provenance: "provider_signed", lifecycle, updatedAt: Date.now() });
    await log("agreement.signed", { version: request.version });
    return { outcome: "applied", requestId: request._id, completed: true };
  }
  // A "completed" report with signers still unreported is never taken as full signature: the gap is recorded.
  const problem = event.type === "completed" ? "The provider reported the request complete, but not every signer was reported signed. It is not treated as fully signed." : request.problem;
  await ctx.db.patch(request._id, { signers, status: anySigned ? "partially_signed" : request.status, problem });
  if (anySigned && agreement.workflow === "sent") await ctx.db.patch(agreement._id, { workflow: "partially_signed", updatedAt: Date.now() });
  if (anySigned) await log("agreement.partially_signed", { signed: signers.filter((s) => s.status === "signed").length, of: signers.length });
  return { outcome: "applied", requestId: request._id };
}

export async function withdraw(ctx: Ctx, agreement: Doc<"agreements">, reason: string): Promise<Doc<"agreementSignatureRequests"> | null> {
  if (!can(ctx.role, "send") || !mayRead(ctx.role, agreement.access)) throw userError("Your role cannot withdraw a signature request.", "not_allowed");
  const request = await openRequest(ctx, agreement);
  if (!request) throw userError("There is no open signature request to withdraw.");
  await ctx.db.patch(request._id, { status: "withdrawn", withdrawnAt: Date.now(), problem: reason.trim().slice(0, 200) || undefined });
  await ctx.db.patch(agreement._id, { workflow: "withdrawn", updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.withdrawn", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "agreementSignatureRequests", id: request._id } });
  return (await ctx.db.get(request._id)) ?? null;
}

/** One reminder per signer per day. A second click, or a retry, finds the first and does nothing more. */
export async function remind(ctx: Ctx, agreement: Doc<"agreements">, signerEmail?: string): Promise<{ request: Doc<"agreementSignatureRequests">; emails: string[] }> {
  if (!can(ctx.role, "send") || !mayRead(ctx.role, agreement.access)) throw userError("Your role cannot send reminders.", "not_allowed");
  const request = await openRequest(ctx, agreement);
  if (!request || request.status === "queued") throw userError("There is no delivered signature request to remind about.");
  if (request.lastReminderAt && Date.now() - request.lastReminderAt < REMINDER_GAP_MS) throw userError("A reminder was already sent in the last day.");
  const pending = request.signers.filter((signer) => signer.status !== "signed" && signer.status !== "declined" && (!signerEmail || signer.email === signerEmail.trim().toLowerCase()));
  if (pending.length === 0) throw userError("Nobody is waiting to sign.");
  await ctx.db.patch(request._id, { reminders: request.reminders + 1, lastReminderAt: Date.now() });
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.reminder_sent", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "agreementSignatureRequests", id: request._id }, data: { signers: pending.length } });
  return { request, emails: pending.map((signer) => signer.email) };
}

/** Requests past their expiry are closed, and a signature that never came is not reported as one. */
export async function expireDue(ctx: MutationCtx, now: number): Promise<number> {
  let count = 0;
  for (const status of ["queued", "sent", "partially_signed"] as const) {
    const rows = await ctx.db.query("agreementSignatureRequests").withIndex("by_status_expires", (q) => q.eq("status", status).lt("expiresAt", now)).take(100);
    for (const request of rows) {
      await ctx.db.patch(request._id, { status: "expired" });
      const agreement = await ctx.db.get(request.agreementId);
      if (agreement && agreement.workflow !== "signed" && agreement.workflow !== "withdrawn") await ctx.db.patch(agreement._id, { workflow: "expired", updatedAt: now });
      await recordEvent(ctx, { companyId: request.companyId, type: "agreement.signing_expired", actor: { kind: "system" }, subject: { table: "agreementSignatureRequests", id: request._id } });
      count += 1;
    }
  }
  return count;
}
