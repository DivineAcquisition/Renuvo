/**
 * Checks, hashes and reads for Services & Pricing. Everything a public function in convex/services.ts
 * needs that is not itself a public function.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { sha256 } from "../agreements/hash";
import { userError } from "../errors";
import { blockers, priceSummary, quote, usualLaborMinutes, type QuoteInput } from "./engine";
import type { AgentNote } from "./schema";
import { blankSpec, CATEGORY_LABELS, METHOD_LABELS, type Spec } from "./spec";
import { formatCents, minutesWords, scheduleLabel } from "./words";

// ── Canonical form and hash ─────────────────────────────────────────────────────────────────────────

/** JSON with sorted keys, so two specs that mean the same thing have one spelling and one hash. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const specHash = (spec: Spec) => sha256(canonical(spec));

export const inputHash = (input: QuoteInput) => sha256(canonical(input));

// ── Checking a spec before it is saved ──────────────────────────────────────────────────────────────

const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;
const MAX_CENTS = 100_000_00;

function str(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length > max) throw userError(`${label} is too long (${max} characters at most).`);
  return trimmed;
}
function id(value: string, label: string): string {
  const trimmed = value.trim();
  if (!ID.test(trimmed)) throw userError(`${label} needs an id of lower-case letters, numbers, dashes or underscores.`);
  return trimmed;
}
function num(value: number, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw userError(`${label} must be a number from ${min} to ${max}.`);
  if (integer && !Number.isInteger(value)) throw userError(`${label} must be a whole number.`);
  return value;
}
const cents = (value: number, label: string) => num(value, label, 0, MAX_CENTS, true);
const percent = (value: number, label: string) => Math.round(num(value, label, -100, 1000) * 100) / 100;
const minutes = (value: number, label: string) => num(value, label, 0, 24 * 60 * 7);
function date(value: string | null, label: string): string | null {
  if (value === null || value === "") return null;
  if (!DATE.test(value)) throw userError(`${label} must be a date written as YYYY-MM-DD.`);
  return value;
}
function list<T>(values: T[], label: string, max: number): T[] {
  if (values.length > max) throw userError(`${label}: ${max} at most.`);
  return values;
}
function unique(values: { id: string }[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw userError(`${label}: two share the id "${value.id}".`);
    seen.add(value.id);
  }
}
const adjustment = (a: { kind: "percent" | "fixed"; value: number }, label: string) => ({ kind: a.kind, value: a.kind === "percent" ? percent(a.value, label) : num(a.value, label, -MAX_CENTS, MAX_CENTS, true) });

/**
 * Tidies a spec and refuses anything malformed. It does not decide whether a service is complete: a draft
 * may be half-written. Completeness is checkSpec's job, at submission.
 */
