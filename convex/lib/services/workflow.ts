/**
 * The steps that change a service's draft and review, shared by the Services & Pricing workspace
 * (convex/services.ts) and Company Chat (lib/chat/serviceTools.ts), so both make the same record and pass
 * the same checks. The caller has already checked the person's role.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { sha256 } from "../agreements/hash";
import type { MemberAccess } from "../builders";
import { serviceKey } from "../dispatch/templates";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import type { ChangeState } from "./schema";
import { blankSpec, CATEGORY_LABELS, type Spec } from "./spec";
import { canonical, draftOf, newKey, normalizeSpec, openChanges, ownedService, priceComparison, publishedSpec, specHash, specialistNotes, submissionProblems } from "./store";
import { formatCents } from "./words";

export const STALE_DRAFT = "Someone else saved this draft after you opened it. Your edits are kept on screen; load the latest to continue.";
const DAY = 24 * 60 * 60 * 1000;

export async function actorLabel(ctx: QueryCtx, actor: Actor, via?: "workspace" | "chat"): Promise<string> {
  if (actor.kind === "member") {
    const member = await ctx.db.get(actor.memberId);
    const name = member?.name ?? "A team member";
    return via === "chat" ? `Selestial, asked by ${name} in Chat` : name;
  }
  if (actor.kind === "agent") return actor.agent[0].toUpperCase() + actor.agent.slice(1);
  return "Selestial";
}


export async function upcomingVisits(ctx: QueryCtx, companyId: Id<"companies">, name: string): Promise<number> {
  const rows = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "scheduled").gte("startsAt", Date.now()))
    .take(500);
  const key = serviceKey(name);
  return rows.filter((job) => serviceKey(job.serviceType) === key).length;
}


export const changeHash = (parts: { kind: string; versionHash: string | null; fromVersion: number | null; effectiveAt: number | null; serviceId: string }) => sha256(canonical(parts));


export async function createDraft(ctx: MutationCtx & MemberAccess, input: { category: Doc<"services">["category"]; spec?: Spec; origin: Doc<"services">["origin"]; templateId?: string; via: "workspace" | "chat"; actor: Actor }): Promise<{ serviceId: Id<"services">; revision: number }> {
  const spec = normalizeSpec(input.spec ?? blankSpec(input.category));
  const now = Date.now();
  const key = await newKey(ctx, ctx.companyId, spec.name || CATEGORY_LABELS[spec.category]);
  const serviceId = await ctx.db.insert("services", {
    companyId: ctx.companyId,
    key,
    name: spec.name || "New service",
    category: spec.category,
    status: "draft",
    latestVersion: 0,
    origin: input.origin,
    ...(input.templateId ? { templateId: input.templateId.slice(0, 80) } : {}),
    createdBy: input.actor,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("serviceDrafts", { companyId: ctx.companyId, serviceId, spec, revision: 1, step: "basics", updatedBy: input.actor, updatedAt: now, createdAt: now, via: input.via });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "service.draft_started", actor: input.actor, subject: { table: "services", id: serviceId }, data: { origin: input.origin, via: input.via } });
  return { serviceId, revision: 1 };
}


export async function writeDraft(ctx: MutationCtx & MemberAccess, service: Doc<"services">, draft: Doc<"serviceDrafts">, spec: Spec, step: string, actor: Actor, via: "workspace" | "chat"): Promise<{ revision: number; returned: number }> {
  const now = Date.now();
  const revision = draft.revision + 1;
  await ctx.db.patch(draft._id, { spec, revision, step, updatedBy: actor, updatedAt: now, via });
  if (service.status === "draft") await ctx.db.patch(service._id, { name: spec.name || "New service", category: spec.category, updatedAt: now });
  let returned = 0;
  for (const change of await openChanges(ctx, ctx.companyId, service._id)) {
    if (change.kind !== "publish" || change.draftRevision === undefined) continue;
    await closeChange(ctx, change, "returned", "The draft was edited after it was submitted, so the review and any approval were for older content. Submit it again.");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service.change_returned", actor, subject: { table: "serviceChanges", id: change._id }, data: { reason: "draft_edited", hadApproval: change.approval !== undefined } });
    returned += 1;
  }
  return { revision, returned };
}


export async function closeChange(ctx: MutationCtx, change: Doc<"serviceChanges">, state: Extract<ChangeState, "returned" | "withdrawn" | "superseded">, reason: string) {
  if (change.scheduledFunctionId) {
    const job = await ctx.db.system.get(change.scheduledFunctionId);
    if (job && job.state.kind === "pending") await ctx.scheduler.cancel(change.scheduledFunctionId);
  }
  await ctx.db.patch(change._id, { state, closedReason: reason, updatedAt: Date.now(), scheduledFunctionId: undefined });
}


export async function submitDraft(
  ctx: MutationCtx & MemberAccess,
  args: { serviceId: Id<"services">; expectedRevision: number; reason: string; customerNotice: { required: boolean; note: string }; contractReview: { required: boolean; note: string }; effectiveAt?: number; evidence?: Doc<"serviceChanges">["evidence"]; actor: Actor },
): Promise<{ changeId: Id<"serviceChanges">; version: number }> {
  const service = await ownedService(ctx, ctx.companyId, args.serviceId);
  const draft = await draftOf(ctx, ctx.companyId, service._id);
  if (!draft) throw userError("There is no draft to submit.");
  if (draft.revision !== args.expectedRevision) throw userError(STALE_DRAFT);
  const problems = submissionProblems(draft.spec);
  if (problems.length) throw userError(`Not ready for review: ${problems.slice(0, 3).join(" ")}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ""}`);
  const live = await publishedSpec(ctx, service);
  if (live && canonical(live.spec) === canonical(draft.spec)) throw userError("This draft is the same as the live version. There is nothing to review.");
  const now = Date.now();
  const effectiveAt = args.effectiveAt;
  if (effectiveAt !== undefined && (!Number.isSafeInteger(effectiveAt) || effectiveAt < now - 60_000 || effectiveAt > now + 366 * DAY)) throw userError("The start date must be from now to a year ahead.");
  const reason = args.reason.trim().slice(0, 1000);
  if (!reason) throw userError("Say why this change is being made. The reviewer reads it first.");

  for (const change of await openChanges(ctx, ctx.companyId, service._id)) {
    if (change.kind === "publish") await closeChange(ctx, change, "superseded", "A newer version of this service was submitted.");
  }
  const version = service.latestVersion + 1;
  const hash = specHash(draft.spec);
  const versionId = await ctx.db.insert("serviceVersions", {
    companyId: ctx.companyId,
    serviceId: service._id,
    version,
    spec: draft.spec,
    hash,
    ...(draft.rollbackOf !== undefined ? { basedOn: draft.rollbackOf } : draft.baseVersion !== undefined ? { basedOn: draft.baseVersion } : {}),
    source: draft.rollbackOf !== undefined ? "rollback" : "draft",
    ...(draft.rollbackOf !== undefined ? { note: `Rollback to version ${draft.rollbackOf}` } : {}),
    author: args.actor,
    createdAt: now,
  });
  await ctx.db.patch(service._id, { latestVersion: version, updatedAt: now });
  const upcoming = await upcomingVisits(ctx, ctx.companyId, live?.spec.name ?? draft.spec.name);
  const impact = [
    `From ${effectiveAt ? "the start date" : "publishing"}, new quotes and new visits for "${draft.spec.name}" use version ${version}.`,
    upcoming ? `${upcoming} visit${upcoming === 1 ? "" : "s"} already booked keep${upcoming === 1 ? "s" : ""} the scope and price ${upcoming === 1 ? "it was" : "they were"} booked with.` : "No booked visit is affected: visits keep the scope and price they were booked with.",
    "Recurring customers are not repriced by this. Changing what an existing customer pays is a separate step with that customer.",
    "Signed agreements keep their terms until they are amended.",
    ...(args.customerNotice.required ? [`Customers should be told: ${args.customerNotice.note || "(no note)"}`] : []),
    ...(args.contractReview.required ? [`Agreements to review: ${args.contractReview.note || "(no note)"}`] : []),
  ];
  const prices = priceComparison(live?.spec ?? null, draft.spec);
  const evidence = [
    ...(draft.evidence ?? []),
    ...(args.evidence ?? []),
    ...prices.map((row) => ({ kind: "scenario" as const, label: row.label, detail: `${row.before === null ? "—" : formatCents(row.before)} → ${row.after === null ? (row.note ?? "no price") : formatCents(row.after)}` })),
  ].slice(0, 30);
  const changeId = await ctx.db.insert("serviceChanges", {
    companyId: ctx.companyId,
    serviceId: service._id,
    kind: "publish",
    state: "in_review",
    versionId,
    version,
    ...(live ? { fromVersion: live.version } : {}),
    hash: changeHash({ kind: "publish", versionHash: hash, fromVersion: live?.version ?? null, effectiveAt: effectiveAt ?? null, serviceId: service._id }),
    draftRevision: draft.revision,
    title: live ? `Update ${draft.spec.name}` : `Add ${draft.spec.name}`,
    reason,
    evidence,
    agentNotes: await specialistNotes(ctx, ctx.company, draft.spec),
    impact,
    customerNotice: { required: args.customerNotice.required, note: args.customerNotice.note.trim().slice(0, 500) },
    contractReview: { required: args.contractReview.required, note: args.contractReview.note.trim().slice(0, 500) },
    ...(effectiveAt !== undefined ? { effectiveAt } : {}),
    submittedBy: args.actor,
    submittedAt: now,
    updatedAt: now,
  });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "service.submitted", actor: args.actor, subject: { table: "serviceChanges", id: changeId }, data: { version, service: draft.spec.name } });
  return { changeId, version };
}

