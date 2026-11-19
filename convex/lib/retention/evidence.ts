/**
 * The evidence for a service concern, read from the records of the service it is about: what was agreed
 * (the scope the visit was booked with, the company's guarantee, the customer's signed terms), what the
 * crew recorded (checklist, photos, reports, the completion review), and what happened before at the
 * same property.
 *
 * Evidence is read, never judged here. In particular a photo is a record that a photo was taken: it does
 * not show that a task was done well, and it never cancels what a customer reported.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import { serviceTerms } from "../agreements/agents";
import { localParts } from "../availability";
import { jobAssignments } from "../dispatch/facts";
import { jobChecklist, jobEvidence } from "../dispatch/live";
import { areasIn, cleanAreas, DAY, sharedAreas } from "./cases";
import { retentionSettings } from "./settings";
import type { Basis, Source } from "./schema";

type Ctx = QueryCtx | MutationCtx;

export type Statement = { basis: Basis; text: string; source?: Source };

export type Evidence = {
  job: {
    id: Id<"jobs">;
    startsAt: number;
    service: string;
    status: Doc<"jobs">["status"];
    scope: string;
    included: string[];
    excluded: string[];
    priceCents: number | null;
    durationMinutes: number;
    isCorrection: boolean;
  } | null;
  checklist: { label: string; section: string | null; state: "pending" | "done" | "skipped"; skipReason: string | null; requiresPhoto: boolean; photos: number }[];
  photos: { before: number; after: number; item: number; issue: number };
  reports: { kind: string; text: string; status: string; at: number }[];
  crew: { cleanerId: Id<"cleaners">; name: string; payCents: number; reportedIncomplete: boolean }[];
  review: { decision: "closed" | "closed_without_review"; at: number; note: string | null } | null;
  returns: number;
  guarantee: { set: false } | { set: true; text: string; days: number; within: boolean | null };
  terms: { title: string; terms: Record<string, unknown> }[];
  prior: { caseId: Id<"retentionCases"> | null; feedbackId: Id<"retentionFeedback"> | null; jobId: Id<"jobs"> | null; at: number; areas: string[]; shared: string[]; outcome: string | null; correctionCompleted: boolean | null }[];
  preferences: { customer: string | null; property: string | null };
  /** What a complete picture would need that the record does not hold. */
  missing: string[];
};

function splitScope(scope: string): { included: string[]; excluded: string[] } {
  const included: string[] = [];
  let excluded: string[] = [];
  for (const line of scope.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) included.push(trimmed.slice(2));
    else if (/^not included:/i.test(trimmed)) excluded = trimmed.replace(/^not included:/i, "").replace(/\.$/, "").split(";").map((part) => part.trim()).filter(Boolean);
  }
  return { included, excluded };
}

/** Whether a checklist label or scope line is about one of the named areas. */
export function about(label: string, areas: string[]): string[] {
  return sharedAreas(areasIn(label), areas);
}