export function normalizeSpec(input: Spec): Spec {
  const s = input;
  const included = list(s.included, "Included tasks", 150).map((item) => ({ id: id(item.id, "An included task"), label: str(item.label, "An included task", 200), ...(item.section?.trim() ? { section: str(item.section, "A section", 80) } : {}), requiresPhoto: item.requiresPhoto === true }));
  unique(included, "Included tasks");
  const addOns = list(s.addOns, "Extras", 60).map((a) => ({
    id: id(a.id, "An extra"),
    label: str(a.label, "An extra", 120),
    priceCents: cents(a.priceCents, `${a.label || "An extra"}'s price`),
    per: a.per,
    ...(a.itemWord?.trim() ? { itemWord: str(a.itemWord, "An extra's unit", 30) } : {}),
    laborMinutes: minutes(a.laborMinutes, `${a.label || "An extra"}'s time`),
    maxQuantity: num(a.maxQuantity, `${a.label || "An extra"}'s most per visit`, 1, 500, true),
    ...(a.coversItemId?.trim() ? { coversItemId: id(a.coversItemId, "The included task an extra covers") } : {}),
  }));
  unique(addOns, "Extras");

  const p = s.pricing;
  let pricing: Spec["pricing"];
  switch (p.method) {
    case "fixed":
      pricing = { method: p.method, amountCents: cents(p.amountCents, "The price"), laborMinutes: minutes(p.laborMinutes, "The time") };
      break;
    case "hourly_per_cleaner":
      pricing = { method: p.method, rateCents: cents(p.rateCents, "The hourly rate"), minimumHours: num(p.minimumHours, "The minimum hours", 0, 24), incrementMinutes: num(p.incrementMinutes, "The billing increment", 1, 120, true), estimatedLaborMinutes: minutes(p.estimatedLaborMinutes, "The usual time") };
      break;
    case "hourly_per_crew":
      pricing = { method: p.method, rateCents: cents(p.rateCents, "The hourly rate"), crewSize: num(p.crewSize, "The crew size", 1, 12, true), minimumHours: num(p.minimumHours, "The minimum hours", 0, 24), incrementMinutes: num(p.incrementMinutes, "The billing increment", 1, 120, true), estimatedElapsedMinutes: minutes(p.estimatedElapsedMinutes, "The usual time") };
      break;
    case "size_bands":
      pricing = { method: p.method, unit: p.unit, bands: list(p.bands, "Size bands", 30).map((b) => ({ from: num(b.from, "A band's start", 0, 10_000_000), to: b.to === null ? null : num(b.to, "A band's end", 0, 10_000_000), amountCents: cents(b.amountCents, "A band's price"), laborMinutes: minutes(b.laborMinutes, "A band's time") })).sort((a, b) => a.from - b.from) };
      break;
    case "per_area":
      pricing = { method: p.method, unit: p.unit, rateMillicents: num(p.rateMillicents, "The rate per area", 0, 100_000_000, true), laborMinutesPer1000: minutes(p.laborMinutesPer1000, "The time per 1,000"), walkthroughAbove: p.walkthroughAbove === null ? null : num(p.walkthroughAbove, "The walkthrough size", 1, 10_000_000) };
      break;
    case "bed_bath":
      pricing = {
        method: p.method,
        baseCents: cents(p.baseCents, "The base price"),
        includedBedrooms: num(p.includedBedrooms, "Included bedrooms", 0, 20, true),
        includedBathrooms: num(p.includedBathrooms, "Included bathrooms", 0, 20),
        perBedroomCents: cents(p.perBedroomCents, "The price per bedroom"),
        perBathroomCents: cents(p.perBathroomCents, "The price per bathroom"),
        perHalfBathCents: cents(p.perHalfBathCents, "The price per half bath"),
        baseLaborMinutes: minutes(p.baseLaborMinutes, "The base time"),
        perBedroomMinutes: minutes(p.perBedroomMinutes, "The time per bedroom"),
        perBathroomMinutes: minutes(p.perBathroomMinutes, "The time per bathroom"),
        perHalfBathMinutes: minutes(p.perHalfBathMinutes, "The time per half bath"),
      };
      break;
    case "per_unit":
      pricing = { method: p.method, unitWord: str(p.unitWord, "The unit", 30).toLowerCase(), unitCents: cents(p.unitCents, "The price per unit"), baseCents: cents(p.baseCents, "The base price"), minimumUnits: num(p.minimumUnits, "The minimum units", 0, 1000, true), laborMinutesPerUnit: minutes(p.laborMinutesPerUnit, "The time per unit"), baseLaborMinutes: minutes(p.baseLaborMinutes, "The base time") };
      break;
    case "recurring_package":
      pricing = { method: p.method, monthlyCents: cents(p.monthlyCents, "The monthly price"), basis: p.basis, schedule: p.schedule, includedVisits: num(p.includedVisits, "Included visits", 0, 31, true), extraVisitCents: p.extraVisitCents === null ? null : cents(p.extraVisitCents, "An extra visit's price"), laborMinutesPerVisit: minutes(p.laborMinutesPerVisit, "The time per visit") };
      break;
    case "custom_quote":
      pricing = { method: p.method, fromCents: p.fromCents === null ? null : cents(p.fromCents, "The starting price"), laborMinutes: p.laborMinutes === null ? null : minutes(p.laborMinutes, "The usual time") };
      break;
  }

  const m = s.modifiers;
  const zones = list(m.area.zones, "Areas", 30).map((z) => ({ id: id(z.id, "An area"), label: str(z.label, "An area's name", 60), postalCodes: list([...new Set(z.postalCodes.map((pc) => pc.trim().toUpperCase()).filter(Boolean))], `${z.label}'s postal codes`, 300), adjustment: adjustment(z.adjustment, `${z.label}'s adjustment`) }));
  unique(zones, "Areas");
  const promotions = list(m.promotions, "Promotions", 20).map((pr) => ({ id: id(pr.id, "A promotion"), label: str(pr.label, "A promotion's name", 80), discount: adjustment(pr.discount, "A promotion's discount"), startsOn: date(pr.startsOn, "A promotion's start"), endsOn: date(pr.endsOn, "A promotion's end"), approved: pr.approved === true }));
  unique(promotions, "Promotions");
  const peakDays = list(m.demand.peakDays, "Peak days", 20).map((d) => ({ id: id(d.id, "A peak day"), label: str(d.label, "A peak day's name", 60), weekdays: [...new Set(d.weekdays.map((w) => num(w, "A weekday", 0, 6, true)))].sort(), from: date(d.from, "A peak day's start"), to: date(d.to, "A peak day's end"), percent: num(d.percent, "A peak day's percent", 0, 100) }));
  const modifiers: Spec["modifiers"] = {
    condition: { enabled: m.condition.enabled, levels: list(m.condition.levels, "Condition levels", 8).map((l) => ({ id: id(l.id, "A condition"), label: str(l.label, "A condition's name", 60), pricePercent: percent(l.pricePercent, "A condition's price change"), timePercent: percent(l.timePercent, "A condition's time change"), requiresWalkthrough: l.requiresWalkthrough === true })) },
    firstClean: { enabled: m.firstClean.enabled, price: adjustment(m.firstClean.price, "The first-clean reset"), timePercent: percent(m.firstClean.timePercent, "The first clean's extra time") },
    recurring: { enabled: m.recurring.enabled, options: list(m.recurring.options, "Recurring options", 4).map((o) => ({ schedule: o.schedule, discount: adjustment(o.discount, `The ${scheduleLabel(o.schedule).toLowerCase()} discount`) })) },
    area: { enabled: m.area.enabled, zones, outside: m.area.outside },
    rush: { enabled: m.rush.enabled, adjustment: adjustment(m.rush.adjustment, "The rush charge") },
    afterHours: { enabled: m.afterHours.enabled, adjustment: adjustment(m.afterHours.adjustment, "The after-hours charge") },
    minimumCents: m.minimumCents === null ? null : cents(m.minimumCents, "The minimum charge"),
    promotions,
    discounts: { stacking: m.discounts.stacking, maxTotalPercent: num(m.discounts.maxTotalPercent, "The discount limit", 0, 100) },
    demand: { enabled: m.demand.enabled, peakDays, busyDay: { enabled: m.demand.busyDay.enabled, thresholdPercent: num(m.demand.busyDay.thresholdPercent, "The busy-day threshold", 1, 100), percent: num(m.demand.busyDay.percent, "The busy-day percent", 0, 100) }, capPercent: num(m.demand.capPercent, "The demand cap", 0, 100), endsOn: date(m.demand.endsOn, "Demand pricing's end date") },
    rounding: { stepCents: num(m.rounding.stepCents, "The rounding step", 0, 10_000, true), mode: m.rounding.mode },
  };
  if (new Set(modifiers.recurring.options.map((o) => o.schedule)).size !== modifiers.recurring.options.length) throw userError("Each recurring schedule can be listed once.");

  const questions = list(s.questions, "Quoting questions", 30).map((q) => ({ id: id(q.id, "A question"), label: str(q.label, "A question", 200), kind: q.kind, required: q.required === true, options: list(q.options.map((o) => str(o, "An answer", 80)).filter(Boolean), "Answers", 20), walkthroughIf: q.walkthroughIf === null ? null : { ...(q.walkthroughIf.equals !== undefined ? { equals: str(q.walkthroughIf.equals, "A walkthrough answer", 80) } : {}), ...(q.walkthroughIf.atLeast !== undefined ? { atLeast: num(q.walkthroughIf.atLeast, "A walkthrough number", -1e9, 1e9) } : {}) } }));
  unique(questions, "Quoting questions");

  let str_: Spec["str"] = null;
  if (s.str) {
    const t = s.str;
    if (!CLOCK.test(t.checkoutTime) || !CLOCK.test(t.checkinTime)) throw userError("Checkout and check-in are times written as HH:MM.");
    str_ = {
      enabled: t.enabled,
      linenSetsPerBed: num(t.linenSetsPerBed, "Linen sets per bed", 0, 10),
      setsPerLoad: num(t.setsPerLoad, "Sets per load", 0.5, 20),
      laundry: { location: t.laundry.location, loadCents: cents(t.laundry.loadCents, "The price per load"), loadMinutes: minutes(t.laundry.loadMinutes, "The time per load"), maxLoads: num(t.laundry.maxLoads, "Loads per turnover", 0, 50, true) },
      restock: list(t.restock, "Restocking items", 40).map((r) => ({ id: id(r.id, "A restocking item"), label: str(r.label, "A restocking item", 80), perTurnover: num(r.perTurnover, "A restocking quantity", 0, 500), rule: r.rule, markupPercent: num(r.markupPercent, "A restocking markup", 0, 200) })),
      checkoutTime: t.checkoutTime,
      checkinTime: t.checkinTime,
      deepCleanEveryTurnovers: t.deepCleanEveryTurnovers === null ? null : num(t.deepCleanEveryTurnovers, "Turnovers between deep cleans", 1, 500, true),
      conditionCharges: list(t.conditionCharges, "Condition charges", 20).map((c) => ({ id: id(c.id, "A condition charge"), label: str(c.label, "A condition charge", 80), amountCents: cents(c.amountCents, "A condition charge") })),
    };
  }

  const crew = num(s.team.crewSize, "The crew size", 1, 12, true);
  return {
    name: str(s.name, "The service name", 80),
    category: s.category,
    summary: str(s.summary, "The description", 1000),
    visitWord: s.visitWord,
    included,
    excluded: list(s.excluded.map((e) => str(e, "An exclusion", 200)).filter(Boolean), "Exclusions", 60),
    teamNotes: str(s.teamNotes, "Notes for the team", 2000),
    pricing,
    modifiers,
    team: { crewSize: crew, maxCrew: Math.max(crew, num(s.team.maxCrew, "The largest crew", 1, 12, true)), maxVisitMinutes: num(s.team.maxVisitMinutes, "The longest visit", 15, 24 * 60, true), skills: list([...new Set(s.team.skills.map((k) => k.trim().toLowerCase()).filter(Boolean))], "Skills", 20), arrivalWindowMinutes: num(s.team.arrivalWindowMinutes, "The arrival window", 0, 8 * 60, true) },
    addOns,
    questions,
    walkthroughNotes: list(s.walkthroughNotes.map((w) => str(w, "A walkthrough situation", 200)).filter(Boolean), "Walkthrough situations", 20),
    str: str_,
    requirements: list(s.requirements, "Requirements", 20).map((r) => ({ id: id(r.id, "A requirement"), label: str(r.label, "A requirement", 200), confirmed: r.confirmed === true })),
    illustrative: s.illustrative === true,
  };
}

