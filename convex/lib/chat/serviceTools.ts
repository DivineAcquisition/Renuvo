/**
 * Chat's tools for Services & Pricing. They are thin: each calls the same functions the workspace uses
 * (lib/services/workflow.ts, store.ts, the engine), as the member who is chatting, with their role as it
 * is now. Chat makes real, structured changes to the one draft the workspace shows; a person sees
 * "Selestial, asked by <name> in Chat" as its author.
 *
 * What Chat can never do: publish, approve, or confirm that template amounts suit the market. Those are
 * the Owner's, in the workspace. Prices come from the engine; the model passes inputs and amounts the
 * person gave, and never computes a price itself.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MemberAccess } from "../builders";
import type { MutationCtx } from "../../_generated/server";
import { isManager, isOwner } from "../roles";
import { checkSpec, priceSummary, quote, type QuoteInput } from "../services/engine";
import { emptyCosts, profitability } from "../services/profit";
import { blankSpec, CATEGORIES, defaultPricing, METHOD_LABELS, PRICING_METHODS, SCHEDULES, type Category, type PricingMethod, type Spec } from "../services/spec";
import { draftOf, normalizeSpec, publishedCatalog, publishedSpec } from "../services/store";
import { templateById, TEMPLATES } from "../services/templates";
import { createDraft, submitDraft, writeDraft } from "../services/workflow";
import { formatCents } from "../services/words";
import { type Field, stableHash } from "./fields";
import type { ChatTool, Outcome, ToolCtx } from "./tools";

const refused = (why: string, data?: Record<string, unknown>): Outcome => ({ status: "refused", why, data });
const say = (error: unknown, fallback: string) => (error as { data?: { message?: string } }).data?.message ?? (error instanceof Error && error.message ? error.message : fallback);
const link = (serviceId: Id<"services">) => ({ href: `/app/services/${serviceId}`, label: "Open in Services & Pricing" });
const CHAT = (ctx: ToolCtx) => ({ kind: "member" as const, memberId: ctx.member._id });

/** The workspace's functions take a member's access; Chat's context carries the same facts. */
const asMember = (ctx: ToolCtx) => ({ ...ctx, companyId: ctx.company._id }) as unknown as MutationCtx & MemberAccess;

const SERVICE: Field = { type: "string", max: 120, description: "The service: its id from list_services, its key, or its exact name." };

async function findService(ctx: ToolCtx, ref: unknown): Promise<Doc<"services"> | null> {
  const text = String(ref ?? "").trim();
  if (!text) return null;
  const id = ctx.db.normalizeId("services", text);
  if (id) {
    const row = await ctx.db.get(id);
    return row && row.companyId === ctx.company._id ? row : null;
  }
  const byKey = await ctx.db
    .query("services")
    .withIndex("by_company_key", (q) => q.eq("companyId", ctx.company._id).eq("key", text))
    .first();
  if (byKey) return byKey;
  for (const status of ["active", "draft", "archived"] as const) {
    const rows = await ctx.db
      .query("services")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", status))
      .take(200);
    const match = rows.find((row) => row.name.trim().toLowerCase() === text.toLowerCase());
    if (match) return match;
  }
  return null;
}

/** A spec in the words and units a person reads, for the model to explain. */
function describe(spec: Spec) {
  return {
    name: spec.name,
    category: spec.category,
    description: spec.summary,
    price: priceSummary(spec),
    method: METHOD_LABELS[spec.pricing.method].label,
    pricing: spec.pricing,
    included: spec.included.map((i) => (i.section ? `${i.section}: ${i.label}` : i.label)),
    excluded: spec.excluded,
    extras: spec.addOns.map((a) => ({ id: a.id, label: a.label, price: formatCents(a.priceCents), per: a.per === "item" ? (a.itemWord ?? "item") : a.per })),
    crew: spec.team.crewSize,
    skills: spec.team.skills,
    questions: spec.questions.map((q) => ({ id: q.id, label: q.label, required: q.required, kind: q.kind, options: q.options })),
    conditions: spec.modifiers.condition.enabled ? spec.modifiers.condition.levels.map((l) => ({ id: l.id, label: l.label })) : [],
    recurring: spec.modifiers.recurring.enabled ? spec.modifiers.recurring.options : [],
    walkthroughWhen: spec.walkthroughNotes,
    illustrativeAmounts: spec.illustrative,
  };
}

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────

