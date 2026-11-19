/**
 * One customer's booking, worked out from the record. `load` gathers what the session's experience,
 * the company's rules and the published services say; `recalc` works out every state again and saves
 * it; `view` is what the customer's page shows, and nothing more.
 *
 * The public view never carries internal costs, margins, cleaner names, staffing, other customers, team
 * notes or anything from another company. Access answers are shown back only as "saved".
 */
import { textConsentFor } from "../texting/pages";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { verifiedPlan } from "../billing/access";
import { settingsOf as financeSettingsOf, settingsRow as financeRow } from "../finance/settings";
import { stripeState } from "../finance/stripeState";
import { businessSettingsOf, normalizePostalCode, type BusinessSettings } from "../settings/business";
import { ENGINE_VERSION } from "../services/engine";
import { dayFullness } from "../services/operations";
import { canonical, inputHash, publishedByKey } from "../services/store";
import { scheduleLabel } from "../services/words";
import type { Spec } from "../services/spec";
import { localParts } from "../availability";
import { sha256 } from "../agreements/hash";
import { prepareAgreement, type BookingFacts, type Prepared } from "./agreement";
import { holdLive } from "./capacity";
import { upgradeDefinition, type BookingMode, type Definition, type OfferedService, type StepId } from "./definition";
import { confirmationGate, instantBlocker, price, promotionUsable, quoteInputFor, sizeComplete, sizeNeedsRequest, sizePlan, stepsFor, visibleQuestions, type SizePlan } from "./logic";
import { bookingSettingsOf, policyWords, type BookingSettings } from "./settings";
import type { BookingAgreementRule, PaymentPolicy, SessionQuote } from "./schema";

type Ctx = QueryCtx | MutationCtx;
const MINUTE = 60_000;

export type OfferedRow = { offered: OfferedService; spec: Spec; service: Doc<"services">; version: Doc<"serviceVersions"> };

export type Loaded = {
  company: Doc<"companies">;
  experience: Doc<"bookingExperiences">;
  def: Definition;
  settings: BookingSettings;
  business: BusinessSettings;
  /** Visible offered services that have a live published version, in the experience's order. */
  offered: OfferedRow[];
  plan: SizePlan;
  finance: { taxRateBps: number; taxLabel: string; taxable: Set<string> };
  policy: PaymentPolicy | null;
  agreementRule: BookingAgreementRule | null;
  /** The experience can take bookings right now, or why not. */
  eligible: { ok: boolean; why?: string };
  canPayByCard: boolean;
  stripeTestMode: boolean;
};

/** The definition a session runs on: its pinned published version, or the live draft for a test. */
export async function definitionFor(ctx: Ctx, session: Pick<Doc<"bookingSessions">, "companyId" | "experienceId" | "version" | "test">, experience: Doc<"bookingExperiences">): Promise<Definition> {
  if (session.test || session.version === 0) return upgradeDefinition(experience.draft);
  const row = await ctx.db
    .query("bookingExperienceVersions")
    .withIndex("by_company_experience_version", (q) => q.eq("companyId", session.companyId).eq("experienceId", session.experienceId).eq("version", session.version))
    .unique();
  return upgradeDefinition(row?.definition ?? experience.draft);
}

export async function offeredRows(ctx: Ctx, companyId: Id<"companies">, def: Definition): Promise<OfferedRow[]> {
  const rows: OfferedRow[] = [];
  for (const offered of def.services.offered) {
    if (offered.hidden) continue;
    const found = await publishedByKey(ctx, companyId, offered.serviceKey);
    if (!found || found.service.status !== "active") continue;
    rows.push({ offered, spec: found.version.spec, service: found.service, version: found.version });
  }
  return rows;
}

