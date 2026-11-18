/**
 * The workspace draft: what a person has entered so far, in either mode.
 *
 * The draft is a working copy, autosaved with a revision. Nothing in it is trusted for money, authority
 * or state: every action that commits something (saving a quote, requesting or confirming a booking,
 * creating a proposal) re-reads the published services, prices on the server and checks permissions.
 * `cleanBody` only keeps the draft well-formed and bounded.
 */
import type { QuoteInput } from "../services/engine";
import { cadenceProblem, type Cadence } from "./cadence";
import type { PaymentPolicy, Segment } from "./schema";

export type ServiceChoice = { key: string; input: QuoteInput };

export type ProposalSiteDraft = {
  key: string;
  propertyId?: string;
  label: string;
  serviceKey?: string;
  input?: QuoteInput;
  /** A rate a person proposes instead of the calculated one. Needs a reason and approval. */
  customRateCents?: number;
  customReason?: string;
  cadence?: Cadence;
  /** STR: priced per turnover, scheduled from real turnover requests. */
  perTurnover?: boolean;
  initialChargeCents?: number;
  initialChargeLabel?: string;
  details?: Record<string, string | number | boolean>;
  /** Office: tasks and how often each happens. */
  matrix?: { task: string; frequency: "each_visit" | "weekly" | "monthly" | "quarterly" | "custom"; note?: string }[];
  assessment?: "not_needed" | "needed" | "requested" | "completed";
  accessNotes?: string;
};

export type ProposalDraft = {
  intro?: string;
  sites: ProposalSiteDraft[];
  options?: { id: string; label: string; description?: string; siteServiceKeys?: Record<string, string> }[];
  terms: {
    invoiceFrequency?: "per_visit" | "weekly" | "monthly";
    netDays?: number;
    contractTermMonths?: number;
    startPlan?: string;
    startTogether?: boolean;
    rushTerms?: string;
    restockPolicy?: string;
    expiresInDays?: number;
  };
  attachments?: { label: string; url: string }[];
};

export type DraftBody = {
  /** Booking mode: the service now (one-time) or the ongoing visit (recurring). */
  service?: ServiceChoice;
  /** Recurring only: a different first visit, such as a deep clean first. */
  firstVisit?: { mode: "same" | "first_clean" | "different"; service?: ServiceChoice };
  recurring?: { cadence?: Cadence; endDate?: string; billing?: "per_visit" | "monthly_consolidated" };
  schedule?: { date?: string; arrivalMinute?: number; windowMinutes?: number; proposed?: boolean; preferredCleanerId?: string; constraints?: string };
  payment?: { policy?: PaymentPolicy; depositCents?: number };
  agreement?: { required?: boolean; docType?: string };
  notes?: { customer?: string; cleaner?: string; office?: string };
  contacts?: { billing?: { name?: string; email?: string; phone?: string }; site?: { name?: string; phone?: string } };
  override?: { priceCents?: number; reason?: string };
  proposal?: ProposalDraft;
};

const MAX_BODY_CHARS = 60_000;

/** Keeps a draft body bounded and of the expected shape. It does not decide anything. */
export function cleanBody(body: unknown): DraftBody {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return {};
  const json = JSON.stringify(body);
  if (json.length > MAX_BODY_CHARS) throw new Error("This draft is too large to save. Remove some sites or notes.");
  return JSON.parse(json) as DraftBody;
}

export type Need = { key: string; section: "customer" | "service" | "schedule" | "payment" | "review" | "sites" | "assessment" | "terms"; label: string; blocking: boolean };

/** Facts the server worked out that the "still needed" list depends on. */
export type DraftFacts = {
  hasCustomer: boolean;
  hasProperty: boolean;
  customerReachable: boolean;
  inServiceArea: boolean | null;
  serviceFound: boolean;
  outcome: "firm" | "estimate" | "walkthrough" | "incomplete" | null;
  missing: string[];
  firstOutcome?: "firm" | "estimate" | "walkthrough" | "incomplete" | null;
  capacity: "fits" | "tight" | "full" | "closed" | "unknown" | null;
  overrideNeedsApproval: boolean;
  segment: Segment;
  bookingKind: "one_time" | "recurring";
};

