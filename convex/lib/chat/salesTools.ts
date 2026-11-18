/**
 * Company Chat in the Sales workspace: read a booking or proposal draft, explain and compare prices,
 * prepare changes to the draft, apply walkthrough findings, draft the customer's message, and say what
 * an accepted proposal still needs.
 *
 * Bounds:
 *  - every price is the engine's on a published service; Chat never sets a price or a discount;
 *  - a change to a draft is shown as an exact preview and applied only when the person approves it,
 *    bound to the draft revision it was shown for;
 *  - nothing here sends, charges, signs or confirms: those are people's actions in the workspace;
 *  - findings, insurance, credentials and customer agreement are never invented: only records are read.
 *
 * Each result's data uses the same keys, so the chat card can show them: facts (what it read),
 * prepared (the change or text), unresolved, approval (what still needs whom) and next (the next step).
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { applyFindings } from "../../assessments";
import { cadenceLabel, cadenceProblem, pricingSchedule, type Cadence } from "../sales/cadence";
import { bookingNeeds, type DraftBody } from "../sales/draft";
import { priceBooking, priceChoice } from "../sales/pricing";
import { buildContent } from "../sales/proposalContent";
import { publishedByKey, publishedCatalog } from "../services/store";
import { formatCents } from "../services/words";
import { isOwner } from "../roles";
import { stableHash } from "./fields";
import type { ChatTool, Outcome, ToolCtx } from "./tools";

const refused = (why: string, data?: Record<string, unknown>): Outcome => ({ status: "refused", why, data });
const DRAFT = { type: "string" as const, max: 64, description: "The workspace draft's id (the conversation names it when it began in the workspace)." };
const link = (draftId: string) => ({ href: `/app/agents/sales/book/${draftId}`, label: "Open the workspace" });

async function draftFor(ctx: ToolCtx, id: unknown): Promise<Doc<"salesDrafts"> | null> {
  if (typeof id !== "string") return null;
  const normalized = ctx.db.normalizeId("salesDrafts", id);
  if (!normalized) return null;
  const draft = await ctx.db.get(normalized);
  return draft && draft.companyId === ctx.company._id ? draft : null;
}

async function bookingFacts(ctx: ToolCtx, draft: Doc<"salesDrafts">) {
  const body = draft.body as DraftBody;
  const customer = draft.customerId ? await ctx.db.get(draft.customerId) : null;
  const property = draft.propertyId ? await ctx.db.get(draft.propertyId) : null;
  const pricing = await priceBooking(ctx, ctx.company, body, draft.bookingKind, property?.address.postalCode ?? null);
  const needs = bookingNeeds(body, {
    hasCustomer: Boolean(customer),
    hasProperty: Boolean(property),
    customerReachable: Boolean(customer?.email || customer?.phone),
    inServiceArea: null,
    serviceFound: Boolean(pricing.visit),
    outcome: pricing.visit?.quote.outcome ?? null,
    missing: pricing.visit?.quote.missing ?? [],
    firstOutcome: pricing.first?.quote.outcome ?? null,
    capacity: null,
    overrideNeedsApproval: Boolean(pricing.override) && !isOwner(ctx.role),
    segment: draft.segment,
    bookingKind: draft.bookingKind,
  });
  return {
    facts: {
      customer: customer?.name ?? null,
      address: property ? `${property.address.line1}, ${property.address.city}` : null,
      kind: draft.bookingKind,
      service: pricing.visit?.name ?? null,
      answers: body.service?.input ?? null,
      cadence: draft.bookingKind === "recurring" && body.recurring?.cadence ? cadenceLabel(body.recurring.cadence) : null,
      firstVisit: pricing.first ? `${pricing.first.name} at ${formatCents(pricing.first.quote.totalCents ?? 0)}` : null,
      firstCents: pricing.firstCents,
      ongoingCents: pricing.ongoingCents,
      dueNowCents: pricing.dueNowCents,
      lines: (pricing.first ?? pricing.visit)?.quote.lines.filter((l) => l.amountCents !== 0).map((l) => `${l.label}: ${formatCents(l.amountCents)}`) ?? [],
      payment: body.payment?.policy ?? null,
      agreementRequired: body.agreement?.required === true,
    },
    unresolved: needs.map((n) => n.label),
    pricing,
  };
}

export const SALES_TOOLS: ChatTool[] = [
  {
    name: "read_sales_draft",
    label: "Reading the booking draft",
    description: "Read a Sales workspace draft (booking or proposal): customer, service and answers, schedule, server-calculated prices, payment and agreement choices, and what is still missing. Use it before suggesting anything about a draft.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { draftId: DRAFT } },
    run: async (ctx, args) => {
      const draft = await draftFor(ctx, args.draftId);
      if (!draft) return refused("No such draft in this company.");
      if (draft.mode === "proposal") {
        const customer = draft.customerId ? await ctx.db.get(draft.customerId) : null;
        const content = await buildContent(ctx, ctx.company, draft.segment === "office" ? "office" : draft.segment === "str" ? "str" : "commercial", customer, draft.body as DraftBody);
        return { status: "done", summary: `Read the ${draft.segment} proposal draft for ${content.client.name}`, data: { facts: { sites: content.sites.map((s) => ({ site: s.label, service: s.service?.name ?? null, cadence: s.cadence, priceCents: s.priceCents, priceBasis: s.priceBasis })), terms: content.terms, monthlyEstimateCents: content.totals.fixedMonthlyEstimateCents }, unresolved: content.unresolved, next: content.unresolved.length ? "Resolve what is listed, then save a version." : "Save a version and send it from the workspace." }, link: link(draft._id) };
      }
      const read = await bookingFacts(ctx, draft);
      return { status: "done", summary: `Read the ${draft.bookingKind === "recurring" ? "recurring" : "one-time"} booking draft${read.facts.customer ? ` for ${read.facts.customer}` : ""}`, data: { facts: read.facts, unresolved: read.unresolved, next: read.unresolved.length ? `Still needed: ${read.unresolved[0]}` : "Review the summary and send the booking request from the workspace." }, link: link(draft._id) };
    },
  },
  {
    name: "compare_service_options",
    label: "Comparing service options",
    description: "Price the same home or site with several published services and/or recurring cadences, side by side, using the engine. Answers (rooms, area) come from the draft unless given. Read only; it changes nothing.",
    kind: "read",
    minimumRole: "office",
    input: {
      type: "object",
      properties: {
        draftId: { ...DRAFT, optional: true },
        services: { type: "array", maxItems: 5, items: { type: "string", max: 120 }, description: "Service keys or exact names to compare." },
        cadences: { type: "array", maxItems: 5, optional: true, items: { type: "string", enum: ["one_time", "weekly", "every_2_weeks", "every_4_weeks", "monthly", "twice_monthly"] }, description: "Cadences to price; one_time for a single visit." },
      },
    },
    run: async (ctx, args) => {
      const draft = args.draftId ? await draftFor(ctx, args.draftId) : null;
      const input = (draft?.body as DraftBody | undefined)?.service?.input ?? {};
      const catalog = await publishedCatalog(ctx, ctx.company._id);
      const wanted = (Array.isArray(args.services) ? args.services : []).map(String);
      const services = catalog.filter((row) => wanted.some((w) => w === row.service.key || w.toLowerCase() === row.version.spec.name.toLowerCase()));
      if (!services.length) return refused("None of those are published services. List them with list_services.");
      const cadences = (Array.isArray(args.cadences) && args.cadences.length ? args.cadences : ["one_time"]).map(String);
      const rows = [];
      for (const service of services) {
        for (const kind of cadences) {
          const cadence: Cadence | null = kind === "one_time" ? null : kind === "weekly" ? { kind: "weekly", weekdays: [2] } : kind === "monthly" ? { kind: "monthly", dayOfMonth: 1 } : kind === "twice_monthly" ? { kind: "twice_monthly", days: [1, 15] } : { kind: kind as "every_2_weeks" | "every_4_weeks", weekday: 2 };
          const priced = await priceChoice(ctx, ctx.company, { key: service.service.key, input }, cadence ? { schedule: pricingSchedule(cadence) } : {}, null);
          rows.push({ service: service.version.spec.name, cadence: cadence ? cadenceLabel(cadence).replace(/ on .*/, "") : "One time", outcome: priced?.quote.outcome ?? null, perVisitCents: priced?.quote.totalCents ?? null, minutes: priced?.quote.time.elapsedMinutes ?? null, missing: priced?.quote.missing ?? [] });
        }
      }
      return { status: "done", summary: `Compared ${rows.length} option${rows.length === 1 ? "" : "s"}`, data: { facts: { answersUsed: input }, prepared: rows, unresolved: rows.filter((r) => r.perVisitCents === null).map((r) => `${r.service} (${r.cadence}): ${r.missing.join(", ") || "needs a walkthrough"}`), next: "Choose one in the workspace; the price there is recalculated on the server." } };
    },
  },
  {
    name: "explain_price",
    label: "Explaining the price",
    description: "Explain how the draft's price is made, line by line, and how a staff price change compares with the calculated price. Read only.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { draftId: DRAFT } },
    run: async (ctx, args) => {
      const draft = await draftFor(ctx, args.draftId);
      if (!draft || draft.mode !== "booking") return refused("Name a booking draft.");
      const read = await bookingFacts(ctx, draft);
      const lead = read.pricing.first ?? read.pricing.visit;
      if (!lead) return refused("The draft has no service yet.");
      const override = read.pricing.override;
      return {
        status: "done",
        summary: `Explained ${lead.name}'s price`,
        data: {
          facts: { lines: lead.quote.lines.map((l) => ({ label: l.label, detail: l.detail, amountCents: l.amountCents })), reasons: lead.quote.reasons, version: lead.version },
          prepared: override ? { calculatedCents: override.referenceCents, proposedCents: override.proposedCents, differenceCents: override.referenceCents !== null ? override.proposedCents - override.referenceCents : null, reason: override.reason || null } : null,
          approval: override && !isOwner(ctx.role) ? "A changed price needs the Owner's approval before anything is sent." : null,
          next: "Prices come from Services & Pricing. To change a rate for everyone, change the service there.",
        },
      };
    },
  },
  {
    name: "update_sales_draft",
    label: "Preparing changes to the draft",
    description: "Prepare changes to a booking draft's service, pricing answers, cadence, first visit, payment choice or notes. The person sees the exact change and approves it; the price is recalculated on the server. It never sets a price, a discount or a confirmation.",
    kind: "write",
    minimumRole: "office",
    confirm: true,
    input: {
      type: "object",
      properties: {
        draftId: DRAFT,
        service: { type: "string", max: 120, optional: true, description: "A published service key or exact name." },
        answers: {
          type: "object",
          optional: true,
          description: "Pricing answers to set. Only these are allowed.",
          properties: {
            area: { type: "number", optional: true },
            bedrooms: { type: "number", optional: true },
            bathrooms: { type: "number", optional: true },
            halfBaths: { type: "number", optional: true },
            units: { type: "number", optional: true },
            beds: { type: "number", optional: true },
            crewSize: { type: "number", optional: true },
            condition: { type: "string", max: 60, optional: true, description: "A condition level id of the service." },
          },
        },
        cadence: { type: "string", optional: true, enum: ["weekly", "every_2_weeks", "every_4_weeks", "monthly", "twice_monthly"] },
        firstVisitService: { type: "string", max: 120, optional: true, description: "For recurring service: a different first visit service, by key or name." },
        payment: { type: "string", optional: true, enum: ["deposit", "full", "invoice_terms", "after_service", "external"] },
        depositCents: { type: "number", optional: true },
        customerNote: { type: "string", max: 1000, optional: true },
      },
    },
    preview: async (ctx, args) => {
      const plan = await planChange(ctx, args);
      if ("why" in plan) return refused(plan.why);
      return { status: "needs_approval", preview: { summary: `Update the booking draft`, lines: plan.lines, bindsTo: stableHash({ draft: plan.draft._id, revision: plan.draft.revision, body: plan.body }) } };
    },
    run: async (ctx, args) => {
      const plan = await planChange(ctx, args);
      if ("why" in plan) return refused(plan.why);
      await ctx.db.patch(plan.draft._id, { body: plan.body, ...(plan.bookingKind ? { bookingKind: plan.bookingKind } : {}), revision: plan.draft.revision + 1, updatedBy: ctx.member._id, updatedAt: Date.now() });
      const fresh = (await ctx.db.get(plan.draft._id))!;
      const read = await bookingFacts(ctx, fresh);
      return { status: "done", summary: "Updated the booking draft", data: { prepared: plan.lines, facts: { firstCents: read.facts.firstCents, ongoingCents: read.facts.ongoingCents }, unresolved: read.unresolved, next: "Review the summary in the workspace; nothing was sent." }, link: link(plan.draft._id) };
    },
  },
  {
    name: "apply_walkthrough_findings",
    label: "Applying walkthrough findings",
    description: "Apply a completed walkthrough's recorded findings (area, rooms, condition, service questions) to the proposal site's pricing answers, after the person approves. Only recorded findings are used.",
    kind: "write",
    minimumRole: "office",
    confirm: true,
    input: { type: "object", properties: { assessmentId: { type: "string", max: 64 } } },
    preview: async (ctx, args) => {
      const row = await assessmentFor(ctx, args.assessmentId);
      if (!row) return refused("No such walkthrough.");
      if (row.status !== "completed") return refused("That walkthrough isn't complete yet.");
      const draft = row.draftId ? await ctx.db.get(row.draftId) : null;
      if (!draft) return refused("It isn't linked to a proposal draft.");
      const findings = Object.entries((row.findings ?? {}) as Record<string, unknown>).map(([k, v]) => `${k.replace(/^q:/, "")}: ${String(v)}`);
      return { status: "needs_approval", preview: { summary: "Apply the walkthrough's findings to the site's pricing", lines: findings.length ? findings : ["No findings recorded."], bindsTo: stableHash({ row: row._id, revision: draft.revision, findings: row.findings ?? null }) } };
    },
    run: async (ctx, args) => {
      const row = await assessmentFor(ctx, args.assessmentId);
      if (!row || !row.draftId) return refused("No such walkthrough.");
      const draft = await ctx.db.get(row.draftId);
      if (!draft) return refused("The proposal draft no longer exists.");
      const result = await applyFindings(ctx as unknown as MutationCtx, row, draft.revision, ctx.member._id);
      return { status: "done", summary: "Applied the findings to the site's pricing answers", data: { prepared: result.applied, next: "Review the site's price in the proposal, then save a version." }, link: link(draft._id) };
    },
  },
  {
    name: "draft_customer_message",
    label: "Drafting the customer's message",
    description: "Write the message that goes with a quote, booking request or proposal, from the draft's real details. Returns text for the person to read and send from the workspace; it sends nothing.",
    kind: "draft",
    minimumRole: "office",
    input: { type: "object", properties: { draftId: DRAFT, tone: { type: "string", optional: true, enum: ["friendly", "formal", "brief"] } } },
    run: async (ctx, args) => {
      const draft = await draftFor(ctx, args.draftId);
      if (!draft) return refused("No such draft.");
      const customer = draft.customerId ? await ctx.db.get(draft.customerId) : null;
      const first = customer?.name.split(" ")[0] ?? "there";
      if (draft.mode === "proposal") {
        const content = await buildContent(ctx, ctx.company, draft.segment === "office" ? "office" : draft.segment === "str" ? "str" : "commercial", customer, draft.body as DraftBody);
        const text = [`Hi ${first},`, "", `Thank you for walking us through ${content.sites.length === 1 ? "your site" : `your ${content.sites.length} sites`}. Our proposal is ready: it sets out the scope, how often we'll clean, the rates and the terms.`, content.totals.fixedMonthlyEstimateCents !== null ? `For the scheduled visits it comes to about ${formatCents(content.totals.fixedMonthlyEstimateCents)} a month on average, invoiced for the visits actually done.` : "", "You can accept it, ask for changes or decline from the link. Happy to talk it through.", "", ctx.company.name].filter(Boolean).join("\n");
        return { status: "done", summary: "Drafted the proposal message", data: { prepared: text, unresolved: content.unresolved, next: "Send the proposal from the workspace; the link is added when it is sent." } };
      }
      const read = await bookingFacts(ctx, draft);
      const text = [`Hi ${first},`, "", `Thanks for calling ${ctx.company.name}. Here's what we discussed: ${read.facts.service ?? "your cleaning"}${read.facts.cadence ? `, ${read.facts.cadence.toLowerCase()}` : ""}.`, read.facts.firstCents !== null ? `${draft.bookingKind === "recurring" ? "First visit" : "Price"}: ${formatCents(read.facts.firstCents)}${read.facts.ongoingCents !== null ? `, then ${formatCents(read.facts.ongoingCents)} per visit` : ""}.` : "", read.facts.dueNowCents ? `To hold the time we ask for ${formatCents(read.facts.dueNowCents)} up front through a secure link.` : "", "We'll confirm once everything is in place.", "", ctx.company.name].filter(Boolean).join("\n");
      return { status: "done", summary: "Drafted the booking message", data: { prepared: text, unresolved: read.unresolved, next: "Send the booking request from the workspace; it includes the secure links." } };
    },
  },
  {
    name: "service_setup_status",
    label: "Checking the service setup",
    description: "For an accepted proposal: what each site still needs before service starts (agreement signature, billing, access, schedule), and what to do next.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { proposalId: { type: "string", max: 64 } } },
    run: async (ctx, args) => {
      const id = typeof args.proposalId === "string" ? ctx.db.normalizeId("proposals", args.proposalId) : null;
      const proposal = id ? await ctx.db.get(id) : null;
      if (!proposal || proposal.companyId !== ctx.company._id) return refused("No such proposal.");
      if (!proposal.setupId) return refused("This proposal hasn't been accepted.");
      const setup = (await ctx.db.get(proposal.setupId))!;
      const agreement = setup.agreementId ? await ctx.db.get(setup.agreementId) : null;
      const sites = setup.sites.map((s) => ({ site: s.label, access: s.access, schedule: s.schedule, started: Boolean(s.planId || s.activatedAt) }));
      const unresolved = [!agreement ? "Prepare the agreement" : agreement.workflow !== "signed" ? `Agreement is ${agreement.workflow.replace(/_/g, " ")}` : null, setup.billing !== "done" ? "Confirm billing" : null, ...sites.filter((s) => s.access !== "done" && s.access !== "not_needed").map((s) => `${s.site}: confirm access`)].filter((x): x is string => Boolean(x));
      return { status: "done", summary: `${proposal.title}: ${unresolved.length ? `${unresolved.length} thing${unresolved.length === 1 ? "" : "s"} before service starts` : "ready to start"}`, data: { facts: { sites, startTogether: setup.startTogether }, unresolved, next: unresolved[0] ?? "Start each site's service from the setup." }, link: { href: `/app/agents/sales/setups/${setup._id}`, label: "Open the setup" } };
    },
  },
];