export async function load(ctx: Ctx, session: Doc<"bookingSessions">, company: Doc<"companies">): Promise<Loaded> {
  const experience = (await ctx.db.get(session.experienceId))!;
  const def = await definitionFor(ctx, session, experience);
  const settings = await bookingSettingsOf(ctx, company);
  const offered = await offeredRows(ctx, company._id, def);
  const fin = financeSettingsOf(await financeRow(ctx, company._id));
  const policy = def.behavior.paymentPolicyId ? (settings.paymentPolicies.find((p) => p.id === def.behavior.paymentPolicyId) ?? null) : null;
  const agreementRule = def.behavior.agreementId ? (settings.agreements.find((a) => a.id === def.behavior.agreementId) ?? null) : null;
  const stripe = await stripeState(ctx, company._id);
  let eligible: Loaded["eligible"] = { ok: true };
  if (company.suspendedAt) eligible = { ok: false, why: "This company isn't taking online bookings right now." };
  else if (!session.test && !verifiedPlan(company)) eligible = { ok: false, why: "This company isn't taking online bookings right now." };
  else if (!session.test && experience.status !== "published") eligible = { ok: false, why: "This booking page has been closed. Please contact the company." };
  else if (!offered.length) eligible = { ok: false, why: "No services are available to book right now." };
  return {
    company,
    experience,
    def,
    settings,
    business: businessSettingsOf(company),
    offered,
    plan: sizePlan(
      offered.map((r) => r.spec),
      def.sizes.labels,
      def.behavior.customQuoteAboveArea,
    ),
    finance: { taxRateBps: fin.taxRateBps ?? 0, taxLabel: fin.taxLabel, taxable: new Set(fin.taxableServiceIds) },
    policy,
    agreementRule,
    eligible,
    canPayByCard: stripe.canPayByCard,
    stripeTestMode: stripe.testMode,
  };
}

export function inArea(business: BusinessSettings, postalCode: string): boolean {
  return business.serviceAreas.length === 0 || business.serviceAreas.includes(normalizePostalCode(postalCode));
}

/** Why this session must become a request instead of an instant booking, or null. */
export function requestReason(session: Doc<"bookingSessions">, L: Loaded, quote: SessionQuote | null): string | null {
  if (L.def.behavior.mode === "estimate_request") return "estimate";
  if (L.def.behavior.mode === "walkthrough_request") return "walkthrough";
  if (sizeNeedsRequest(L.plan, session.home, L.def.behavior.customQuoteAboveArea)) return "size";
  const row = session.selection ? L.offered.find((r) => r.offered.serviceKey === session.selection!.serviceKey) : null;
  if (row) {
    const blocked = instantBlocker(row.spec, session.selection ?? null);
    if (blocked) return "service";
  }
  if (quote && (quote.outcome === "walkthrough" || quote.outcome === "estimate")) return quote.outcome;
  return null;
}

export const REQUEST_WORDS: Record<string, string> = {
  estimate: "This page sends a request. The team replies with a price.",
  walkthrough: "This page asks for a walkthrough. The team will arrange a time to see the property.",
  size: "This property is larger than we price online, so we'll prepare a custom quote.",
  service: "This choice is set up by the team, so it's sent as a request.",
};