const num = (description: string, max = 100_000_00, integer = true): Field => ({ type: "number", optional: true, integer, min: 0, max, description });

const quoteInputField: Field = {
  type: "object",
  description: "The job's facts, as the person gave them. Leave out anything not given; the result says what is missing.",
  properties: {
    area: num("Square feet or meters, in the service's unit.", 10_000_000, false),
    bedrooms: num("Bedrooms.", 50),
    bathrooms: num("Full bathrooms.", 50, false),
    halfBaths: num("Half bathrooms.", 50),
    units: num("Rooms, units, loads, windows or turnovers, for per-unit pricing.", 10_000),
    laborMinutes: num("Expected cleaner-minutes, for hourly-per-cleaner services.", 10_000),
    elapsedMinutes: num("Expected minutes on site, for hourly-per-crew services.", 10_000),
    crewSize: num("Cleaners on the visit.", 12),
    condition: { type: "string", optional: true, max: 48, description: "A condition id from read_service." },
    firstVisit: { type: "boolean", optional: true },
    schedule: { type: "string", optional: true, enum: SCHEDULES, description: "For recurring service. Omit for one-time." },
    addOns: { type: "array", optional: true, maxItems: 20, items: { type: "object", properties: { id: { type: "string", max: 48 }, quantity: { type: "number", integer: true, min: 0, max: 500 } } } },
    postalCode: { type: "string", optional: true, max: 12 },
    date: { type: "string", optional: true, max: 10, description: "YYYY-MM-DD." },
    rush: { type: "boolean", optional: true },
    afterHours: { type: "boolean", optional: true },
    promotionId: { type: "string", optional: true, max: 48 },
    beds: num("Short-term rentals: beds to make.", 50),
    answers: { type: "array", optional: true, maxItems: 30, items: { type: "object", properties: { questionId: { type: "string", max: 48 }, value: { type: "string", max: 200 } } } },
    timePercent: num("What-if: the time as a percent of the usual (120 = 20% longer).", 400, false),
  },
};

function toQuoteInput(raw: Record<string, unknown> | undefined): QuoteInput {
  const input = { ...(raw ?? {}) } as Record<string, unknown>;
  const answers = input.answers as { questionId: string; value: string }[] | undefined;
  delete input.answers;
  const out = input as QuoteInput;
  if (answers?.length) out.answers = Object.fromEntries(answers.map((a) => [a.questionId, /^-?\d+(\.\d+)?$/.test(a.value) ? Number(a.value) : a.value]));
  return out;
}

const pricingField: Field = {
  type: "object",
  optional: true,
  description: "Set the pricing method and its amounts, in whole cents (rates per area in millicents: $0.085 is 8500). Only the fields for the chosen method are used; others are ignored. Amounts must be ones the person gave.",
  properties: {
    method: { type: "string", enum: PRICING_METHODS },
    amountCents: num("Fixed price."),
    laborMinutes: num("Usual labor-minutes for a fixed-price visit.", 10_000),
    rateCents: num("Hourly rate: per cleaner, or for the whole crew, as the method says."),
    minimumHours: num("Least hours billed.", 24, false),
    incrementMinutes: num("Billing rounds up to this many minutes.", 120),
    estimatedLaborMinutes: num("Usual cleaner-minutes (hourly per cleaner).", 10_000),
    crewSize: num("Crew the hourly-per-crew rate covers.", 12),
    estimatedElapsedMinutes: num("Usual minutes on site (hourly per crew).", 10_000),
    unit: { type: "string", optional: true, enum: ["sq_ft", "sq_m"] },
    bands: { type: "array", optional: true, maxItems: 30, items: { type: "object", properties: { from: num("Inclusive lower size.", 10_000_000, false), to: num("Exclusive upper size. Omit for no upper limit.", 10_000_000, false), amountCents: num("Price for this band."), laborMinutes: num("Labor-minutes for this band.", 10_000) } } },
    rateMillicents: num("Rate per square foot or meter, in thousandths of a cent.", 100_000_000),
    laborMinutesPer1000: num("Labor-minutes per 1,000 units of area.", 10_000),
    walkthroughAbove: num("Areas at or above this need a walkthrough.", 10_000_000, false),
    baseCents: num("Base price."),
    includedBedrooms: num("Bedrooms in the base price.", 20),
    includedBathrooms: num("Bathrooms in the base price.", 20, false),
    perBedroomCents: num("Each extra bedroom."),
    perBathroomCents: num("Each extra bathroom."),
    perHalfBathCents: num("Each half bath."),
    baseLaborMinutes: num("Base labor-minutes.", 10_000),
    perBedroomMinutes: num("Labor-minutes per extra bedroom.", 10_000),
    perBathroomMinutes: num("Labor-minutes per extra bathroom.", 10_000),
    perHalfBathMinutes: num("Labor-minutes per half bath.", 10_000),
    unitWord: { type: "string", optional: true, max: 30, description: "One unit, singular: room, load, window, turnover." },
    unitCents: num("Price per unit."),
    minimumUnits: num("Least units charged.", 1000),
    laborMinutesPerUnit: num("Labor-minutes per unit.", 10_000),
    monthlyCents: num("Price per calendar month."),
    basis: { type: "string", optional: true, enum: ["schedule", "included"] },
    schedule: { type: "string", optional: true, enum: SCHEDULES },
    includedVisits: num("Visits included per calendar month.", 31),
    extraVisitCents: num("Price of a visit beyond the plan."),
    laborMinutesPerVisit: num("Labor-minutes per visit.", 10_000),
    fromCents: num("An advertised starting price for a custom quote."),
  },
};

