/**
 * Where one worker stands on each of the company's onboarding requirements, worked out once, so readiness,
 * Dispatch's eligibility, the profile and the portal all read the same answer.
 *
 *  - An upload is never a verification: a document that needs review is "awaiting review" until a person
 *    accepts it.
 *  - Viewing an agreement is never signing it: an agreement requirement is met only by a linked workforce
 *    agreement whose signing is complete.
 *  - Starting payment setup is never completing it: the cleaner can say they started ("submitted"); only a
 *    person can accept it.
 *  - "Expired" is read from the clock, never stored.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { ReadinessCheck } from "./readiness";
import type { RequirementState } from "./schema";

type Ctx = QueryCtx | MutationCtx;

const DAY = 24 * 60 * 60 * 1000;
/** A document within this many days of expiring is listed under Needs attention. */
export const EXPIRY_WARNING_DAYS = 30;

export type RequirementFact = {
  requirement: Doc<"onboardingRequirements">;
  row: Doc<"workerRequirements"> | null;
  state: RequirementState;
  /** A person set it aside for this worker. Met, but never shown as accepted. */
  waived: boolean;
  met: boolean;
};

export async function activeRequirements(ctx: Ctx, companyId: Id<"companies">): Promise<Doc<"onboardingRequirements">[]> {
  const rows = await ctx.db
    .query("onboardingRequirements")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active"))
    .take(100);
  return rows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function appliesTo(requirement: Pick<Doc<"onboardingRequirements">, "appliesTo">, worker: Pick<Doc<"cleaners">, "engagement">): boolean {
  return requirement.appliesTo.includes(worker.engagement);
}

/** The state a requirement is in, from its row and the clock. */
export function stateOf(requirement: Doc<"onboardingRequirements">, row: Doc<"workerRequirements"> | null, now: number, agreementSigned: boolean): RequirementState {
  if (requirement.kind === "agreement") {
    // The Agreements workspace is the record of signing. A row here only says a person sent it back.
    if (agreementSigned) return "accepted";
    if (row?.state === "needs_changes") return "needs_changes";
    return row?.state === "submitted" || row?.state === "awaiting_review" ? row.state : "not_started";
  }
  if (!row) return "not_started";
  // An acknowledgment of older words is not an acknowledgment of the words in force now.
  if (requirement.kind === "acknowledgment" && row.version !== requirement.version && row.state === "accepted") return "not_started";
  if (row.state === "accepted" && row.expiresAt !== undefined && row.expiresAt <= now) return "expired";
  return row.state;
}

export function factFor(requirement: Doc<"onboardingRequirements">, row: Doc<"workerRequirements"> | null, now: number, agreementSigned: boolean): RequirementFact {
  const state = stateOf(requirement, row, now, agreementSigned);
  const waived = Boolean(row?.waived) && state !== "accepted";
  return { requirement, row, state, waived, met: state === "accepted" || waived };
}

const dateWords = (at: number, timezone: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" }).format(new Date(at));

/** The sentence a readiness check shows for one requirement. */
export function factDetail(fact: RequirementFact, timezone: string): string {
  const { requirement, row, state } = fact;
  if (fact.waived) return `Set aside by a person: ${row!.waived!.reason}`;
  switch (state) {
    case "not_started":
      return requirement.kind === "agreement" ? "No signed workforce agreement is linked to them yet." : "Not started.";
    case "submitted":
      return requirement.kind === "payment_setup" ? "They started payment setup. A person confirms it once it is complete." : requirement.kind === "agreement" ? "Sent for signature, not signed yet." : "Started, not complete yet.";
    case "awaiting_review":
      return "Submitted and waiting for a person to review it. Submitting is not the same as being accepted.";
    case "needs_changes":
      return row?.feedback ? `Sent back for changes: ${row.feedback}` : "Sent back for changes.";
    case "expired":
      return `Expired on ${dateWords(row!.expiresAt!, timezone)}.`;
    case "accepted":
      if (requirement.kind === "agreement") return "A linked workforce agreement is signed.";
      if (requirement.kind === "acknowledgment") return `They agreed${row?.acknowledged ? ` on ${dateWords(row.acknowledged.at, timezone)}` : ""}.`;
      return row?.expiresAt ? `Accepted. Valid until ${dateWords(row.expiresAt, timezone)}.` : "Accepted by a person.";
  }
}

export function requirementCheck(fact: RequirementFact, timezone: string): ReadinessCheck {
  return {
    key: `req:${fact.requirement._id}`,
    label: fact.requirement.label,
    state: fact.met ? "met" : "unmet",
    blocks: fact.requirement.blocks,
    detail: factDetail(fact, timezone),
    section: "onboarding",
  };
}

/** Workforce agreements linked to each worker that are fully signed, for the whole company or one worker. */
export async function signedAgreementsBy(ctx: Ctx, companyId: Id<"companies">, only?: Id<"cleaners">): Promise<Set<string>> {
  const links = await ctx.db
    .query("agreementLinks")
    .withIndex("by_company_record", (q) => (only ? q.eq("companyId", companyId).eq("table", "cleaners").eq("recordId", only) : q.eq("companyId", companyId).eq("table", "cleaners")))
    .take(2000);
  const signed = new Set<string>();
  for (const link of links) {
    const agreement = await ctx.db.get(link.agreementId);
    if (agreement && agreement.companyId === companyId && agreement.category === "workforce" && agreement.workflow === "signed") signed.add(link.recordId);
  }
  return signed;
}

/** Every applicable requirement and where this worker stands on it. */
export async function workerFacts(ctx: Ctx, worker: Doc<"cleaners">, now: number, preloaded?: { requirements: Doc<"onboardingRequirements">[]; rows: Doc<"workerRequirements">[]; signed: boolean }): Promise<RequirementFact[]> {
  const requirements = preloaded?.requirements ?? (await activeRequirements(ctx, worker.companyId));
  const rows =
    preloaded?.rows ??
    (await ctx.db
      .query("workerRequirements")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", worker.companyId).eq("cleanerId", worker._id))
      .take(200));
  const signed = preloaded?.signed ?? (await signedAgreementsBy(ctx, worker.companyId, worker._id)).has(worker._id);
  return requirements.filter((requirement) => appliesTo(requirement, worker)).map((requirement) => factFor(requirement, rows.find((row) => row.requirementId === requirement._id) ?? null, now, signed));
}

/**
 * The labels of the unmet requirements that stop this worker being offered work. Dispatch reads this
 * before ranking and again when an offer is accepted, so a requirement that blocks assignments blocks
 * them everywhere.
 */
export async function assignmentBlockers(ctx: Ctx, worker: Doc<"cleaners">, now: number): Promise<string[]> {
  const facts = await workerFacts(ctx, worker, now);
  return facts.filter((fact) => fact.requirement.blocks === "assignments" && !fact.met).map((fact) => fact.requirement.label);
}

/** Accepted documents that expire within the warning window, for the attention list. */
export function expiringSoon(facts: RequirementFact[], now: number): RequirementFact[] {
  return facts.filter((fact) => fact.state === "accepted" && !fact.waived && fact.row?.expiresAt !== undefined && fact.row.expiresAt - now <= EXPIRY_WARNING_DAYS * DAY);
}

/** Where onboarding stands in a phrase, for the directory's onboarding-stage filter. */
export type OnboardingStage = "none" | "not_started" | "in_progress" | "awaiting_review" | "needs_changes" | "complete";

export function stageOf(facts: RequirementFact[]): OnboardingStage {
  if (facts.length === 0) return "none";
  if (facts.every((fact) => fact.met)) return "complete";
  if (facts.some((fact) => fact.state === "needs_changes" || fact.state === "expired")) return "needs_changes";
  if (facts.some((fact) => fact.state === "awaiting_review")) return "awaiting_review";
  if (facts.every((fact) => fact.state === "not_started" && !fact.waived)) return "not_started";
  return "in_progress";
}

/** A requirement may be reviewed or waived by this role. */
export function mayReview(requirement: Pick<Doc<"onboardingRequirements">, "reviewBy">, role: "owner" | "manager" | "office"): boolean {
  return requirement.reviewBy === "owner" ? role === "owner" : role === "owner" || role === "manager";
}