/** The quote for the selected service, from the one engine, with tax and the payment split. */
export async function quoteFor(ctx: Ctx, session: Doc<"bookingSessions">, L: Loaded): Promise<SessionQuote | null> {
  const sel = session.selection;
  if (!sel) return null;
  const row = L.offered.find((r) => r.offered.serviceKey === sel.serviceKey);
  if (!row) return null;
  const date = session.schedule ? localParts(session.schedule.startsAt, L.company.timezone).day : undefined;
  const promotionId = promotionUsable(row.spec, L.def.behavior.promotionId, date).ok ? L.def.behavior.promotionId : null;
  const input = quoteInputFor(row.spec, { home: session.home, selection: sel, postalCode: session.postalCode, date, promotionId });
  if (date && row.spec.modifiers.demand.enabled && row.spec.modifiers.demand.busyDay.enabled && session.schedule) {
    const fullness = await dayFullness(ctx, L.company, session.schedule.startsAt);
    if (fullness !== undefined) input.dayFullnessPercent = fullness;
  }
  const policy = requestReasonless(session, L) ? L.policy : null;
  const priced = price(row.spec, input, { taxRateBps: L.finance.taxRateBps, taxable: L.finance.taxable.has(row.service.key), policy });
  const q = priced.quote;
  return {
    serviceKey: row.service.key,
    serviceId: row.service._id,
    versionId: row.version._id,
    version: row.version.version,
    engineVersion: ENGINE_VERSION,
    input: canonical(input),
    inputHash: inputHash(input),
    outcome: q.outcome,
    reasons: q.reasons,
    missing: q.missing,
    per: q.per,
    lines: q.lines.filter((line) => line.kind !== "info").map((line) => ({ key: line.key, kind: line.kind, label: line.label.slice(0, 200), detail: line.detail.slice(0, 300), amountCents: line.amountCents })),
    totalCents: q.totalCents,
    taxCents: priced.taxCents,
    ...(priced.taxCents ? { taxLabel: L.finance.taxLabel } : {}),
    grandTotalCents: priced.grandTotalCents,
    dueNowCents: priced.dueNowCents,
    balanceCents: priced.balanceCents,
    policy: policy ? { id: policy.id, label: policy.label, kind: policy.kind, ...(policy.percent !== undefined ? { percent: policy.percent } : {}), ...(policy.cents !== undefined ? { cents: policy.cents } : {}), balanceTerms: policy.balanceTerms } : null,
    elapsedMinutes: Math.max(15, Math.round(q.time.elapsedMinutes || row.spec.team.maxVisitMinutes / 2)),
    crew: Math.max(1, q.time.crewSize || row.spec.team.crewSize),
    windowMinutes: row.spec.team.arrivalWindowMinutes || L.settings.scheduling.defaultWindowMinutes,
    ...(sel.schedule ? { schedule: sel.schedule } : {}),
    computedAt: Date.now(),
  };
}

/** True when nothing about the mode or the size already makes this a request (the selected service is checked by the quote). */
function requestReasonless(session: Doc<"bookingSessions">, L: Loaded): boolean {
  return L.def.behavior.mode === "instant" && !sizeNeedsRequest(L.plan, session.home, L.def.behavior.customQuoteAboveArea);
}

export function customerName(session: Pick<Doc<"bookingSessions">, "contact">): string {
  return session.contact ? `${session.contact.firstName} ${session.contact.lastName}`.trim() : "";
}

export function addressLine(address: Doc<"bookingSessions">["address"]): string {
  if (!address) return "";
  return [address.line1, address.line2, `${address.city}, ${address.region} ${address.postalCode}`].filter(Boolean).join(", ");
}

export function agreementFacts(session: Doc<"bookingSessions">, L: Loaded, quote: SessionQuote | null): BookingFacts {
  const row = quote ? L.offered.find((r) => r.service.key === quote.serviceKey) : undefined;
  return {
    companyName: L.settings.profile.displayName || L.company.name,
    customerName: customerName(session) || undefined,
    address: addressLine(session.address) || undefined,
    spec: row?.spec,
    priceCents: quote?.grandTotalCents ?? undefined,
    depositCents: quote && quote.dueNowCents && quote.dueNowCents < (quote.grandTotalCents ?? 0) ? quote.dueNowCents : undefined,
    startsAt: session.schedule?.startsAt,
    windowMinutes: session.schedule?.windowMinutes,
    elapsedMinutes: quote?.elapsedMinutes,
    timezone: L.company.timezone,
    accessNotes: session.accessNotes,
    schedule: session.selection?.schedule,
  };
}

