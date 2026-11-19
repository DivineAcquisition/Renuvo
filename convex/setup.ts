/**
 * Company setup: the owner's guided start. It keeps where they are and what they chose; what it learns
 * about the company goes to the record that owns it (lib/setup/schema.ts), so nothing here goes stale.
 *
 * Only an Owner changes setup. Managers and Office staff can read the company's context, and are never
 * sent through setup. A company made before setup existed has no setup row and is never forced into one.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { isTimezone } from "./lib/availability";
import { companyQuery, ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isOwner } from "./lib/roles";
import { FACTS, factsOf, isFactKey, stateFact } from "./lib/setup/facts";
import { progress, questionsFor, stepsFor, unanswered } from "./lib/setup/path";
import { agentReadiness } from "./lib/setup/readiness";
import { factValueValidator, methodValidator, priorityValidator } from "./lib/setup/schema";
import { businessSettingsOf } from "./lib/settings/business";
import { text } from "./lib/text";
import { createExperience } from "./bookingExperiences";
import { createAgreement } from "./lib/agreements/store";
import { experienceKindValidator } from "./lib/booking/definition";
import { createDraft } from "./lib/services/workflow";
import { wakeActivation } from "./lib/activation/wake";
import { TEMPLATES } from "./lib/services/templates";

const STALE = "Your setup was changed somewhere else, on another tab or device. Nothing was lost: we have loaded the latest, so check it and continue.";

export async function setupOf(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">): Promise<Doc<"companySetups"> | null> {
  return ctx.db
    .query("companySetups")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .first();
}

/** Starts setup for a company. Called once when the company is created; asking again finds the same row. */
export async function startSetup(ctx: MutationCtx, companyId: Id<"companies">): Promise<Id<"companySetups">> {
  const existing = await setupOf(ctx, companyId);
  if (existing) return existing._id;
  const now = Date.now();
  return ctx.db.insert("companySetups", { companyId, status: "in_progress", step: "start", methods: [], secondary: [], answers: {}, skipped: [], revision: 0, milestones: { startedAt: now }, updatedAt: now });
}

/** Everything the setup screens and the workspace's "continue setup" need, for whoever is asking. */
export const state = companyQuery({
  args: {},
  handler: async (ctx) => {
    const setup = await setupOf(ctx, ctx.companyId);
    const owner = isOwner(ctx.role);
    const facts = await factsOf(ctx, ctx.companyId);
    const settings = businessSettingsOf(ctx.company);
    const known: Record<string, { value: string | string[]; state: "found" | "confirmed"; source: string; sourceRef: string | null; conflict: { value: string | string[]; source: string } | null }> = {};
    for (const row of facts) known[row.key] = { value: row.value, state: row.state, source: row.source, sourceRef: row.sourceRef ?? null, conflict: row.conflict ? { value: row.conflict.value, source: row.conflict.source } : null };
    const view = setup
      ? {
          status: setup.status,
          step: setup.step,
          methods: setup.methods,
          priority: setup.priority ?? null,
          secondary: setup.secondary,
          answers: setup.answers,
          skipped: setup.skipped,
          revision: setup.revision,
          progress: progress({ primary: setup.priority, secondary: setup.secondary, step: setup.step, answers: setup.answers, skipped: setup.skipped }),
          steps: stepsFor(setup.priority, setup.secondary),
          stillNeeded: unanswered(setup.priority, setup.secondary, setup.answers).map((question) => question.id),
          contextConfirmed: setup.milestones.contextConfirmedAt !== undefined,
        }
      : null;
    const prepared = setup?.prepared ? await preparedView(ctx, ctx.companyId, setup.prepared) : { service: null, agreement: null, booking: null };
    return {
      prepared,
      /** Only an Owner who has not yet entered the workspace is taken to setup. Nobody else, ever. */
      required: owner && setup?.status === "in_progress",
      canEdit: owner,
      setup: view,
      company: { name: ctx.company.name, timezone: ctx.company.timezone, postalCodes: settings.serviceAreas },
      facts: known,
      agents: await agentReadiness(ctx, ctx.company),
    };
  },
});

/** For a company made before setup existed: the Owner chooses to go through it. It never starts by itself. */
export const begin = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await setupOf(ctx, ctx.companyId);
    if (existing) return null;
    const id = await startSetup(ctx, ctx.companyId);
    // They are already working in the product, so setup is something they visit, not a gate.
    await ctx.db.patch(id, { status: "entered", milestones: { startedAt: Date.now(), enteredAt: Date.now() } });
    return null;
  },
});

/**
 * Saves one step: where the owner is, what they chose, and any facts they stated. Every save names the
 * revision it started from; an older one is refused rather than overwriting a newer save from another
 * device. Saving the same thing twice changes nothing.
 */
