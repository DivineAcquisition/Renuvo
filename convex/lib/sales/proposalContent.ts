/**
 * What a proposal says, built on the server from the draft and the published services. The same content
 * is shown in the workspace preview, frozen as a version when it is saved, and shown to the customer.
 *
 * Rules the content keeps:
 *  - every price is the engine's on a published version, or a custom rate with its calculated reference,
 *    reason and approval; an unknown price stays unresolved (null) and never becomes $0;
 *  - how often the crew comes, how often the company invoices and how long the agreement runs are three
 *    separate things; a monthly figure is only ever an estimate from the real number of visits;
 *  - STR turnovers are priced per turnover and are not scheduled by accepting: each turnover is booked
 *    from a real request with its own capacity check, so no monthly total is promised.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { cadenceLabel, cadenceProblem, cadenceRate, pricingSchedule, type Cadence } from "./cadence";
import type { DraftBody, ProposalSiteDraft } from "./draft";
import { priceChoice } from "./pricing";
import type { ProposalTemplate } from "./schema";
import { scheduleFacts } from "../services/engine";

export type TemplateField = { key: string; label: string; kind: "text" | "number" | "choice" | "yes_no" | "longtext"; unit?: string; choices?: readonly string[]; customer: boolean };

/** Each template's site details. `customer: false` details are for the crew and office only. */
export const TEMPLATE_FIELDS: Record<ProposalTemplate, readonly TemplateField[]> = {
  commercial: [
    { key: "facilityType", label: "Facility type", kind: "choice", choices: ["Retail", "Medical", "Warehouse", "Restaurant", "Gym", "School", "Common areas", "Other"], customer: true },
    { key: "measuredArea", label: "Measured area", kind: "number", unit: "sq ft", customer: true },
    { key: "condition", label: "Condition at assessment", kind: "choice", choices: ["Well kept", "Average", "Needs a reset"], customer: true },
    { key: "serviceWindow", label: "Service window", kind: "text", customer: true },
    { key: "floorCare", label: "Floor care", kind: "longtext", customer: true },
    { key: "equipment", label: "Equipment and supplies", kind: "longtext", customer: true },
    { key: "constraints", label: "Site constraints", kind: "longtext", customer: false },
    { key: "exclusions", label: "Not included", kind: "longtext", customer: true },
  ],
  office: [
    { key: "workstations", label: "Workstations", kind: "number", customer: true },
    { key: "restrooms", label: "Restrooms", kind: "number", customer: true },
    { key: "kitchens", label: "Kitchens / break rooms", kind: "number", customer: true },
    { key: "meetingRooms", label: "Meeting rooms", kind: "number", customer: true },
    { key: "measuredArea", label: "Measured area", kind: "number", unit: "sq ft", customer: true },
    { key: "afterHoursAccess", label: "After-hours access", kind: "text", customer: false },
    { key: "consumables", label: "Consumables (paper, soap, liners)", kind: "choice", choices: ["Supplied by us, billed separately", "Supplied by the client", "Included"], customer: true },
    { key: "serviceWindow", label: "Service window", kind: "text", customer: true },
  ],
  str: [
    { key: "beds", label: "Beds to make", kind: "number", customer: true },
    { key: "laundry", label: "Laundry", kind: "choice", choices: ["On site", "Taken off site", "Host's laundry service"], customer: true },
    { key: "checkout", label: "Checkout time", kind: "text", customer: true },
    { key: "checkin", label: "Check-in time", kind: "text", customer: true },
    { key: "restock", label: "Restocking", kind: "longtext", customer: true },
    { key: "evidence", label: "Completion evidence", kind: "choice", choices: ["Photos of every room", "Photos and a checklist", "Checklist only"], customer: true },
    { key: "access", label: "Access", kind: "text", customer: false },
  ],
};