async function assessmentFor(ctx: ToolCtx, id: unknown): Promise<Doc<"assessments"> | null> {
  if (typeof id !== "string") return null;
  const normalized = ctx.db.normalizeId("assessments", id);
  const row = normalized ? await ctx.db.get(normalized) : null;
  return row && row.companyId === ctx.company._id ? row : null;
}

async function serviceKey(ctx: ToolCtx, value: unknown): Promise<string | null> {
  if (typeof value !== "string" || !value.trim()) return null;
  const direct = await publishedByKey(ctx, ctx.company._id, value.trim());
  if (direct) return direct.service.key;
  const catalog = await publishedCatalog(ctx, ctx.company._id);
  return catalog.find((row) => row.version.spec.name.toLowerCase() === value.trim().toLowerCase())?.service.key ?? null;
}

async function planChange(ctx: ToolCtx, args: Record<string, unknown>): Promise<{ draft: Doc<"salesDrafts">; body: DraftBody; lines: string[]; bookingKind?: "recurring" } | { why: string }> {
  const draft = await draftFor(ctx, args.draftId);
  if (!draft) return { why: "No such draft in this company." };
  if (draft.mode !== "booking") return { why: "Use the workspace to change proposal drafts." };
  if (draft.status === "confirmed" || draft.status === "requested") return { why: "This draft already has a booking. Changes go through the booking or Dispatch." };
  const body: DraftBody = JSON.parse(JSON.stringify(draft.body ?? {}));
  const lines: string[] = [];
  let bookingKind: "recurring" | undefined;
  if (args.service !== undefined) {
    const key = await serviceKey(ctx, args.service);
    if (!key) return { why: "That isn't a published service." };
    body.service = { key, input: body.service?.key === key ? body.service.input : {} };
    lines.push(`Service: ${(await publishedByKey(ctx, ctx.company._id, key))!.version.spec.name}`);
  }
  if (args.answers && typeof args.answers === "object") {
    if (!body.service) return { why: "Choose a service before setting its answers." };
    const allowed = ["area", "bedrooms", "bathrooms", "halfBaths", "units", "beds", "crewSize", "condition"];
    for (const [k, v] of Object.entries(args.answers as Record<string, unknown>)) {
      if (!allowed.includes(k) || (typeof v !== "number" && typeof v !== "string")) continue;
      if (typeof v === "number" && (!Number.isFinite(v) || v < 0 || v > 1_000_000)) continue;
      body.service.input = { ...body.service.input, [k]: v };
      lines.push(`${k}: ${String(v)}`);
    }
  }
  if (args.cadence !== undefined) {
    const kind = String(args.cadence);
    const cadence: Cadence = kind === "weekly" ? { kind: "weekly", weekdays: [2] } : kind === "monthly" ? { kind: "monthly", dayOfMonth: 1 } : kind === "twice_monthly" ? { kind: "twice_monthly", days: [1, 15] } : { kind: kind as "every_2_weeks" | "every_4_weeks", weekday: 2 };
    if (cadenceProblem(cadence)) return { why: "That cadence isn't valid." };
    body.recurring = { ...body.recurring, cadence };
    bookingKind = "recurring";
    lines.push(`How often: ${cadenceLabel(cadence)} (adjust the day in the workspace)`);
  }
  if (args.firstVisitService !== undefined) {
    const key = await serviceKey(ctx, args.firstVisitService);
    if (!key) return { why: "The first-visit service isn't published." };
    body.firstVisit = { mode: "different", service: { key, input: body.service?.input ?? {} } };
    lines.push(`First visit: ${(await publishedByKey(ctx, ctx.company._id, key))!.version.spec.name}`);
  }
  if (args.payment !== undefined) {
    body.payment = { ...body.payment, policy: String(args.payment) as NonNullable<DraftBody["payment"]>["policy"] };
    lines.push(`Payment: ${String(args.payment).replace(/_/g, " ")}`);
  }
  if (args.depositCents !== undefined) {
    const cents = Number(args.depositCents);
    if (!Number.isInteger(cents) || cents <= 0) return { why: "A deposit is a whole number of cents above zero." };
    body.payment = { ...body.payment, policy: "deposit", depositCents: cents };
    lines.push(`Deposit: ${formatCents(cents)}`);
  }
  if (typeof args.customerNote === "string") {
    body.notes = { ...body.notes, customer: args.customerNote.slice(0, 1000) };
    lines.push("Customer note updated");
  }
  if (!lines.length) return { why: "Say what to change." };
  lines.push("Prices are recalculated on the server from Services & Pricing. Nothing is sent.");
  return { draft, body, lines, bookingKind };
}

export type { Id };