export const save = ownerMutation({
  args: {
    expectedRevision: v.number(),
    step: v.string(),
    methods: v.optional(v.array(methodValidator)),
    priority: v.optional(priorityValidator),
    secondary: v.optional(v.array(priorityValidator)),
    answers: v.optional(v.record(v.string(), factValueValidator)),
    skip: v.optional(v.string()),
    company: v.optional(v.object({ name: v.optional(v.string()), timezone: v.optional(v.string()) })),
    facts: v.optional(v.record(v.string(), factValueValidator)),
    /** The owner looked at the summary of their company and said it is right. */
    confirmContext: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const setup = await setupOf(ctx, ctx.companyId);
    if (!setup) throw userError("Setup has not been started for this company.");
    if (args.expectedRevision !== setup.revision) throw userError(STALE);

    // Everything is checked before anything is written.
    const priority = args.priority ?? setup.priority;
    const secondary = [...new Set(args.secondary ?? setup.secondary)].filter((value) => value !== priority).slice(0, 5);
    const steps = stepsFor(priority, secondary);
    if (!steps.some((step) => step.id === args.step)) throw userError("That step is not part of your setup.");
    const allowed = new Set(questionsFor(priority, secondary).map((question) => question.id));
    const answers: Record<string, string | string[]> = { ...setup.answers };
    for (const [id, value] of Object.entries(args.answers ?? {})) {
      if (!allowed.has(id)) throw userError("That question is not part of your setup.");
      answers[id] = Array.isArray(value) ? [...new Set(value)].slice(0, 20).map((item) => text(item, "The answer", 80)) : text(value, "The answer", 80);
    }
    const stated: [keyof typeof FACTS, string | string[]][] = [];
    for (const [key, value] of Object.entries(args.facts ?? {})) {
      if (!isFactKey(key)) throw userError("That is not something setup records.");
      if (FACTS[key].many !== Array.isArray(value)) throw userError(`${FACTS[key].label} was not given in the right form.`);
      stated.push([key, Array.isArray(value) ? [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 20).map((item) => text(item, FACTS[key].label, 80)) : value.trim() === "" ? "" : text(value, FACTS[key].label, 300)]);
    }
    const name = args.company?.name !== undefined ? text(args.company.name, "Company name", 160) : undefined;
    const timezone = args.company?.timezone;
    if (timezone !== undefined && !isTimezone(timezone)) throw userError("Choose a time zone from the list.");
    if (args.confirmContext && !(name ?? ctx.company.name).trim()) throw userError("Give your company a name first.");

    // The company's name and clock live on the company, where every schedule already reads them.
    if ((name !== undefined && name !== ctx.company.name) || (timezone !== undefined && timezone !== ctx.company.timezone)) {
      await ctx.db.patch(ctx.companyId, { ...(name !== undefined ? { name } : {}), ...(timezone !== undefined ? { timezone } : {}), settingsRevision: (ctx.company.settingsRevision ?? 0) + 1 });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "company.updated", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    }
    for (const [key, value] of stated) await stateFact(ctx, ctx.companyId, ctx.member._id, key, value);
    // A confirmed answer can unblock first agent work that was waiting for it (lib/activation/wake.ts).
    if (stated.length) await wakeActivation(ctx, ctx.companyId);

    const now = Date.now();
    const skipped = args.skip && steps.some((step) => step.id === args.skip && step.optional) ? [...new Set([...setup.skipped, args.skip])] : setup.skipped;
    // Answers to questions that are no longer on the path are kept: changing priority back finds them again.
    const next = {
      step: args.step,
      methods: args.methods ? [...new Set(args.methods)] : setup.methods,
      priority,
      secondary,
      answers,
      skipped,
      milestones: { ...setup.milestones, ...(args.confirmContext && setup.milestones.contextConfirmedAt === undefined ? { contextConfirmedAt: now } : {}) },
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).some((key) => JSON.stringify(next[key]) !== JSON.stringify(setup[key]));
    if (!changed && stated.length === 0 && name === undefined && timezone === undefined) return { revision: setup.revision };
    await ctx.db.patch(setup._id, { ...next, revision: setup.revision + 1, updatedAt: now });
    if (args.confirmContext && setup.milestones.contextConfirmedAt === undefined) {
      await recordEvent(ctx, { companyId: ctx.companyId, type: "setup.context_confirmed", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    }
    return { revision: setup.revision + 1 };
  },
});

/**
 * The owner opens the workspace. Setup stops being a gate from this moment and continues inside the
 * product. Nothing is switched on by this: every agent's authority stays exactly as it was.
 */
export const enter = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const setup = await setupOf(ctx, ctx.companyId);
    if (!setup || setup.status === "entered") return null;
    const now = Date.now();
    await ctx.db.patch(setup._id, { status: "entered", milestones: { ...setup.milestones, enteredAt: now }, revision: setup.revision + 1, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "setup.workspace_entered", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { priority: setup.priority ?? "none", contextConfirmed: setup.milestones.contextConfirmedAt !== undefined } });
    return null;
  },
});