/** What is still needed before a booking can be requested. A "proposed" date never satisfies confirmation. */
export function bookingNeeds(body: DraftBody, facts: DraftFacts): Need[] {
  const needs: Need[] = [];
  const add = (key: string, section: Need["section"], label: string, blocking = true) => needs.push({ key, section, label, blocking });
  if (!facts.hasCustomer) add("customer", "customer", "Choose or add the customer");
  if (!facts.hasProperty) add("property", "customer", "Choose or add the service address");
  if (facts.hasCustomer && !facts.customerReachable) add("contact", "customer", "Add an email or mobile number to send links to", false);
  if (facts.inServiceArea === false) add("area", "customer", "The address is outside the company's service area");
  if (!body.service?.key || !facts.serviceFound) add("service", "service", "Choose a published service");
  else if (facts.outcome === "incomplete") add("answers", "service", `Answer: ${facts.missing.join(", ")}`);
  else if (facts.outcome === "walkthrough") add("walkthrough", "service", "This service needs a walkthrough before a firm price: prepare a proposal or schedule an assessment");
  if (facts.bookingKind === "recurring") {
    const cadence = body.recurring?.cadence;
    if (!cadence) add("cadence", "schedule", "Choose how often");
    else {
      const problem = cadenceProblem(cadence);
      if (problem) add("cadence", "schedule", problem);
    }
    if (body.firstVisit?.mode === "different" && !body.firstVisit.service?.key) add("first", "service", "Choose the first visit's service");
    if (facts.firstOutcome === "incomplete") add("first-answers", "service", "Answer the first visit's pricing questions");
    if (facts.firstOutcome === "walkthrough") add("first-walkthrough", "service", "The first visit needs a walkthrough before a firm price");
  }
  if (!body.schedule?.date) add("date", "schedule", facts.bookingKind === "recurring" ? "Choose the first-service date" : "Choose the date");
  if (body.schedule?.arrivalMinute === undefined) add("time", "schedule", "Choose the arrival time");
  if (facts.capacity === "full") add("capacity", "schedule", "No crew is free at that time: pick another time or send it as a proposed date");
  if (facts.capacity === "closed") add("closed", "schedule", "That time is outside operating hours or in the past");
  if (!body.payment?.policy) add("payment", "payment", "Choose how the customer pays");
  if (body.payment?.policy === "deposit" && !(body.payment.depositCents && body.payment.depositCents > 0)) add("deposit", "payment", "Enter the deposit amount");
  if (body.override?.priceCents !== undefined && !body.override.reason?.trim()) add("override-reason", "review", "Give a reason for the price change");
  if (facts.overrideNeedsApproval) add("override-approval", "review", "The price change needs approval before it is sent", false);
  return needs;
}

/** What is still needed before a proposal can be previewed and sent. Unknown prices stay unresolved, never $0. */
export function proposalNeeds(body: DraftBody, facts: { hasCustomer: boolean; customerReachable: boolean; sitePrices: Record<string, { outcome: string | null; cents: number | null }> }): Need[] {
  const needs: Need[] = [];
  const add = (key: string, section: Need["section"], label: string, blocking = true) => needs.push({ key, section, label, blocking });
  const proposal = body.proposal;
  if (!facts.hasCustomer) add("customer", "customer", "Choose or add the client");
  if (facts.hasCustomer && !facts.customerReachable) add("contact", "customer", "Add the decision-maker's email");
  if (!proposal?.sites.length) add("sites", "sites", "Add at least one site");
  for (const site of proposal?.sites ?? []) {
    if (!site.propertyId) add(`site-${site.key}-address`, "sites", `${site.label || "A site"}: add its address`);
    if (!site.serviceKey) add(`site-${site.key}-service`, "sites", `${site.label || "A site"}: choose a service`);
    const price = facts.sitePrices[site.key];
    if (site.assessment === "needed" || site.assessment === "requested") add(`site-${site.key}-assessment`, "assessment", `${site.label || "A site"}: complete the walkthrough`);
    else if (site.customRateCents === undefined && (!price || price.cents === null)) add(`site-${site.key}-rate`, "sites", `${site.label || "A site"}: no rate yet${price?.outcome === "walkthrough" ? " (needs a walkthrough)" : ""}`);
    if (site.customRateCents !== undefined && !site.customReason?.trim()) add(`site-${site.key}-reason`, "sites", `${site.label || "A site"}: give a reason for the custom rate`);
    if (!site.cadence && !site.perTurnover) add(`site-${site.key}-cadence`, "sites", `${site.label || "A site"}: choose how often`);
  }
  if (!proposal?.terms.invoiceFrequency) add("invoice", "terms", "Choose how often you invoice");
  return needs;
}