function mergePricing(current: Spec["pricing"], raw: Record<string, unknown>): Spec["pricing"] {
  const method = raw.method as PricingMethod;
  const start = (current.method === method ? current : defaultPricing(method)) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...start };
  for (const [key, value] of Object.entries(raw)) {
    if (key === "method" || !(key in start)) continue;
    if (key === "bands") next.bands = (value as { from: number; to?: number; amountCents: number; laborMinutes: number }[]).map((b) => ({ from: b.from, to: b.to ?? null, amountCents: b.amountCents ?? 0, laborMinutes: b.laborMinutes ?? 0 }));
    else next[key] = value;
  }
  return next as Spec["pricing"];
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "item";
const uniqueId = (base: string, taken: Set<string>) => {
  let id = slug(base);
  for (let i = 2; taken.has(id); i += 1) id = `${slug(base).slice(0, 36)}-${i}`;
  taken.add(id);
  return id;
};

/** Applies a structured edit from Chat to a spec. Unknown labels are reported, never guessed. */
function applyEdit(spec: Spec, edit: Record<string, unknown>): { spec: Spec; done: string[]; notFound: string[] } {
  const next: Spec = structuredClone(spec);
  const done: string[] = [];
  const notFound: string[] = [];
  const text = (key: keyof Spec, label: string) => {
    if (typeof edit[key] === "string") {
      (next as Record<string, unknown>)[key] = edit[key];
      done.push(label);
    }
  };
  text("name", "name");
  text("summary", "description");
  text("teamNotes", "team notes");
  if (typeof edit.category === "string") {
    next.category = edit.category as Category;
    done.push("category");
  }
  const ids = new Set(next.included.map((i) => i.id));
  for (const item of (edit.addIncluded as { label: string; section?: string; requiresPhoto?: boolean }[] | undefined) ?? []) {
    next.included.push({ id: uniqueId(`${item.section ?? ""} ${item.label}`, ids), label: item.label, ...(item.section ? { section: item.section } : {}), requiresPhoto: item.requiresPhoto === true });
    done.push(`included "${item.label}"`);
  }
  for (const label of (edit.removeIncluded as string[] | undefined) ?? []) {
    const before = next.included.length;
    next.included = next.included.filter((i) => i.label.toLowerCase() !== label.toLowerCase());
    if (next.included.length === before) notFound.push(`included task "${label}"`);
    else done.push(`removed "${label}"`);
  }
  for (const label of (edit.addExcluded as string[] | undefined) ?? []) {
    next.excluded.push(label);
    done.push(`excluded "${label}"`);
  }
  for (const label of (edit.removeExcluded as string[] | undefined) ?? []) {
    const before = next.excluded.length;
    next.excluded = next.excluded.filter((e) => e.toLowerCase() !== label.toLowerCase());
    if (next.excluded.length === before) notFound.push(`exclusion "${label}"`);
  }
  if (edit.pricing) {
    next.pricing = mergePricing(next.pricing, edit.pricing as Record<string, unknown>);
    done.push(`pricing (${METHOD_LABELS[next.pricing.method].label})`);
  }
  if (typeof edit.crewSize === "number") {
    next.team = { ...next.team, crewSize: edit.crewSize, maxCrew: Math.max(next.team.maxCrew, edit.crewSize) };
    done.push("crew");
  }
  if (typeof edit.maxVisitMinutes === "number") {
    next.team = { ...next.team, maxVisitMinutes: edit.maxVisitMinutes };
    done.push("longest visit");
  }
  if (Array.isArray(edit.skills)) {
    next.team = { ...next.team, skills: edit.skills as string[] };
    done.push("skills");
  }
  const addOnIds = new Set(next.addOns.map((a) => a.id));
  for (const a of (edit.addAddOns as { label: string; priceCents: number; per?: "visit" | "item" | "hour"; itemWord?: string; laborMinutes?: number; maxQuantity?: number; coversIncluded?: string }[] | undefined) ?? []) {
    const covers = a.coversIncluded ? next.included.find((i) => i.label.toLowerCase() === a.coversIncluded!.toLowerCase()) : undefined;
    if (a.coversIncluded && !covers) notFound.push(`included task "${a.coversIncluded}"`);
    next.addOns.push({ id: uniqueId(a.label, addOnIds), label: a.label, priceCents: a.priceCents, per: a.per ?? "visit", ...(a.itemWord ? { itemWord: a.itemWord } : {}), laborMinutes: a.laborMinutes ?? 0, maxQuantity: a.maxQuantity ?? 1, ...(covers ? { coversItemId: covers.id } : {}) });
    done.push(`extra "${a.label}"`);
  }
  for (const label of (edit.removeAddOns as string[] | undefined) ?? []) {
    const before = next.addOns.length;
    next.addOns = next.addOns.filter((a) => a.label.toLowerCase() !== label.toLowerCase());
    if (next.addOns.length === before) notFound.push(`extra "${label}"`);
    else done.push(`removed extra "${label}"`);
  }
  if (typeof edit.minimumCents === "number") {
    next.modifiers = { ...next.modifiers, minimumCents: edit.minimumCents };
    done.push("minimum charge");
  }
  if (edit.clearMinimum === true) {
    next.modifiers = { ...next.modifiers, minimumCents: null };
    done.push("minimum charge removed");
  }
  if (Array.isArray(edit.recurringDiscounts)) {
    const options = (edit.recurringDiscounts as { schedule: Spec["modifiers"]["recurring"]["options"][number]["schedule"]; percent: number }[]).map((o) => ({ schedule: o.schedule, discount: { kind: "percent" as const, value: o.percent } }));
    next.modifiers = { ...next.modifiers, recurring: { enabled: options.length > 0, options } };
    done.push("recurring discounts");
  }
  const questionIds = new Set(next.questions.map((q) => q.id));
  for (const q of (edit.addQuestions as { label: string; kind: "number" | "choice" | "yes_no" | "text"; required?: boolean; options?: string[]; walkthroughIfEquals?: string; walkthroughIfAtLeast?: number }[] | undefined) ?? []) {
    next.questions.push({ id: uniqueId(q.label, questionIds), label: q.label, kind: q.kind, required: q.required === true, options: q.options ?? [], walkthroughIf: q.walkthroughIfEquals !== undefined || q.walkthroughIfAtLeast !== undefined ? { ...(q.walkthroughIfEquals !== undefined ? { equals: q.walkthroughIfEquals } : {}), ...(q.walkthroughIfAtLeast !== undefined ? { atLeast: q.walkthroughIfAtLeast } : {}) } : null });
    done.push(`question "${q.label}"`);
  }
  for (const note of (edit.addWalkthroughNotes as string[] | undefined) ?? []) {
    next.walkthroughNotes.push(note);
    done.push("walkthrough situation");
  }
  return { spec: next, done, notFound };
}

