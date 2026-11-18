/**
 * Whether an experience can be published, in words an owner acts on. Blockers stop publishing; warnings
 * are shown and do not. Each item names where the fix lives, because most fixes belong to another part
 * of Selestial: a price is fixed in Services & Pricing, a deposit rule in the booking rules, an agreement
 * in Company Agreements, card payments in Finance. Editing an experience never changes any of them.
 */
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { verifiedPlan } from "../billing/access";
import { stripeState } from "../finance/stripeState";
import { businessSettingsOf } from "../settings/business";
import { publishedCatalog } from "../services/store";
import type { Spec } from "../services/spec";
import { prepareAgreement, sampleFacts } from "./agreement";
import { hasSupply, loadSupply } from "./capacity";
import type { Definition } from "./definition";
import { instantBlocker, sizePlan } from "./logic";
import type { BookingSettings } from "./settings";

export type Fix = "services" | "booking_rules" | "agreements" | "finance" | "business" | "experience" | "billing" | "cleaners";

export type Item = { severity: "blocker" | "warning"; message: string; fix: Fix; field?: string };

export const FIX_LINKS: Record<Fix, { href: string; label: string }> = {
  services: { href: "/app/services", label: "Open Services & Pricing" },
  booking_rules: { href: "/app/agents/sales/booking-forms?panel=rules", label: "Open booking rules" },
  agreements: { href: "/app/agreements/templates", label: "Open agreement templates" },
  finance: { href: "/app/finance/setup", label: "Set up payments" },
  business: { href: "/app/settings/business", label: "Open Business details" },
  experience: { href: "", label: "" },
  billing: { href: "/app/settings/billing", label: "Open Plan & Usage" },
  cleaners: { href: "/app/cleaners", label: "Open Cleaners" },
};

export type Catalog = Map<string, { name: string; spec: Spec; status: Doc<"services">["status"] }>;

export async function catalogOf(ctx: QueryCtx, companyId: Doc<"companies">["_id"]): Promise<Catalog> {
  const out: Catalog = new Map();
  for (const row of await publishedCatalog(ctx, companyId)) out.set(row.service.key, { name: row.version.spec.name, spec: row.version.spec, status: row.service.status });
  return out;
}