// ── Preparing first drafts ──────────────────────────────────────────────────────────────────────
// Setup prepares through the same paths the workspace uses, and only drafts: nothing here is published,
// approved or sent. Each kind is prepared once; asking again opens the same draft.

type Prepared = NonNullable<Doc<"companySetups">["prepared"]>;

async function preparedView(ctx: QueryCtx, companyId: Id<"companies">, prepared: Prepared) {
  const service = prepared.serviceId ? await ctx.db.get(prepared.serviceId) : null;
  const agreement = prepared.agreementId ? await ctx.db.get(prepared.agreementId) : null;
  const booking = prepared.experienceId ? await ctx.db.get(prepared.experienceId) : null;
  const live = await ctx.db
    .query("services")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active"))
    .take(1);
  return {
    service: service ? { id: service._id, name: service.name, status: service.status, href: `/app/services/${service._id}` } : null,
    agreement: agreement ? { id: agreement._id, title: agreement.title, workflow: agreement.workflow, href: `/app/agreements/${agreement._id}` } : null,
    booking: booking ? { id: booking._id, name: booking.name, status: booking.status, href: `/app/agents/sales/booking-forms/${booking._id}`, canTakeBookings: live.length > 0 } : null,
  };
}

async function markPrepared(ctx: MutationCtx, setup: Doc<"companySetups">, patch: Partial<Prepared>) {
  const now = Date.now();
  await ctx.db.patch(setup._id, { prepared: { ...(setup.prepared ?? {}), ...patch }, milestones: { ...setup.milestones, ...(setup.milestones.firstArtifactAt === undefined ? { firstArtifactAt: now } : {}) }, revision: setup.revision + 1, updatedAt: now });
}

async function ownSetup(ctx: MutationCtx & { companyId: Id<"companies"> }) {
  const setup = await setupOf(ctx, ctx.companyId);
  if (!setup) throw userError("Setup has not been started for this company.");
  return setup;
}

/** Starts one service from a template, named as the owner's website names it when they choose that. Its template prices stay marked as examples. */
export const prepareService = ownerMutation({
  args: { templateId: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const template = TEMPLATES.find((row) => row.id === args.templateId);
    if (!template) throw userError("That starting point is not available.");
    const setup = await ownSetup(ctx);
    if (setup.prepared?.serviceId && (await ctx.db.get(setup.prepared.serviceId))) return { serviceId: setup.prepared.serviceId, already: true };
    const name = args.name?.trim() ? text(args.name, "The service name", 80) : template.spec.name;
    const { serviceId } = await createDraft(ctx, { category: template.category, spec: { ...template.spec, name }, origin: "template", templateId: template.id, via: "workspace", actor: byMember(ctx) });
    await markPrepared(ctx, setup, { serviceId });
    return { serviceId, already: false };
  },
});

/** Starts one agreement from Selestial's starting text. It is a draft: nobody has reviewed or approved it. */
export const prepareAgreement = ownerMutation({
  args: { docType: v.union(v.literal("one_time_residential"), v.literal("recurring_residential"), v.literal("office_janitorial"), v.literal("commercial_msa"), v.literal("str_turnover")) },
  handler: async (ctx, args) => {
    const setup = await ownSetup(ctx);
    if (setup.prepared?.agreementId && (await ctx.db.get(setup.prepared.agreementId))) return { agreementId: setup.prepared.agreementId, already: true };
    const agreementId = await createAgreement(ctx, { docType: args.docType, origin: "manual", note: "Prepared during setup" });
    await markPrepared(ctx, setup, { agreementId });
    return { agreementId, already: false };
  },
});

/** Starts one booking page. It can take bookings only once it is published with a live service. */
export const prepareBooking = ownerMutation({
  args: { kind: experienceKindValidator },
  handler: async (ctx, args) => {
    const setup = await ownSetup(ctx);
    if (setup.prepared?.experienceId && (await ctx.db.get(setup.prepared.experienceId))) return { experienceId: setup.prepared.experienceId, already: true };
    const experienceId = await createExperience(ctx, args.kind);
    await markPrepared(ctx, setup, { experienceId });
    return { experienceId, already: false };
  },
});