export async function gatherEvidence(ctx: Ctx, company: Doc<"companies">, row: Pick<Doc<"retentionCases">, "_id" | "companyId" | "customerId" | "propertyId" | "jobId" | "areas" | "createdAt">): Promise<Evidence> {
  const job = row.jobId ? await ctx.db.get(row.jobId) : null;
  const customer = await ctx.db.get(row.customerId);
  const property = row.propertyId ? await ctx.db.get(row.propertyId) : null;
  const settings = retentionSettings(company);
  const missing: string[] = [];
  const out: Evidence = {
    job: null,
    checklist: [],
    photos: { before: 0, after: 0, item: 0, issue: 0 },
    reports: [],
    crew: [],
    review: null,
    returns: 0,
    guarantee: settings.guarantee ? { set: true, text: settings.guarantee.text, days: settings.guarantee.days, within: null } : { set: false },
    terms: [],
    prior: [],
    preferences: { customer: customer?.preferences?.trim() || null, property: property?.clientNotes?.trim() || null },
    missing,
  };
  if (!settings.guarantee) missing.push("The company has not written its service guarantee in Retention's Playbook, so none is applied.");
  if (!job) {
    missing.push("No service is linked to this case, so there is no scope, checklist or photo record to read.");
  } else {
    const parts = splitScope(job.scope);
    out.job = {
      id: job._id,
      startsAt: job.startsAt,
      service: job.serviceSnapshot?.name ?? job.serviceType,
      status: job.status,
      scope: job.scope,
      included: parts.included,
      excluded: parts.excluded,
      priceCents: job.priceCents ?? null,
      durationMinutes: Math.round((job.endsAt - job.startsAt) / 60_000),
      isCorrection: job.recovery !== undefined,
    };
    if (out.guarantee.set) out.guarantee = { ...out.guarantee, within: row.createdAt <= job.endsAt + out.guarantee.days * DAY };
    const items = await jobChecklist(ctx, job);
    const photos = await jobEvidence(ctx, job);
    for (const photo of photos) out.photos[photo.kind] += 1;
    out.checklist = items.map((item) => ({ label: item.label, section: item.section ?? null, state: item.state, skipReason: item.skipReason ?? null, requiresPhoto: item.requiresPhoto, photos: photos.filter((p) => p.checklistItemId === item._id).length }));
    if (!items.length) missing.push("This visit had no checklist, so there is no record of which tasks were marked done.");
    if (!photos.length) missing.push("No photos were uploaded for this visit.");
    const reports = await ctx.db
      .query("jobReports")
      .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
      .take(50);
    out.reports = reports.map((r) => ({ kind: r.kind, text: r.text, status: r.status, at: r.createdAt }));
    for (const assignment of await jobAssignments(ctx, job)) {
      if (assignment.status !== "accepted") continue;
      const cleaner = await ctx.db.get(assignment.cleanerId);
      out.crew.push({ cleanerId: assignment.cleanerId, name: cleaner?.name ?? "A cleaner", payCents: assignment.payCents, reportedIncomplete: assignment.completion?.incomplete === true });
    }
    out.review = job.completionReview ? { decision: job.completionReview.decision, at: job.completionReview.at, note: job.completionReview.note ?? null } : null;
    if (job.status === "completed" && !job.completionReview) missing.push("This visit has no completion review on record.");
    out.returns = job.completionReturns ?? 0;
  }
  // The customer's signed terms about corrections, when an agreement governs this relationship.
  const terms = await serviceTerms({ ...(ctx as QueryCtx), company, role: "manager" }, { customerId: row.customerId, propertyId: row.propertyId });
  out.terms = terms.agreements.map((a) => ({ title: a.title, terms: a.terms as Record<string, unknown> }));
  // Earlier concerns at the same property: other cases, and feedback that described an issue.
  const propertyId = row.propertyId;
  if (propertyId) {
    const cases = await ctx.db
      .query("retentionCases")
      .withIndex("by_company_property", (q) => q.eq("companyId", row.companyId).eq("propertyId", propertyId))
      .order("desc")
      .take(50);
    for (const other of cases) {
      if (other._id === row._id || other.kind !== "recovery" || other.createdAt > row.createdAt) continue;
      out.prior.push({ caseId: other._id, feedbackId: null, jobId: other.jobId ?? null, at: other.createdAt, areas: other.areas, shared: sharedAreas(other.areas, row.areas), outcome: other.outcome?.code ?? null, correctionCompleted: other.verification ? other.verification.correctionCompletedAt !== undefined : null });
    }
    const feedback = await ctx.db
      .query("retentionFeedback")
      .withIndex("by_company_property", (q) => q.eq("companyId", row.companyId).eq("propertyId", propertyId))
      .order("desc")
      .take(50);
    for (const item of feedback) {
      if (!item.issue || item.jobId === row.jobId || item.submittedAt > row.createdAt) continue;
      if (item.caseId && out.prior.some((p) => p.caseId === item.caseId)) continue;
      const areas = cleanAreas(item.issue.areas);
      out.prior.push({ caseId: item.caseId ?? null, feedbackId: item._id, jobId: item.jobId, at: item.submittedAt, areas, shared: sharedAreas(areas, row.areas), outcome: null, correctionCompleted: null });
    }
  }
  return out;
}