/** Everything that would stop this definition from taking a real booking. */
export async function readiness(ctx: QueryCtx, company: Doc<"companies">, def: Definition, settings: BookingSettings, catalog: Catalog): Promise<Item[]> {
  const items: Item[] = [];
  const block = (message: string, fix: Fix, field?: string) => items.push({ severity: "blocker", message, fix, field });
  const warn = (message: string, fix: Fix, field?: string) => items.push({ severity: "warning", message, fix, field });

  if (!verifiedPlan(company)) block("Booking pages need an active Operate or Expand plan.", "billing");
  if (!settings.handle) block("Choose your booking address in the booking rules (for example /b/bright-homes).", "booking_rules", "handle");

  const shown = def.services.offered.filter((s) => !s.hidden);
  if (!shown.length) block("Offer at least one service.", "experience", "services");
  const specs: Spec[] = [];
  for (const offered of def.services.offered) {
    const found = catalog.get(offered.serviceKey);
    if (!found) block(`"${offered.displayName || offered.serviceKey}" has no published version in Services & Pricing.`, "services", `service:${offered.serviceKey}`);
    else if (found.status !== "active") block(`"${found.name}" is archived in Services & Pricing.`, "services", `service:${offered.serviceKey}`);
    else if (!offered.hidden) specs.push(found.spec);
  }
  if (def.services.featuredKey && shown.every((s) => s.serviceKey !== def.services.featuredKey)) warn("The featured service is hidden, so nothing is featured.", "experience", "services");

  if (def.behavior.mode === "instant" && specs.length) {
    const bookable = specs.filter((spec) => !instantBlocker(spec, null));
    if (!bookable.length) block("None of the offered services can be booked instantly. Switch to an estimate or walkthrough request, or offer a service with a set price.", "experience", "behavior.mode");
    for (const spec of specs) {
      const why = instantBlocker(spec, null);
      if (why) warn(`"${spec.name}": ${why} Customers who choose it send a request instead.`, "services");
      else if (spec.pricing.method === "hourly_per_cleaner" || spec.pricing.method === "hourly_per_crew") warn(`"${spec.name}" is priced by the hour, so customers see an estimate and send a request.`, "services");
      if (spec.modifiers.recurring.enabled && def.services.showFrequencies) warn(`"${spec.name}" offers recurring schedules. Choosing one sends a request, because recurring visits and billing aren't connected yet.`, "services");
    }
  }

  const plan = sizePlan(specs, def.sizes.labels, def.behavior.customQuoteAboveArea);
  if (plan.area?.kind === "cards" && plan.area.cards.length === 0) warn("Every size is above the custom-quote size, so every visitor is sent to a request.", "experience", "behavior.customQuoteAboveArea");

  if (def.behavior.promotionId) {
    const carriers = specs.filter((spec) => spec.modifiers.promotions.some((p) => p.id === def.behavior.promotionId));
    if (!carriers.length) block("The chosen offer isn't a promotion on any offered service.", "services", "behavior.promotionId");
    else if (carriers.some((spec) => !spec.modifiers.promotions.find((p) => p.id === def.behavior.promotionId)!.approved)) block("The chosen offer isn't approved in Services & Pricing.", "services", "behavior.promotionId");
  }

  // Payment: a rule from the booking rules, and a way to take cards.
  if (def.behavior.paymentPolicyId) {
    const policy = settings.paymentPolicies.find((p) => p.id === def.behavior.paymentPolicyId);
    if (!policy) block("The chosen payment policy no longer exists in the booking rules.", "booking_rules", "behavior.paymentPolicyId");
    else if (policy.kind !== "none") {
      const stripe = await stripeState(ctx, company._id);
      if (!stripe.canPayByCard) block(`"${policy.label}" takes a card payment, but card payments aren't set up in Finance.`, "finance", "behavior.paymentPolicyId");
    }
  } else if (def.behavior.mode === "instant") {
    warn("No payment is taken when booking. The visit is invoiced through Finance as usual.", "booking_rules", "behavior.paymentPolicyId");
  }

  // Agreement: approved, and complete once a booking's facts are filled in.
  if (def.behavior.agreementId) {
    const rule = settings.agreements.find((a) => a.id === def.behavior.agreementId);
    if (!rule) block("The chosen agreement no longer exists in the booking rules.", "booking_rules", "behavior.agreementId");
    else {
      const prepared = await prepareAgreement(ctx, company._id, rule, sampleFacts(settings.profile.displayName, specs[0], company.timezone));
      if (!prepared.ok) {
        const missing = prepared.unresolved.map((u) => u.replace(/^\[\[TO CONFIRM:\s*|\]\]$/g, ""));
        block(missing.length ? `"${rule.label}" still needs: ${[...new Set(missing)].slice(0, 6).join(", ")}. Add them as standing answers in the booking rules.` : prepared.why, missing.length ? "booking_rules" : "agreements", "behavior.agreementId");
      }
    }
  }

  for (const t of def.content.trust) if (!t.confirmed) block(`Confirm that "${t.text}" is true before it's published.`, "experience", `trust:${t.id}`);

  // Where and when: the company's own rules, read from Business details.
  const business = businessSettingsOf(company);
  if (!business.serviceAreas.length) warn("No service ZIP codes are set, so every ZIP code is accepted.", "business");
  if (!business.hours.length) warn("No booking hours are set, so times are offered Monday to Saturday, 8 AM to 6 PM.", "business");
  if (def.behavior.mode === "instant" && settings.scheduling.mode === "capacity") {
    const supply = await loadSupply(ctx, company, Date.now(), Date.now() + 14 * 24 * 60 * 60_000);
    if (!hasSupply(supply)) warn("No ready cleaner has said when they work, so customers pick a preferred time and the office confirms it.", "cleaners");
  }
  return items;
}

export const blockersOf = (items: Item[]) => items.filter((i) => i.severity === "blocker");