async function costsFor(ctx: ToolCtx) {
  const profile = await ctx.db
    .query("pricingProfiles")
    .withIndex("by_company", (q) => q.eq("companyId", ctx.company._id))
    .first();
  return profile?.costs ?? emptyCosts();
}

// ── The tools ───────────────────────────────────────────────────────────────────────────────────────

export const SERVICE_TOOLS: ChatTool[] = [
  {
    name: "list_services",
    label: "Reading the service catalog",
    description: "The company's services: each one's live price with its unit, whether a draft or a review is open, and the structural templates available to start from. Use before quoting, drafting or answering a question about services.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: {} },
    run: async (ctx) => {
      const live = await publishedCatalog(ctx, ctx.company._id);
      const all = [];
      for (const status of ["active", "draft", "archived"] as const) {
        const rows = await ctx.db
          .query("services")
          .withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", status))
          .take(200);
        for (const row of rows) {
          const draft = await draftOf(ctx, ctx.company._id, row._id);
          const published = live.find((l) => l.service._id === row._id);
          all.push({ id: row._id, key: row.key, name: row.name, status: row.status, livePrice: published ? priceSummary(published.version.spec) : null, liveVersion: row.publishedVersion ?? null, draft: draft ? { revision: draft.revision, price: priceSummary(draft.spec), problems: checkSpec(draft.spec).filter((p) => p.severity === "blocker").map((p) => p.message) } : null });
        }
      }
      return { status: "done", summary: `${all.length} service${all.length === 1 ? "" : "s"} in the catalog`, data: { services: all, templates: TEMPLATES.map((t) => ({ id: t.id, category: t.category, name: t.name, blurb: t.blurb })), note: "Template amounts are illustrative, not local rates. Publishing is the Owner's, in Services & Pricing." }, link: { href: "/app/services", label: "Open Services & Pricing" } };
    },
  },
  {
    name: "read_service",
    label: "Reading a service",
    description: "One service's live version and its draft, if any: what is included and excluded, the price with its unit, extras, crew, quoting questions and when a walkthrough is needed. Use it for proposals, agreements and customer answers; quote only what it says.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { service: SERVICE } },
    run: async (ctx, args) => {
      const service = await findService(ctx, args.service);
      if (!service) return refused("No service by that name or id. Use list_services.");
      const live = await publishedSpec(ctx, service);
      const draft = isManager(ctx.role) ? await draftOf(ctx, ctx.company._id, service._id) : null;
      return { status: "done", summary: `Read ${service.name}`, data: { id: service._id, status: service.status, live: live ? { version: live.version, ...describe(live.spec) } : null, draft: draft ? { revision: draft.revision, ...describe(draft.spec) } : null }, link: link(service._id) };
    },
  },
  {
    name: "quote_service",
    label: "Pricing a job",
    description: "Price one job from a service's live version (or its draft, for Owners and Managers), with Selestial's pricing engine. Returns every line with its reason, the outcome (firm, estimate, walkthrough needed, or what is missing), time and crew. Never state a price this did not return. It changes nothing.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { service: SERVICE, from: { type: "string", optional: true, enum: ["live", "draft"] }, input: quoteInputField } },
    run: async (ctx, args) => {
      const service = await findService(ctx, args.service);
      if (!service) return refused("No service by that name or id. Use list_services.");
      const fromDraft = args.from === "draft";
      if (fromDraft && !isManager(ctx.role)) return refused("Only Owners and Managers can price a draft.");
      const spec = fromDraft ? (await draftOf(ctx, ctx.company._id, service._id))?.spec : (await publishedSpec(ctx, service))?.spec;
      if (!spec) return refused(fromDraft ? `${service.name} has no draft.` : `${service.name} has no live version yet.`);
      const result = quote(spec, toQuoteInput(args.input as Record<string, unknown>));
      const words = result.outcome === "incomplete" ? `Needs: ${result.missing.join(", ")}` : result.outcome === "walkthrough" ? `Walkthrough needed${result.totalCents !== null ? `; advertised from ${formatCents(result.totalCents)}` : ""}` : `${formatCents(result.totalCents!)} per ${result.per}${result.outcome === "estimate" ? " (estimate)" : ""}`;
      return { status: "done", summary: `${service.name}: ${words}`, data: { ...result, fromDraft, liveCatalogChanged: false }, link: link(service._id) };
    },
  },
  {
    name: "run_pricing_scenarios",
    label: "Comparing pricing scenarios",
    description: "Compare up to six jobs side by side (current vs proposed, standard vs premium, one-time vs recurring, usual vs longer time) using live versions or drafts. Owners also get costs and margin from the costs they entered. It changes nothing.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { scenarios: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { label: { type: "string", max: 80 }, service: SERVICE, from: { type: "string", optional: true, enum: ["live", "draft"] }, input: quoteInputField } } } } },
    run: async (ctx, args) => {
      const costs = isOwner(ctx.role) ? await costsFor(ctx) : null;
      const out = [];
      for (const scenario of args.scenarios as { label: string; service: string; from?: "live" | "draft"; input: Record<string, unknown> }[]) {
        const service = await findService(ctx, scenario.service);
        if (!service) {
          out.push({ label: scenario.label, error: "No such service." });
          continue;
        }
        const fromDraft = scenario.from === "draft" && isManager(ctx.role);
        const spec = fromDraft ? (await draftOf(ctx, ctx.company._id, service._id))?.spec : (await publishedSpec(ctx, service))?.spec;
        if (!spec) {
          out.push({ label: scenario.label, error: fromDraft ? "No draft." : "No live version." });
          continue;
        }
        const result = quote(spec, toQuoteInput(scenario.input));
        const profit = costs ? profitability(result, costs) : null;
        out.push({ label: scenario.label, service: service.name, outcome: result.outcome, total: result.totalCents === null ? null : formatCents(result.totalCents), per: result.per, laborMinutes: result.time.laborMinutes, crew: result.time.crewSize, minutesOnSite: result.time.elapsedMinutes, schedule: result.schedule, warnings: result.warnings.map((w) => w.message), ...(profit ? { directCosts: formatCents(profit.directCents), contribution: formatCents(profit.contributionCents), contributionMargin: profit.contributionMarginPercent, markup: profit.markupPercent, afterOverhead: profit.afterOverheadCents === null ? "overhead not entered" : formatCents(profit.afterOverheadCents), notEntered: profit.missing } : {}) });
      }
      return { status: "done", summary: `${out.length} scenario${out.length === 1 ? "" : "s"} compared`, data: { scenarios: out, definitions: "Contribution is what remains after direct costs; it is not net profit. Margin is a share of price; markup a share of cost." } };
    },
  },
  {
    name: "start_service_draft",
    label: "Starting a service draft",
    description: "Start a new service as a draft in Services & Pricing, blank or from a structural template (ids from list_services). Owners and Managers. Nothing is live until the Owner publishes it. A template's amounts are illustrative and stay flagged until the Owner confirms them in the workspace.",
    kind: "draft",
    minimumRole: "manager",
    input: { type: "object", properties: { name: { type: "string", max: 80 }, category: { type: "string", enum: CATEGORIES }, templateId: { type: "string", optional: true, max: 40 }, summary: { type: "string", optional: true, max: 1000 } } },
    run: async (ctx, args) => {
      const template = args.templateId ? templateById(String(args.templateId)) : undefined;
      if (args.templateId && !template) return refused("No template with that id. Use list_services for the list.");
      try {
        const base = template?.spec ?? blankSpec(args.category as Category);
        const spec = normalizeSpec({ ...base, name: String(args.name), ...(args.summary ? { summary: String(args.summary) } : {}), category: (template?.category ?? args.category) as Category });
        const { serviceId, revision } = await createDraft(asMember(ctx), { category: spec.category, spec, origin: template ? "template" : "chat", ...(template ? { templateId: template.id } : {}), via: "chat", actor: CHAT(ctx) });
        return { status: "done", summary: `Started a draft: ${spec.name}${template ? ` (from the ${template.name} template; amounts are illustrative)` : ""}`, data: { serviceId, revision, problems: checkSpec(spec).map((p) => p.message) }, link: link(serviceId) };
      } catch (error) {
        return refused(say(error, "The draft could not be started."));
      }
    },
  },
  {
    name: "edit_service_draft",
    label: "Editing a service draft",
    description:
      "Make structured changes to a service's draft (a draft is opened from the live version if there is none): name, description, included and excluded tasks, pricing method and amounts, crew, extras, minimum, recurring discounts, quoting questions. Owners and Managers. Amounts must be ones the person gave. It saves at once to the same draft the workspace shows; a submitted review of that draft is returned for resubmission.",
    kind: "draft",
    minimumRole: "manager",
    input: {
      type: "object",
      properties: {
        service: SERVICE,
        changes: {
          type: "object",
          properties: {
            name: { type: "string", optional: true, max: 80 },
            summary: { type: "string", optional: true, max: 1000 },
            category: { type: "string", optional: true, enum: CATEGORIES },
            teamNotes: { type: "string", optional: true, max: 2000 },
            addIncluded: { type: "array", optional: true, maxItems: 40, items: { type: "object", properties: { label: { type: "string", max: 200 }, section: { type: "string", optional: true, max: 80 }, requiresPhoto: { type: "boolean", optional: true } } } },
            removeIncluded: { type: "array", optional: true, maxItems: 40, items: { type: "string", max: 200 } },
            addExcluded: { type: "array", optional: true, maxItems: 20, items: { type: "string", max: 200 } },
            removeExcluded: { type: "array", optional: true, maxItems: 20, items: { type: "string", max: 200 } },
            pricing: pricingField,
            crewSize: num("Default crew.", 12),
            maxVisitMinutes: num("Longest a visit should run on site.", 1440),
            skills: { type: "array", optional: true, maxItems: 20, items: { type: "string", max: 60 } },
            addAddOns: { type: "array", optional: true, maxItems: 20, items: { type: "object", properties: { label: { type: "string", max: 120 }, priceCents: { type: "number", integer: true, min: 0, max: 100_000_00 }, per: { type: "string", optional: true, enum: ["visit", "item", "hour"] }, itemWord: { type: "string", optional: true, max: 30 }, laborMinutes: num("Labor-minutes per unit.", 10_000), maxQuantity: num("Most per visit.", 500), coversIncluded: { type: "string", optional: true, max: 200, description: "An included task this extra is, so it is never charged on this service." } } } },
            removeAddOns: { type: "array", optional: true, maxItems: 20, items: { type: "string", max: 120 } },
            minimumCents: num("Minimum charge per visit."),
            clearMinimum: { type: "boolean", optional: true },
            recurringDiscounts: { type: "array", optional: true, maxItems: 4, items: { type: "object", properties: { schedule: { type: "string", enum: SCHEDULES }, percent: { type: "number", min: 0, max: 100 } } } },
            addQuestions: { type: "array", optional: true, maxItems: 10, items: { type: "object", properties: { label: { type: "string", max: 200 }, kind: { type: "string", enum: ["number", "choice", "yes_no", "text"] }, required: { type: "boolean", optional: true }, options: { type: "array", optional: true, maxItems: 20, items: { type: "string", max: 80 } }, walkthroughIfEquals: { type: "string", optional: true, max: 80 }, walkthroughIfAtLeast: { type: "number", optional: true } } } },
            addWalkthroughNotes: { type: "array", optional: true, maxItems: 10, items: { type: "string", max: 200 } },
          },
        },
      },
    },
    run: async (ctx, args) => {
      const service = await findService(ctx, args.service);
      if (!service) return refused("No service by that name or id. Use list_services.");
      try {
        let draft = await draftOf(ctx, ctx.company._id, service._id);
        if (!draft) {
          const live = await publishedSpec(ctx, service);
          if (!live) return refused("This service has nothing to edit.");
          const now = Date.now();
          const id = await ctx.db.insert("serviceDrafts", { companyId: ctx.company._id, serviceId: service._id, spec: live.spec, revision: 1, baseVersion: live.version, step: "basics", updatedBy: CHAT(ctx), updatedAt: now, createdAt: now, via: "chat" });
          draft = (await ctx.db.get(id))!;
        }
        const { spec, done, notFound } = applyEdit(draft.spec, args.changes as Record<string, unknown>);
        if (done.length === 0) return refused(`Nothing was changed.${notFound.length ? ` Not found: ${notFound.join(", ")}.` : ""}`);
        const saved = await writeDraft(asMember(ctx), service, draft, normalizeSpec(spec), draft.step, CHAT(ctx), "chat");
        const problems = checkSpec(spec);
        return {
          status: "done",
          summary: `Updated the draft of ${spec.name}: ${done.join(", ")}`,
          data: { revision: saved.revision, price: priceSummary(spec), notFound, returnedReviews: saved.returned, blockers: problems.filter((p) => p.severity === "blocker").map((p) => p.message), warnings: problems.filter((p) => p.severity === "warning").map((p) => p.message) },
          link: link(service._id),
        };
      } catch (error) {
        return refused(say(error, "The draft could not be changed."));
      }
    },
  },
  {
    name: "attach_research",
    label: "Attaching research",
    description: "Attach a research brief, or one finding from it, to a service's draft as evidence for its review. It proposes; it changes no price.",
    kind: "draft",
    minimumRole: "manager",
    input: { type: "object", properties: { service: SERVICE, briefId: { type: "string", max: 64 }, findingId: { type: "string", optional: true, max: 64 } } },
    run: async (ctx, args) => {
      const service = await findService(ctx, args.service);
      const briefId = ctx.db.normalizeId("researchBriefs", String(args.briefId));
      const brief = briefId ? await ctx.db.get(briefId) : null;
      if (!service || !brief || brief.companyId !== ctx.company._id) return refused("No such service or research brief.");
      const finding = args.findingId ? brief.findings.find((f) => f.id === args.findingId) : null;
      if (args.findingId && !finding) return refused("That finding is not in the brief.");
      const draft = await draftOf(ctx, ctx.company._id, service._id);
      if (!draft) return refused("Open a draft of this service first (edit_service_draft opens one).");
      const item = { kind: "research" as const, label: finding ? "Research finding" : "Research brief", detail: (finding ? `${finding.statement} (${finding.limitation})` : brief.question).slice(0, 600), ref: brief._id };
      await ctx.db.patch(draft._id, { evidence: [...(draft.evidence ?? []), item].slice(-20) });
      return { status: "done", summary: `Attached research to the draft of ${service.name}`, data: { briefId: brief._id }, link: link(service._id) };
    },
  },
  {
    name: "submit_service_for_review",
    label: "Submitting for the Owner's review",
    description: "Submit a service's draft for review: it becomes a new version waiting in Services & Pricing › Changes. Owners and Managers, after the person approves in chat. It does not publish: only the Owner publishes, in the workspace. Say what blocks it if it is not ready.",
    kind: "write",
    minimumRole: "manager",
    confirm: true,
    input: { type: "object", properties: { service: SERVICE, reason: { type: "string", max: 1000, description: "Why the change, in the person's words." }, customersToBeTold: { type: "boolean", optional: true }, agreementsToReview: { type: "boolean", optional: true } } },
    preview: async (ctx, args) => {
      const service = await findService(ctx, args.service);
      if (!service) return refused("No such service.");
      const draft = await draftOf(ctx, ctx.company._id, service._id);
      if (!draft) return refused(`${service.name} has no draft to submit.`);
      const blockers = checkSpec(draft.spec).filter((p) => p.severity === "blocker").map((p) => p.message);
      if (blockers.length) return refused(`Not ready for review: ${blockers.join(" ")}`, { blockers });
      return {
        status: "needs_approval",
        preview: {
          summary: `Submit ${draft.spec.name} for the Owner's review`,
          lines: [`Price: ${priceSummary(draft.spec)}`, `Reason: ${String(args.reason)}`, "It becomes a new version waiting in Changes. Nothing is live until the Owner publishes it, and visits already booked keep their price."],
          bindsTo: stableHash({ service: service._id, revision: draft.revision, reason: args.reason, notice: args.customersToBeTold ?? false, contracts: args.agreementsToReview ?? false }),
        },
      };
    },
    run: async (ctx, args) => {
      const service = await findService(ctx, args.service);
      if (!service) return refused("No such service.");
      const draft = await draftOf(ctx, ctx.company._id, service._id);
      if (!draft) return refused("There is no draft to submit.");
      try {
        const { changeId, version } = await submitDraft(asMember(ctx), { serviceId: service._id, expectedRevision: draft.revision, reason: String(args.reason), customerNotice: { required: args.customersToBeTold === true, note: "" }, contractReview: { required: args.agreementsToReview === true, note: "" }, actor: CHAT(ctx) });
        return { status: "done", summary: `Submitted version ${version} of ${service.name} for review`, data: { changeId, version, next: "The Owner reviews and publishes it in Services & Pricing › Changes." }, link: { href: `/app/services/changes/${changeId}`, label: "Open the review" } };
      } catch (error) {
        return refused(say(error, "It could not be submitted."));
      }
    },
  },
];