/** The evidence as statements for the case history: each one says what it rests on and where it came from. */
export function statements(evidence: Evidence, row: Pick<Doc<"retentionCases">, "areas">, timezone: string): Statement[] {
  const out: Statement[] = [];
  const job = evidence.job;
  if (job) {
    const source: Source = { table: "jobs", id: job.id, label: `${job.service} on ${localParts(job.startsAt, timezone).day}`, at: job.startsAt };
    out.push({ basis: "fact", text: `The concern is about ${job.service} on ${localParts(job.startsAt, timezone).day}. It was booked with ${job.included.length} listed ${job.included.length === 1 ? "task" : "tasks"}${job.excluded.length ? ` and ${job.excluded.length} named ${job.excluded.length === 1 ? "exclusion" : "exclusions"}` : ""}.`, source });
    for (const area of row.areas) {
      const inScope = job.included.filter((line) => about(line, [area]).length);
      const outOfScope = job.excluded.filter((line) => about(line, [area]).length);
      const items = evidence.checklist.filter((item) => about(item.label, [area]).length);
      if (outOfScope.length) out.push({ basis: "fact", text: `"${outOfScope[0]}" is listed as not included in the service this visit was booked with.`, source });
      else if (inScope.length) out.push({ basis: "fact", text: `"${inScope[0]}" is part of the service this visit was booked with.`, source });
      for (const item of items) {
        if (item.state === "skipped") out.push({ basis: "fact", text: `The crew marked "${item.label}" skipped${item.skipReason ? `: ${item.skipReason}` : ", with no reason given"}.`, source });
        else if (item.state === "pending") out.push({ basis: "fact", text: `"${item.label}" was never marked done on the checklist.`, source });
        else out.push({ basis: "fact", text: `The crew marked "${item.label}" done${item.photos ? ` and uploaded ${item.photos} ${item.photos === 1 ? "photo" : "photos"} for it` : ""}. That records what the crew reported, not how the result looked to the customer.`, source });
      }
    }
    if (evidence.photos.before + evidence.photos.after > 0) out.push({ basis: "fact", text: `${evidence.photos.before} before and ${evidence.photos.after} after ${evidence.photos.before + evidence.photos.after === 1 ? "photo is" : "photos are"} on the visit.`, source });
    for (const report of evidence.reports) out.push({ basis: "fact", text: `The crew reported ${report.kind === "incomplete" ? "work left incomplete" : report.kind === "addon_request" ? "a request to add to the scope" : "a condition at the property"}: "${report.text.slice(0, 200)}".`, source });
    if (evidence.crew.some((c) => c.reportedIncomplete)) out.push({ basis: "fact", text: "A cleaner submitted the visit as incomplete.", source });
    if (evidence.review) out.push({ basis: "fact", text: evidence.review.decision === "closed" ? "A person reviewed the crew's report and closed the visit." : "The visit was closed without a review.", source });
    if (evidence.returns > 0) out.push({ basis: "fact", text: `The crew's report was sent back for correction ${evidence.returns} ${evidence.returns === 1 ? "time" : "times"} before the visit was closed.`, source });
  }
  if (evidence.guarantee.set) {
    out.push({ basis: "fact", text: `The company's guarantee covers ${evidence.guarantee.days} days after a service${evidence.guarantee.within === null ? "" : evidence.guarantee.within ? ". This concern was raised inside it." : ". This concern was raised after it."}` });
  }
  for (const term of evidence.terms) {
    const remedy = term.terms.correctiveRemedy;
    if (typeof remedy === "string" && remedy) out.push({ basis: "fact", text: `The signed agreement "${term.title}" says about corrections: ${remedy.slice(0, 300)}` });
  }
  const repeats = evidence.prior.filter((p) => p.shared.length > 0);
  for (const prior of repeats) {
    out.push({
      basis: "fact",
      text: `The same area (${prior.shared.join(", ")}) was reported at this property on ${localParts(prior.at, timezone).day}${prior.correctionCompleted === false ? ". That case has no completed correction on record" : prior.correctionCompleted ? ". A correction was completed for it" : ""}.`,
      source: prior.caseId ? { table: "retentionCases", id: prior.caseId, label: "Earlier case", at: prior.at } : prior.feedbackId ? { table: "retentionFeedback", id: prior.feedbackId, label: "Earlier feedback", at: prior.at } : undefined,
    });
  }
  return out;
}