export const MATRIX_FREQUENCIES = { each_visit: "Each visit", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", custom: "As scheduled" } as const;

export type SiteContent = {
  key: string;
  propertyId: string | null;
  label: string;
  address: string | null;
  service: { key: string; name: string; version: number } | null;
  scope: string[];
  excluded: string[];
  details: { label: string; value: string }[];
  matrix: { task: string; frequency: string; note: string | null }[];
  cadence: string | null;
  cadenceRate: string | null;
  perTurnover: boolean;
  /** Per visit or per turnover. Null: not priced yet. */
  priceCents: number | null;
  priceBasis: "calculated" | "custom" | null;
  outcome: string | null;
  referenceCents: number | null;
  customReason: string | null;
  initialCharge: { label: string; cents: number } | null;
  /** Only for a fixed cadence: an average from the real number of visits in a year. */
  monthlyEstimateCents: number | null;
  monthlyVisits: number | null;
  assessment: string | null;
  /** For the office and crew, never shown to the customer. */
  internal: { accessNotes: string | null; privateDetails: { label: string; value: string }[]; versionId: string | null; input: Record<string, unknown> | null; durationMinutes: number | null; crew: number | null; cadence: Cadence | null };
};

export type ProposalContent = {
  template: ProposalTemplate;
  title: string;
  intro: string;
  client: { name: string; email: string | null };
  sites: SiteContent[];
  options: { id: string; label: string; description: string | null; sites: { key: string; serviceName: string | null; priceCents: number | null }[] }[];
  terms: {
    invoiceFrequency: string;
    netDays: number | null;
    contractTerm: string;
    startPlan: string | null;
    startTogether: boolean;
    rushTerms: string | null;
    restockPolicy: string | null;
  };
  totals: { initialCents: number; fixedMonthlyEstimateCents: number | null; anyVariable: boolean };
  expiresInDays: number;
  attachments: { label: string; url: string }[];
  unresolved: string[];
  customRates: boolean;
};

const INVOICE_WORDS = { per_visit: "Invoiced after each visit", weekly: "Invoiced weekly for the visits done", monthly: "Invoiced monthly for the visits done" } as const;

function valueWords(field: TemplateField, value: string | number | boolean | undefined): string | null {
  if (value === undefined || value === "" || value === null) return null;
  if (field.kind === "yes_no") return value ? "Yes" : "No";
  return `${value}${field.unit ? ` ${field.unit}` : ""}`;
}

/** The site's pricing answers, filled from its details where they say the same thing (beds, area), and one turnover per turnover price. */
function pricingInput(template: ProposalTemplate, site: ProposalSiteDraft) {
  const input = { ...(site.input ?? {}) };
  const beds = site.details?.beds;
  if (template === "str" && input.beds === undefined && typeof beds === "number") input.beds = beds;
  const area = site.details?.measuredArea;
  if (input.area === undefined && typeof area === "number" && area > 0) input.area = area;
  if (site.perTurnover && input.units === undefined) input.units = 1;
  return input;
}

async function siteContent(ctx: QueryCtx, company: Doc<"companies">, template: ProposalTemplate, site: ProposalSiteDraft): Promise<SiteContent> {
  const property = site.propertyId ? await ctx.db.get(site.propertyId as Id<"properties">) : null;
  const ownProperty = property && property.companyId === company._id ? property : null;
  const cadence = site.cadence && !cadenceProblem(site.cadence) ? site.cadence : null;
  const priced = site.serviceKey
    ? await priceChoice(ctx, company, { key: site.serviceKey, input: pricingInput(template, site) }, { ...(ownProperty ? { postalCode: ownProperty.address.postalCode } : {}), ...(cadence && !site.perTurnover ? { schedule: pricingSchedule(cadence) } : {}) }, null)
    : null;
  const calculated = priced && (priced.quote.outcome === "firm" || priced.quote.outcome === "estimate") ? priced.quote.totalCents : null;
  const custom = site.customRateCents !== undefined && Number.isInteger(site.customRateCents) && site.customRateCents > 0 ? site.customRateCents : null;
  const priceCents = custom ?? calculated;
  const fields = TEMPLATE_FIELDS[template];
  const details = fields.filter((f) => f.customer).map((f) => ({ label: f.label, value: valueWords(f, site.details?.[f.key]) })).filter((d): d is { label: string; value: string } => d.value !== null);
  const privateDetails = fields.filter((f) => !f.customer).map((f) => ({ label: f.label, value: valueWords(f, site.details?.[f.key]) })).filter((d): d is { label: string; value: string } => d.value !== null);
  let monthlyEstimateCents: number | null = null;
  let monthlyVisits: number | null = null;
  if (cadence && !site.perTurnover && priceCents !== null) {
    const facts = scheduleFacts(pricingSchedule(cadence));
    const perWeek = cadence.kind === "weekly" ? cadence.weekdays.length : 1;
    monthlyVisits = Math.round(facts.monthlyAverage * perWeek * 100) / 100;
    monthlyEstimateCents = Math.round(priceCents * monthlyVisits);
  }
  const spec = priced ? (await ctx.db.get(priced.versionId))?.spec : null;
  return {
    key: site.key,
    propertyId: ownProperty ? ownProperty._id : null,
    label: site.label || ownProperty?.label || ownProperty?.address.line1 || "Site",
    address: ownProperty ? `${ownProperty.address.line1}, ${ownProperty.address.city}, ${ownProperty.address.region} ${ownProperty.address.postalCode}` : null,
    service: priced ? { key: priced.serviceKey, name: priced.name, version: priced.version } : null,
    scope: priced?.quote.includedScope ?? [],
    excluded: spec?.excluded ?? [],
    details,
    matrix: (site.matrix ?? []).filter((row) => row.task.trim()).map((row) => ({ task: row.task.trim().slice(0, 200), frequency: MATRIX_FREQUENCIES[row.frequency] ?? "As scheduled", note: row.note?.trim() ? row.note.trim().slice(0, 200) : null })),
    cadence: site.perTurnover ? "Each turnover, when a stay ends" : cadence ? cadenceLabel(cadence as Cadence) : null,
    cadenceRate: site.perTurnover ? null : cadence ? cadenceRate(cadence as Cadence) : null,
    perTurnover: Boolean(site.perTurnover),
    priceCents,
    priceBasis: custom !== null ? "custom" : calculated !== null ? "calculated" : null,
    outcome: priced?.quote.outcome ?? null,
    referenceCents: custom !== null ? calculated : null,
    customReason: custom !== null ? (site.customReason?.trim() || null) : null,
    initialCharge: site.initialChargeCents && site.initialChargeCents > 0 ? { label: site.initialChargeLabel?.trim() || "Initial deep clean and setup", cents: site.initialChargeCents } : null,
    monthlyEstimateCents,
    monthlyVisits,
    assessment: site.assessment ?? null,
    internal: { accessNotes: site.accessNotes?.trim() || null, privateDetails, versionId: priced ? priced.versionId : null, input: priced ? (priced.input as Record<string, unknown>) : null, durationMinutes: priced ? Math.max(15, priced.quote.time.elapsedMinutes) : null, crew: priced ? priced.quote.time.crewSize : null, cadence },
  };
}

export async function buildContent(ctx: QueryCtx, company: Doc<"companies">, template: ProposalTemplate, customer: Doc<"customers"> | null, body: DraftBody): Promise<ProposalContent> {
  const draft = body.proposal ?? { sites: [], terms: {} };
  const sites: SiteContent[] = [];
  for (const site of draft.sites.slice(0, 25)) sites.push(await siteContent(ctx, company, template, site));
  const options: ProposalContent["options"] = [];
  for (const option of (draft.options ?? []).slice(0, 4)) {
    const rows = [];
    for (const site of draft.sites) {
      const key = option.siteServiceKeys?.[site.key];
      const content = key ? await siteContent(ctx, company, template, { ...site, serviceKey: key, customRateCents: undefined }) : null;
      rows.push({ key: site.key, serviceName: content?.service?.name ?? null, priceCents: content?.priceCents ?? null });
    }
    options.push({ id: option.id, label: option.label.trim().slice(0, 80) || "Alternative", description: option.description?.trim() || null, sites: rows });
  }
  const unresolved: string[] = [];
  for (const site of sites) {
    if (!site.service) unresolved.push(`${site.label}: no service chosen`);
    if (site.priceCents === null) unresolved.push(`${site.label}: no rate yet${site.outcome === "walkthrough" ? " (needs a walkthrough)" : site.outcome === "incomplete" ? " (answers missing)" : ""}`);
    if (site.assessment === "needed" || site.assessment === "requested") unresolved.push(`${site.label}: walkthrough not completed`);
    if (site.priceBasis === "custom" && !site.customReason) unresolved.push(`${site.label}: the custom rate needs a reason`);
    if (!site.perTurnover && !site.cadence) unresolved.push(`${site.label}: how often isn't set`);
  }
  for (const option of options) for (const row of option.sites) if (row.priceCents === null) unresolved.push(`${option.label}: ${sites.find((s) => s.key === row.key)?.label ?? "a site"} has no rate`);
  if (!draft.sites.length) unresolved.push("No sites yet");
  const fixed = sites.filter((s) => s.monthlyEstimateCents !== null);
  const months = draft.terms.contractTermMonths;
  return {
    template,
    title: `${customer?.name ?? "Client"} · ${template === "office" ? "office cleaning" : template === "str" ? "short-term rental turnovers" : "commercial cleaning"} proposal`,
    intro: draft.intro?.trim() || `Thank you for the opportunity to care for ${sites.length === 1 ? "your site" : "your sites"}. Here is our recommended plan.`,
    client: { name: customer?.name ?? "Client", email: customer?.email ?? null },
    sites,
    options,
    terms: {
      invoiceFrequency: INVOICE_WORDS[draft.terms.invoiceFrequency ?? "monthly"],
      netDays: draft.terms.netDays ?? null,
      contractTerm: !months ? "Month to month" : `${months} month${months === 1 ? "" : "s"}`,
      startPlan: draft.terms.startPlan?.trim() || null,
      startTogether: draft.terms.startTogether === true,
      rushTerms: template === "str" ? draft.terms.rushTerms?.trim() || null : null,
      restockPolicy: template === "str" ? draft.terms.restockPolicy?.trim() || null : null,
    },
    totals: { initialCents: sites.reduce((sum, s) => sum + (s.initialCharge?.cents ?? 0), 0), fixedMonthlyEstimateCents: fixed.length ? fixed.reduce((sum, s) => sum + (s.monthlyEstimateCents ?? 0), 0) : null, anyVariable: sites.some((s) => s.perTurnover) },
    expiresInDays: Math.min(Math.max(Math.round(draft.terms.expiresInDays ?? 30), 1), 120),
    attachments: (draft.attachments ?? []).filter((a) => /^https:\/\//.test(a.url)).slice(0, 10).map((a) => ({ label: a.label.slice(0, 80), url: a.url.slice(0, 500) })),
    unresolved,
    customRates: sites.some((s) => s.priceBasis === "custom"),
  };
}

/** The customer's copy: internal notes and private details removed. */
export function customerCopy(content: ProposalContent) {
  return { ...content, sites: content.sites.map(({ internal: _internal, referenceCents: _ref, customReason: _reason, ...site }) => site) };
}