export async function agreementFor(ctx: Ctx, session: Doc<"bookingSessions">, L: Loaded, quote: SessionQuote | null): Promise<Prepared | null> {
  if (!L.agreementRule) return null;
  return prepareAgreement(ctx, L.company._id, L.agreementRule, agreementFacts(session, L, quote));
}

/** Whether the customer has given everything the booking needs, apart from price, time, signature and payment. */
export function answersComplete(session: Doc<"bookingSessions">, L: Loaded, request: boolean): boolean {
  if (!session.contact || !session.postalCode) return false;
  if (!request && !sizeComplete(L.plan, session.home)) return false;
  if (!session.address) return false;
  const questions = visibleQuestions(L.def.behavior.questions, { answers: session.answers, serviceKey: session.selection?.serviceKey ?? null, mode: L.def.behavior.mode });
  for (const q of questions) {
    if (!q.required) continue;
    if (q.purpose === "access") {
      if (!session.accessAnswered?.includes(q.id)) return false;
    } else if (session.answers[q.id] === undefined) return false;
  }
  return true;
}

/** Works every state out again from the record and saves them. Called after every change. */
export async function recalc(ctx: MutationCtx, sessionId: Id<"bookingSessions">): Promise<Doc<"bookingSessions">> {
  const session = (await ctx.db.get(sessionId))!;
  const company = (await ctx.db.get(session.companyId))!;
  if (session.status !== "active") return session;
  const L = await load(ctx, session, company);
  const quote = await quoteFor(ctx, session, L);
  const reason = requestReason(session, L, quote);
  const request = reason !== null;
  const hold = session.schedule?.holdId ? await ctx.db.get(session.schedule.holdId) : null;
  const capacityState: Doc<"bookingSessions">["capacityState"] = !session.schedule ? "none" : session.schedule.preferredOnly ? "requested" : hold?.status === "committed" ? "committed" : holdLive(hold) ? "held" : "expired";
  const prepared = request ? null : await agreementFor(ctx, session, L, quote);
  const acceptance = session.acceptanceId ? await ctx.db.get(session.acceptanceId) : null;
  const agreementState: Doc<"bookingSessions">["agreementState"] = !L.agreementRule || request ? "not_required" : acceptance && prepared?.ok && acceptance.contentHash === prepared.hash ? "accepted" : "pending";
  const payment = session.paymentId ? await ctx.db.get(session.paymentId) : null;
  const pays = !request && Boolean(quote && quote.dueNowCents > 0);
  // Money that arrived (or is arriving) is never forgotten, even if the booking no longer asks for any.
  const moneyIn = payment !== null && (payment.status === "succeeded" || payment.status === "processing");
  let paymentState: Doc<"bookingSessions">["paymentState"] = pays ? "pending" : "not_required";
  if (session.paymentState === "simulated") paymentState = "simulated";
  else if (payment && (pays || moneyIn)) paymentState = payment.status === "succeeded" ? "succeeded" : payment.status === "processing" ? "processing" : payment.status === "failed" ? "failed" : payment.status === "awaiting_customer" || payment.status === "checking" ? "started" : "pending";
  const quoteState: Doc<"bookingSessions">["quoteState"] = !quote ? "none" : session.accepted && (session.accepted.inputHash !== quote.inputHash || session.accepted.grandTotalCents !== quote.grandTotalCents) ? "changed" : quote.outcome;
  // A received payment counts only for the booking it paid for: the same total, and at least what is due now.
  let paymentMismatch = false;
  if (payment?.status === "succeeded") {
    const invoice = await ctx.db.get(payment.invoiceId);
    paymentMismatch = request || !quote || quote.grandTotalCents === null || !invoice || invoice.totals.totalCents !== quote.grandTotalCents || payment.amountCents < quote.dueNowCents;
  }
  const complete = answersComplete(session, L, request);
  const gate = confirmationGate({
    request,
    answersComplete: complete || (L.def.behavior.detailsTiming === "after_payment" && Boolean(session.contact && session.postalCode)),
    quote: quote ? { outcome: quote.outcome, grandTotalCents: quote.grandTotalCents, inputHash: quote.inputHash } : null,
    accepted: session.accepted ?? null,
    agreementRequired: agreementState !== "not_required",
    agreementAccepted: agreementState === "accepted",
    paymentRequired: pays,
    paymentSucceeded: (paymentState === "succeeded" && !paymentMismatch) || paymentState === "simulated",
    paymentMismatch,
    capacity: capacityState,
    eligible: L.eligible.ok,
    eligibilityWhy: L.eligible.why,
  });
  await ctx.db.patch(session._id, {
    quote: quote ?? undefined,
    quoteState,
    answersState: complete ? "complete" : "incomplete",
    agreementState,
    paymentState,
    capacityState,
    blockers: gate.blockers,
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(session._id))!;
}

// ── The customer's view ─────────────────────────────────────────────────────────────────────────────

export type OfferView = {
  serviceKey: string;
  /** The service's own name and summary in Services & Pricing, before any display wording. */
  serviceName: string;
  summary: string;
  name: string;
  blurb: string;
  benefits: string[];
  badge: string;
  featured: boolean;
  included: string[];
  excluded: string[];
  per: string;
  /** The price for this property, when there is one. */
  outcome: "firm" | "estimate" | "walkthrough" | "incomplete";
  grandTotalCents: number | null;
  dueNowCents: number;
  balanceCents: number;
  fromCents: number | null;
  reasons: string[];
  missing: string[];
  request: string | null;
  extras: { id: string; label: string; priceCents: number; per: "visit" | "item" | "hour"; itemWord: string | null; max: number; included: boolean }[];
  conditions: { id: string; label: string }[];
  frequencies: { schedule: string; label: string; discount: string }[];
  questions: { id: string; label: string; kind: "number" | "choice" | "yes_no" | "text"; required: boolean; options: string[] }[];
  unitWord: string | null;
};

function discountWords(a: { kind: "percent" | "fixed"; value: number }): string {
  return a.kind === "percent" ? `${a.value}% off each visit` : `$${(a.value / 100).toFixed(2)} off each visit`;
}

/** The price this property would pay for each offered service, worked out with the same engine. */
export async function offersFor(ctx: Ctx, session: Doc<"bookingSessions">, L: Loaded): Promise<OfferView[]> {
  const out: OfferView[] = [];
  const date = session.schedule ? localParts(session.schedule.startsAt, L.company.timezone).day : undefined;
  for (const row of L.offered) {
    const spec = row.spec;
    const own = session.selection?.serviceKey === row.service.key ? session.selection : null;
    const promotionId = promotionUsable(spec, L.def.behavior.promotionId, date).ok ? L.def.behavior.promotionId : null;
    const input = quoteInputFor(spec, { home: session.home, selection: own ?? { serviceKey: row.service.key, addOns: [], answers: session.selection?.answers ?? {} }, postalCode: session.postalCode, date, promotionId });
    const blocked = instantBlocker(spec, own);
    const policy = L.def.behavior.mode === "instant" && !blocked ? L.policy : null;
    const priced = price(spec, input, { taxRateBps: L.finance.taxRateBps, taxable: L.finance.taxable.has(row.service.key), policy });
    const q = priced.quote;
    const request = L.def.behavior.mode !== "instant" ? REQUEST_WORDS[L.def.behavior.mode === "estimate_request" ? "estimate" : "walkthrough"] : blocked ? blocked : q.outcome === "walkthrough" ? "This property needs a walkthrough before a firm price." : q.outcome === "estimate" ? "This is an estimate. The team confirms the price." : null;
    out.push({
      serviceKey: row.service.key,
      serviceName: spec.name,
      summary: spec.summary,
      name: row.offered.displayName || spec.name,
      blurb: row.offered.blurb || spec.summary,
      benefits: row.offered.benefits.length ? row.offered.benefits : spec.included.slice(0, 6).map((item) => (item.section ? `${item.section}: ${item.label}` : item.label)),
      badge: row.offered.badge,
      featured: L.def.services.featuredKey === row.service.key,
      included: spec.included.map((item) => (item.section ? `${item.section}: ${item.label}` : item.label)),
      excluded: spec.excluded,
      per: q.per,
      outcome: q.outcome,
      grandTotalCents: priced.grandTotalCents,
      dueNowCents: priced.dueNowCents,
      balanceCents: priced.balanceCents,
      fromCents: spec.pricing.method === "custom_quote" ? spec.pricing.fromCents : null,
      reasons: q.reasons,
      missing: q.missing,
      request,
      extras: L.def.services.showExtras
        ? spec.addOns.map((a) => ({ id: a.id, label: a.label, priceCents: a.priceCents, per: a.per, itemWord: a.itemWord ?? null, max: a.maxQuantity, included: Boolean(a.coversItemId && spec.included.some((i) => i.id === a.coversItemId)) }))
        : [],
      conditions: spec.modifiers.condition.enabled ? spec.modifiers.condition.levels.map((l) => ({ id: l.id, label: l.label })) : [],
      frequencies: L.def.services.showFrequencies && spec.modifiers.recurring.enabled ? spec.modifiers.recurring.options.map((o) => ({ schedule: o.schedule, label: scheduleLabel(o.schedule), discount: discountWords(o.discount) })) : [],
      questions: spec.questions.map((qq) => ({ id: qq.id, label: qq.label, kind: qq.kind, required: qq.required, options: qq.options })),
      unitWord: spec.pricing.method === "per_unit" ? spec.pricing.unitWord : null,
    });
  }
  return out;
}

export type SessionView = Awaited<ReturnType<typeof view>>;

/** Everything the customer's page needs for this session. */
export async function view(ctx: Ctx, session: Doc<"bookingSessions">, company: Doc<"companies">) {
  const L = await load(ctx, session, company);
  const quote = session.quote ?? null;
  const reason = requestReason(session, L, quote);
  const request = reason !== null;
  const outOfArea = session.inArea === false;
  const pays = !request && Boolean(quote && quote.dueNowCents > 0);
  const steps = stepsFor(L.def, { mode: L.def.behavior.mode as BookingMode, sizeNeeded: L.plan.needed, outOfArea, request, pays });
  const prepared = request || !session.selection ? null : await agreementFor(ctx, session, L, quote);
  const acceptance = session.acceptanceId ? await ctx.db.get(session.acceptanceId) : null;
  const logoUrl = L.settings.profile.logo ? await ctx.storage.getUrl(L.settings.profile.logo) : null;
  const heroUrl = L.def.theme.heroImage ? await ctx.storage.getUrl(L.def.theme.heroImage) : null;
  const payment = session.paymentId ? await ctx.db.get(session.paymentId) : null;
  const job = session.jobId ? await ctx.db.get(session.jobId) : null;
  const tz = company.timezone;
  return {
    status: session.status,
    test: session.test,
    stepReached: session.step as StepId,
    steps,
    request,
    requestWords: reason ? REQUEST_WORDS[reason] ?? null : null,
    outOfArea,
    eligible: L.eligible,
    company: {
      name: L.settings.profile.displayName || company.name,
      phone: L.settings.profile.phone ?? null,
      email: L.settings.profile.email ?? null,
      website: L.settings.profile.website ?? null,
      logoUrl,
      brandColor: L.settings.profile.brandColor,
      accentColor: L.settings.profile.accentColor,
      timezone: tz,
      texting: await textConsentFor(ctx, company._id, L.settings.handle),
    },
    definition: L.def,
    heroUrl,
    contact: session.contact ? { firstName: session.contact.firstName, lastName: session.contact.lastName, email: session.contact.email, phone: session.contact.phone, textOk: session.contact.textOk, textVersion: session.contact.textVersion ?? null } : null,
    postalCode: session.postalCode ?? null,
    size: L.plan,
    home: session.home,
    offers: await offersFor(ctx, session, L),
    selection: session.selection ?? null,
    quote: quote
      ? {
          serviceKey: quote.serviceKey,
          outcome: quote.outcome,
          lines: quote.lines,
          totalCents: quote.totalCents,
          taxCents: quote.taxCents,
          taxLabel: quote.taxLabel ?? null,
          grandTotalCents: quote.grandTotalCents,
          dueNowCents: quote.dueNowCents,
          balanceCents: quote.balanceCents,
          policyWords: policyWords(quote.policy),
          balanceTerms: quote.policy?.balanceTerms ?? "",
          per: quote.per,
          inputHash: quote.inputHash,
          scheduleLabel: quote.schedule ? scheduleLabel(quote.schedule as never) : null,
          elapsedMinutes: quote.elapsedMinutes,
          crew: quote.crew,
          windowMinutes: quote.windowMinutes,
        }
      : null,
    accepted: session.accepted ?? null,
    scheduling: { mode: L.settings.scheduling.mode, horizonDays: L.settings.scheduling.horizonDays },
    schedule: session.schedule
      ? {
          date: session.schedule.date,
          startsAt: session.schedule.startsAt,
          windowMinutes: session.schedule.windowMinutes,
          preferredOnly: session.schedule.preferredOnly,
          label: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(session.schedule.startsAt)),
          windowLabel: session.schedule.preferredOnly
            ? "Preferred time — the team confirms it"
            : session.schedule.windowMinutes > 0
              ? `Arrives ${fmtClock(session.schedule.startsAt, tz)}–${fmtClock(session.schedule.startsAt + session.schedule.windowMinutes * MINUTE, tz)}`
              : `Starts at ${fmtClock(session.schedule.startsAt, tz)}`,
        }
      : null,
    holdExpiresAt: session.schedule?.holdId ? ((await ctx.db.get(session.schedule.holdId))?.expiresAt ?? null) : null,
    address: session.address ?? null,
    answers: session.answers,
    accessSaved: Boolean(session.accessNotes),
    questions: visibleQuestions(L.def.behavior.questions, { answers: session.answers, serviceKey: session.selection?.serviceKey ?? null, mode: L.def.behavior.mode }),
    agreement: L.agreementRule && !request
      ? {
          required: true,
          title: prepared?.ok ? prepared.title : L.agreementRule.label,
          markdown: prepared?.ok ? prepared.markdown : null,
          hash: prepared?.ok ? prepared.hash : null,
          unavailable: prepared && !prepared.ok ? "The agreement can't be shown yet. Choose a service and time first." : null,
          accepted: session.agreementState === "accepted",
          signerName: acceptance?.signerName ?? null,
        }
      : null,
    payment: {
      required: pays,
      state: session.paymentState,
      canPayByCard: L.canPayByCard,
      testMode: L.stripeTestMode,
      paymentId: session.paymentId ?? null,
      problem: payment?.problem ?? null,
    },
    states: {
      answers: session.answersState,
      quote: session.quoteState,
      agreement: session.agreementState,
      payment: session.paymentState,
      capacity: session.capacityState,
      confirmation: session.confirmationState,
    },
    blockers: session.blockers,
    detailsTiming: L.def.behavior.detailsTiming,
    confirmation: {
      confirmedAt: session.confirmedAt ?? null,
      requestedAt: session.requestedAt ?? null,
      reference: sha256(`booking-reference:${session._id}`).slice(0, 8).toUpperCase(),
      // Whether a cleaner has accepted is Dispatch's and is never claimed here.
      visitScheduled: Boolean(job && job.status === "scheduled"),
    },
    versionNotice: session.versionNotice ?? null,
  };
}

function fmtClock(at: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(at));
}