// ── Keys ────────────────────────────────────────────────────────────────────────────────────────────

/** A stable, readable key from a name: "Deep clean" → "deep-clean", made unique within the company. */
export async function newKey(ctx: QueryCtx, companyId: Id<"companies">, name: string): Promise<string> {
  const stem = (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "service").padEnd(3, "x");
  for (let i = 0; i < 100; i += 1) {
    const key = i === 0 ? stem : `${stem}-${i + 1}`;
    const taken = await ctx.db
      .query("services")
      .withIndex("by_company_key", (q) => q.eq("companyId", companyId).eq("key", key))
      .first();
    if (!taken) return key;
  }
  throw userError("Too many services share that name.");
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────────────────

export async function ownedService(ctx: QueryCtx, companyId: Id<"companies">, serviceId: Id<"services">): Promise<Doc<"services">> {
  const row = await ctx.db.get(serviceId);
  if (!row || row.companyId !== companyId) throw userError("Not found.", "not_found");
  return row;
}

export async function draftOf(ctx: QueryCtx, companyId: Id<"companies">, serviceId: Id<"services">): Promise<Doc<"serviceDrafts"> | null> {
  return ctx.db
    .query("serviceDrafts")
    .withIndex("by_company_service", (q) => q.eq("companyId", companyId).eq("serviceId", serviceId))
    .first();
}

export async function versionOf(ctx: QueryCtx, companyId: Id<"companies">, serviceId: Id<"services">, version: number): Promise<Doc<"serviceVersions"> | null> {
  return ctx.db
    .query("serviceVersions")
    .withIndex("by_company_service_version", (q) => q.eq("companyId", companyId).eq("serviceId", serviceId).eq("version", version))
    .first();
}

export async function publishedSpec(ctx: QueryCtx, service: Doc<"services">): Promise<Doc<"serviceVersions"> | null> {
  if (!service.publishedVersionId) return null;
  const row = await ctx.db.get(service.publishedVersionId);
  return row && row.companyId === service.companyId ? row : null;
}

export async function openChanges(ctx: QueryCtx, companyId: Id<"companies">, serviceId: Id<"services">): Promise<Doc<"serviceChanges">[]> {
  const rows = await ctx.db
    .query("serviceChanges")
    .withIndex("by_company_service", (q) => q.eq("companyId", companyId).eq("serviceId", serviceId))
    .order("desc")
    .take(50);
  return rows.filter((row) => row.state === "in_review" || row.state === "approved" || row.state === "scheduled");
}

/** Active services with their published version, for anything that sells or schedules work. */
export async function publishedCatalog(ctx: QueryCtx, companyId: Id<"companies">): Promise<{ service: Doc<"services">; version: Doc<"serviceVersions"> }[]> {
  const rows = await ctx.db
    .query("services")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active"))
    .take(200);
  const out = [];
  for (const service of rows) {
    const version = await publishedSpec(ctx, service);
    if (version) out.push({ service, version });
  }
  return out.sort((a, b) => a.service.name.localeCompare(b.service.name));
}

/** The published service a visit names, by its key. Null when there is none. */
export async function publishedByKey(ctx: QueryCtx, companyId: Id<"companies">, key: string): Promise<{ service: Doc<"services">; version: Doc<"serviceVersions"> } | null> {
  const service = await ctx.db
    .query("services")
    .withIndex("by_company_key", (q) => q.eq("companyId", companyId).eq("key", key))
    .first();
  if (!service) return null;
  const version = await publishedSpec(ctx, service);
  return version ? { service, version } : null;
}

// ── Describing a change ─────────────────────────────────────────────────────────────────────────────

const labels = (items: { label: string }[]) => new Set(items.map((i) => i.label));

/** What differs between two versions, in sentences an owner can check. */
export function describeChanges(before: Spec | null, after: Spec): string[] {
  if (!before) return [`New service: ${after.name || "unnamed"} (${CATEGORY_LABELS[after.category]}), ${priceSummary(after)}.`];
  const out: string[] = [];
  if (before.name !== after.name) out.push(`Renamed from "${before.name}" to "${after.name}".`);
  if (before.summary !== after.summary) out.push("The customer description changed.");
  if (before.pricing.method !== after.pricing.method) out.push(`Pricing method: ${METHOD_LABELS[before.pricing.method].label} → ${METHOD_LABELS[after.pricing.method].label}.`);
  if (priceSummary(before) !== priceSummary(after)) out.push(`Price: ${priceSummary(before)} → ${priceSummary(after)}.`);
  const [ib, ia] = [labels(before.included), labels(after.included)];
  const added = [...ia].filter((l) => !ib.has(l));
  const removed = [...ib].filter((l) => !ia.has(l));
  if (added.length) out.push(`Now includes: ${added.join("; ")}.`);
  if (removed.length) out.push(`No longer includes: ${removed.join("; ")}.`);
  const [eb, ea] = [new Set(before.excluded), new Set(after.excluded)];
  const exAdded = [...ea].filter((l) => !eb.has(l));
  if (exAdded.length) out.push(`Newly excluded: ${exAdded.join("; ")}.`);
  for (const addOn of after.addOns) {
    const old = before.addOns.find((a) => a.id === addOn.id);
    if (!old) out.push(`New extra: ${addOn.label}, ${formatCents(addOn.priceCents)}.`);
    else if (old.priceCents !== addOn.priceCents) out.push(`${addOn.label}: ${formatCents(old.priceCents)} → ${formatCents(addOn.priceCents)}.`);
  }
  for (const old of before.addOns) if (!after.addOns.some((a) => a.id === old.id)) out.push(`Extra removed: ${old.label}.`);
  const [mb, ma] = [before.modifiers, after.modifiers];
  const toggles: [string, boolean, boolean][] = [
    ["Condition pricing", mb.condition.enabled, ma.condition.enabled],
    ["First-clean reset", mb.firstClean.enabled, ma.firstClean.enabled],
    ["Recurring discounts", mb.recurring.enabled, ma.recurring.enabled],
    ["Area pricing", mb.area.enabled, ma.area.enabled],
    ["Rush charge", mb.rush.enabled, ma.rush.enabled],
    ["After-hours charge", mb.afterHours.enabled, ma.afterHours.enabled],
    ["Demand pricing", mb.demand.enabled, ma.demand.enabled],
  ];
  for (const [label, was, now] of toggles) if (was !== now) out.push(`${label} switched ${now ? "on" : "off"}.`);
  if (canonical(mb) !== canonical(ma) && !toggles.some(([, was, now]) => was !== now)) out.push("Price adjustments (discounts, areas, minimum, demand or rounding) changed.");
  if (mb.minimumCents !== ma.minimumCents) out.push(`Minimum charge: ${mb.minimumCents === null ? "none" : formatCents(mb.minimumCents)} → ${ma.minimumCents === null ? "none" : formatCents(ma.minimumCents)}.`);
  if (before.team.crewSize !== after.team.crewSize) out.push(`Default crew: ${before.team.crewSize} → ${after.team.crewSize}.`);
  if (usualLaborMinutes(before) !== usualLaborMinutes(after)) out.push(`Usual time: ${minutesWords(usualLaborMinutes(before))} → ${minutesWords(usualLaborMinutes(after))} of labor.`);
  if (canonical(before.team.skills) !== canonical(after.team.skills)) out.push(`Skills required: ${after.team.skills.join(", ") || "none"}.`);
  if (out.length === 0 && canonical(before) !== canonical(after)) out.push("Details changed (questions, notes or short-term rental settings).");
  return out;
}

/** A few typical jobs for a spec, so a change shows real before-and-after prices. */
export function sampleInputs(spec: Spec): { label: string; input: QuoteInput }[] {
  const p = spec.pricing;
  const beds = spec.str?.enabled ? { beds: 2 } : {};
  switch (p.method) {
    case "size_bands":
      return p.bands.slice(0, 3).map((band) => {
        const area = band.to === null ? band.from + 500 : Math.round((band.from + band.to) / 2);
        return { label: `${area} ${p.unit === "sq_m" ? "m²" : "sq ft"}`, input: { area, ...beds } };
      });
    case "per_area":
      return [1000, 2500, 5000].map((area) => ({ label: `${area} ${p.unit === "sq_m" ? "m²" : "sq ft"}`, input: { area, ...beds } }));
    case "bed_bath":
      return [
        [2, 1],
        [3, 2],
        [4, 3],
      ].map(([bedrooms, bathrooms]) => ({ label: `${bedrooms} bed, ${bathrooms} bath`, input: { bedrooms, bathrooms, ...beds } }));
    case "per_unit":
      return [1, 3, 6].map((units) => ({ label: `${units} ${p.unitWord}${units === 1 ? "" : "s"}`, input: { units, ...beds } }));
    default:
      return [{ label: "A usual visit", input: { ...beds } }];
  }
}

export function priceComparison(before: Spec | null, after: Spec): { label: string; before: number | null; after: number | null }[] {
  return sampleInputs(after).map(({ label, input }) => ({
    label,
    before: before && before.pricing.method === after.pricing.method ? quote(before, input).totalCents : null,
    after: quote(after, input).totalCents,
  }));
}

// ── Specialists' review notes ──────────────────────────────────────────────────────────────────────

/**
 * Dispatch and Recruiter read the record and check the service against it, in code. They report and may
 * suggest a structured edit; nothing is changed unless a person applies it. Sales and Retention are not
 * released, and say so.
 */
export async function specialistNotes(ctx: QueryCtx, company: Doc<"companies">, spec: Spec): Promise<AgentNote[]> {
  const notes: AgentNote[] = [];
  const ready = await ctx.db
    .query("cleaners")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "ready"))
    .take(500);
  const skilled = ready.filter((cleaner) => spec.team.skills.every((skill) => cleaner.skills.includes(skill)));
  const sample = quote(spec, sampleInputs(spec)[0]?.input ?? {});
  const elapsed = sample.time.elapsedMinutes;

  // Dispatch: will a usual visit fit a day, the crew it needs, and (for a turnover) the window?
  const dispatchConcerns: string[] = [];
  let suggestion: AgentNote["suggestion"];
  if (elapsed > spec.team.maxVisitMinutes) {
    const crew = Math.ceil(sample.time.laborMinutes / spec.team.maxVisitMinutes - 1e-9);
    dispatchConcerns.push(`A usual visit runs about ${minutesWords(elapsed)} on site with ${spec.team.crewSize} cleaner${spec.team.crewSize === 1 ? "" : "s"}, past the ${minutesWords(spec.team.maxVisitMinutes)} limit.`);
    if (crew <= spec.team.maxCrew) suggestion = { label: `Set the default crew to ${crew}`, field: "team.crewSize", value: crew };
  }
  if (sample.str && sample.str.windowMinutes > 0 && elapsed > sample.str.windowMinutes) {
    const crew = Math.ceil(sample.time.laborMinutes / sample.str.windowMinutes - 1e-9);
    dispatchConcerns.push(`A usual turnover takes about ${minutesWords(elapsed)}, longer than the ${minutesWords(sample.str.windowMinutes)} between checkout and check-in.`);
    if (crew <= spec.team.maxCrew) suggestion = { label: `Set the default crew to ${crew}`, field: "team.crewSize", value: crew };
  }
  if (spec.team.crewSize > skilled.length) dispatchConcerns.push(`It needs ${spec.team.crewSize} cleaner${spec.team.crewSize === 1 ? "" : "s"}${spec.team.skills.length ? ` with ${spec.team.skills.join(", ")}` : ""}; ${skilled.length} ready cleaner${skilled.length === 1 ? " has" : "s have"} that today.`);

  // Dispatch: how long visits of this service actually took, from the record.
  const recent = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", company._id).eq("status", "completed"))
    .order("desc")
    .take(200);
  const durations: number[] = [];
  for (const job of recent.filter((j) => j.serviceType.trim().toLowerCase() === spec.name.trim().toLowerCase()).slice(0, 30)) {
    const rows = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", company._id).eq("jobId", job._id))
      .take(12);
    const timed = rows.filter((row) => row.checkIn && row.completion);
    if (timed.length) durations.push(Math.max(...timed.map((row) => (row.completion!.submittedAt - row.checkIn!.at) / 60_000)));
  }
  if (durations.length >= 3) {
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > elapsed * 1.2) dispatchConcerns.push(`The last ${durations.length} completed visits took a median of ${minutesWords(median)} on site; the estimate is ${minutesWords(elapsed)}.`);
  }
  notes.push(
    dispatchConcerns.length
      ? { agent: "dispatch", status: "concern", title: "Dispatch: timing or staffing may not hold", detail: dispatchConcerns.join(" "), ...(suggestion ? { suggestion } : {}) }
      : { agent: "dispatch", status: "ok", title: "Dispatch: fits the schedule", detail: `A usual visit is about ${minutesWords(elapsed)} on site with ${spec.team.crewSize} cleaner${spec.team.crewSize === 1 ? "" : "s"}${durations.length >= 3 ? `, in line with the last ${durations.length} completed visits` : ""}; ${skilled.length} ready cleaner${skilled.length === 1 ? "" : "s"} can do it.` },
  );

  // Recruiter: confirmed staffing only. No applicant is named or counted by person.
  if (spec.team.skills.length || spec.team.crewSize > 1) {
    const needs = await ctx.db
      .query("hiringNeeds")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "open"))
      .take(100);
    const matching = needs.filter((need) => spec.team.skills.every((skill) => need.requiredSkills.map((s) => s.toLowerCase()).includes(skill)));
    notes.push(
      skilled.length >= spec.team.crewSize
        ? { agent: "recruiter", status: "ok", title: "Recruiter: enough ready cleaners", detail: `${skilled.length} ready cleaner${skilled.length === 1 ? "" : "s"} meet${skilled.length === 1 ? "s" : ""} the requirements.` }
        : { agent: "recruiter", status: "concern", title: "Recruiter: not enough ready cleaners yet", detail: `${skilled.length} ready cleaner${skilled.length === 1 ? "" : "s"} meet${skilled.length === 1 ? "s" : ""} the requirements for a crew of ${spec.team.crewSize}. ${matching.length ? `${matching.length} open hiring need${matching.length === 1 ? "" : "s"} cover${matching.length === 1 ? "s" : ""} these skills.` : "No open hiring need covers these skills."}` },
    );
  }
  notes.push({ agent: "sales", status: "unavailable", title: "Sales has not reviewed this", detail: "Sales is not released yet, so nobody checked quoting friction. It will contribute when it is." });
  notes.push({ agent: "retention", status: "unavailable", title: "Retention has not reviewed this", detail: "Retention is not released yet, so no recurring offer was checked against customer patterns." });
  return notes;
}

export function submissionProblems(spec: Spec): string[] {
  return blockers(spec).map((problem) => problem.message);
}

export function emptySpecFor(category: Spec["category"]): Spec {
  return blankSpec(category);
}
