/**
 * A customer working on their own booking, through the private link (convex/lib/booking/tokens.ts).
 * Every function here is a `bookingQuery` or `bookingMutation`: the token is the only authorization, no
 * id in the arguments is trusted, and nothing reaches another session or another company.
 *
 * Each change is checked against the published services and the company's rules, then every state is
 * worked out again (`recalc`). Prices always come from the engine; times always from capacity; paid
 * only from Stripe through Finance.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { localParts } from "./lib/availability";
import { bookingMutation, bookingQuery } from "./lib/builders";
import { acquireHold, candidateStarts, dayStartOf, loadSupply, occupied, releaseHolds, slotOf, spareCrew, hasSupply } from "./lib/booking/capacity";
import { checkAnswer, plain } from "./lib/booking/definition";
import { cancelStartedPayments } from "./finance";
import { funnel } from "./lib/booking/funnel";
import { commitBooking, submitRequest } from "./lib/booking/handoff";
import { BATHROOM_CHOICES } from "./lib/booking/logic";
import { startBookingPayment } from "./lib/booking/payments";
import { inArea, load, recalc, requestReason, REQUEST_WORDS, view as sessionView, type Loaded } from "./lib/booking/session";
import { newToken, tokenHash } from "./lib/booking/tokens";
import { userError } from "./lib/errors";
import { recordEvent } from "./lib/events";
import { stripeConfig } from "./lib/finance/stripe";
import { liveTaskByKey, openTask } from "./lib/taskState";
import { normalizePostalCode } from "./lib/settings/business";
import { settingsRow } from "./lib/booking/settings";
import { textConsentFor } from "./lib/texting/pages";
import { email as checkedEmail } from "./lib/text";
import { addLocalDays, startOfLocalDay } from "./lib/time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

export const view = bookingQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.booking) return { ended: true as const, company: null };
    const { session, company, open } = ctx.booking;
    if (!open) return { ended: true as const, company: company.name };
    return { ended: false as const, ...(await sessionView(ctx, session, company)) };
  },
});

function need(L: Loaded, session: Doc<"bookingSessions">) {
  const quote = session.quote;
  const row = quote ? L.offered.find((r) => r.service.key === quote.serviceKey) : null;
  if (!quote || !row) return null;
  return { crew: quote.crew, skills: row.spec.team.skills, postalCode: session.postalCode ?? "", elapsedMinutes: quote.elapsedMinutes, windowMinutes: quote.windowMinutes };
}

function window(L: Loaded) {
  const s = L.settings.scheduling;
  const now = Date.now();
  return { earliest: now + s.noticeHours * HOUR, until: addLocalDays(startOfLocalDay(now, L.company.timezone), s.horizonDays + 1, L.company.timezone) };
}

/** Days customers can book in the horizon, each with whether any time is open. */
export const days = bookingQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.booking?.open) return null;
    const { session, company } = ctx.booking;
    const L = await load(ctx, session, company);
    const n = need(L, session);
    const { earliest, until } = window(L);
    const tz = company.timezone;
    const supply = n && L.settings.scheduling.mode === "capacity" ? await loadSupply(ctx, company, earliest, until) : null;
    const capacity = Boolean(supply && hasSupply(supply)) && requestReason(session, L, session.quote ?? null) === null;
    const out: { date: string; available: boolean }[] = [];
    for (let day = startOfLocalDay(earliest, tz); day < until; day = addLocalDays(day, 1, tz)) {
      const date = localParts(day + 12 * HOUR, tz).day;
      const starts = candidateStarts({ date, hours: L.business.hours, slotMinutes: L.settings.scheduling.slotMinutes, earliest, need: { elapsedMinutes: n?.elapsedMinutes ?? 60 }, timezone: tz });
      const available = starts.length > 0 && (!capacity || !n || starts.some((at) => spareCrew(supply!, occupied(at, n), n, session.schedule?.holdId) >= n.crew));
      out.push({ date, available });
    }
    return { capacity, days: out };
  },
});

/** The start times for one date, with which are open right now. */
export const slots = bookingQuery({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    if (!ctx.booking?.open) return null;
    const { session, company } = ctx.booking;
    const L = await load(ctx, session, company);
    const n = need(L, session);
    if (!n || dayStartOf(args.date, company.timezone) === null) return [];
    const { earliest, until } = window(L);
    const tz = company.timezone;
    const starts = candidateStarts({ date: args.date, hours: L.business.hours, slotMinutes: L.settings.scheduling.slotMinutes, earliest, need: n, timezone: tz }).filter((at) => at < until);
    const capacity = L.settings.scheduling.mode === "capacity" && requestReason(session, L, session.quote ?? null) === null;
    const supply = capacity ? await loadSupply(ctx, company, starts[0] ?? earliest, (starts[starts.length - 1] ?? earliest) + 24 * HOUR) : null;
    const counting = Boolean(supply && hasSupply(supply));
    return starts.map((at) => slotOf(at, n.windowMinutes, tz, !counting || spareCrew(supply!, occupied(at, n), n, session.schedule?.holdId) >= n.crew)).map((slot) => ({ ...slot, preferredOnly: !counting }));
  },
});

/** One payment this session started, as the card form needs it. */
export const paymentAttempt = bookingQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    if (!ctx.booking?.open) return null;
    const { session } = ctx.booking;
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || !session.invoiceId || payment.invoiceId !== session.invoiceId || !payment.stripe) return null;
    const config = stripeConfig();
    const ready = payment.status === "awaiting_customer" && Boolean(payment.stripe.paymentIntentId && payment.stripe.clientSecret);
    return {
      status: payment.status,
      preparing: payment.status === "awaiting_customer" && !payment.stripe.paymentIntentId,
      amountCents: payment.amountCents,
      problem: payment.problem ?? null,
      clientSecret: ready ? payment.stripe.clientSecret! : null,
      publishableKey: ready ? (config?.publishableKey ?? null) : null,
      accountId: ready ? payment.stripe.accountId : null,
    };
  },
});

// ── Changing ─────────────────────────────────────────────────────────────────────────────────────

async function reached(ctx: MutationCtx, session: Doc<"bookingSessions">, step: Doc<"bookingSessions">["step"], completed: Doc<"bookingSessions">["step"]) {
  const order = ["location", "size", "service", "details", "checkout", "confirmation"];
  if (order.indexOf(step) > order.indexOf(session.step)) await ctx.db.patch(session._id, { step });
  await ctx.db.patch(session._id, { lastSeenAt: Date.now() });
  await funnel(ctx, session, "step_completed", { step: completed });
}

/**
 * What the customer pays for can't change once money is moving: a payment that is processing or received
 * is for exactly this booking, and changes go through the company. A card form that was opened but not
 * finished is cancelled, so it can't be completed for the old choice.
 */
async function beforeChanging(ctx: MutationCtx & { session: Doc<"bookingSessions">; company: Doc<"companies"> }) {
  const state = ctx.session.paymentState;
  if (state === "processing" || state === "succeeded") {
    const L = await load(ctx, ctx.session, ctx.company);
    throw userError(`Your payment for this booking has been received, so it can't be changed here. Please contact ${L.settings.profile.displayName || ctx.company.name} to change it.`);
  }
  if (state === "started" && ctx.session.invoiceId) {
    await cancelStartedPayments(ctx, ctx.session.invoiceId);
    await ctx.db.patch(ctx.session._id, { paymentId: undefined, paymentState: "pending" });
  }
}

export const setLocation = bookingMutation({
  args: { postalCode: v.string() },
  handler: async (ctx, args) => {
    await beforeChanging(ctx);
    const postal = normalizePostalCode(args.postalCode);
    if (!/^[A-Z0-9][A-Z0-9 -]{1,9}[A-Z0-9]$/.test(postal)) throw userError("Enter a valid ZIP code.");
    const L = await load(ctx, ctx.session, ctx.company);
    const changed = postal !== ctx.session.postalCode;
    await ctx.db.patch(ctx.session._id, { postalCode: postal, inArea: inArea(L.business, postal) });
    // A new area can change the price and who can come, so the reserved time goes.
    if (changed && ctx.session.schedule) {
      await releaseHolds(ctx, ctx.companyId, ctx.session._id);
      await ctx.db.patch(ctx.session._id, { schedule: undefined });
    }
    await recalc(ctx, ctx.session._id);
    return { inArea: inArea(L.business, postal) };
  },
});

export const setContact = bookingMutation({
  args: { firstName: v.string(), lastName: v.string(), email: v.string(), phone: v.string(), textOk: v.boolean(), textVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const digits = args.phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) throw userError("Enter a phone number we can reach you on.");
    // A yes to texts counts only against the wording on screen, and only while it is still the published version.
    let textVersion: number | undefined;
    if (args.textOk) {
      const wording = await textConsentFor(ctx, ctx.session.companyId, (await settingsRow(ctx, ctx.session.companyId))?.handle);
      if (!wording || wording.version !== args.textVersion) throw userError("The text message wording just changed. Reload the page to see it, then try again.");
      textVersion = wording.version;
    }
    const contact = {
      firstName: plain(args.firstName, "First name", 60, false),
      lastName: plain(args.lastName, "Last name", 60, false),
      email: checkedEmail(args.email),
      phone: digits.length === 10 ? `+1${digits}` : `+${digits}`,
      textOk: args.textOk,
      ...(textVersion !== undefined ? { textVersion } : {}),
    };
    await ctx.db.patch(ctx.session._id, { contact });
    await reached(ctx, ctx.session, "size", "location");
    await recalc(ctx, ctx.session._id);
    return { ok: true };
  },
});

const number = (value: number | undefined, label: string, max: number, step = 1): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > max || Math.round(value / step) * step !== value) throw userError(`${label} doesn't look right.`);
  return value;
};

export const setHome = bookingMutation({
  args: { sizeKey: v.optional(v.string()), area: v.optional(v.number()), bedrooms: v.optional(v.number()), bathrooms: v.optional(v.number()), halfBaths: v.optional(v.number()), beds: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await beforeChanging(ctx);
    const L = await load(ctx, ctx.session, ctx.company);
    const home = { ...ctx.session.home };
    if (args.sizeKey !== undefined) {
      const card = L.plan.area?.kind === "cards" ? [...L.plan.area.cards].find((c) => c.key === args.sizeKey) : null;
      const custom = L.plan.area?.kind === "cards" && L.plan.area.customQuoteFrom !== null && args.sizeKey === `area-${L.plan.area.customQuoteFrom}-custom`;
      if (!card && !custom) throw userError("Choose one of the sizes shown.");
      home.sizeKey = args.sizeKey;
      home.area = card ? card.facts.area : (L.plan.area as { customQuoteFrom: number }).customQuoteFrom;
    }
    if (args.area !== undefined) {
      home.area = number(args.area, "The size", 1_000_000);
      delete home.sizeKey;
    }
    if (args.bedrooms !== undefined) home.bedrooms = number(args.bedrooms, "Bedrooms", 20);
    if (args.bathrooms !== undefined) {
      const total = args.bathrooms + (args.halfBaths ?? 0) * 0.5;
      if (!BATHROOM_CHOICES.includes(total as never) && !(Number.isInteger(args.bathrooms) && args.bathrooms <= 10)) throw userError("Bathrooms doesn't look right.");
      home.bathrooms = number(args.bathrooms, "Bathrooms", 10);
      home.halfBaths = number(args.halfBaths ?? 0, "Half baths", 5);
    }
    if (args.beds !== undefined) home.beds = number(args.beds, "Beds", 40);
    await ctx.db.patch(ctx.session._id, { home });
    const after = await recalc(ctx, ctx.session._id);
    await reached(ctx, after, "service", "size");
    return { request: requestReason(after, L, after.quote ?? null) };
  },
});

export const selectService = bookingMutation({
  args: {
    serviceKey: v.string(),
    condition: v.optional(v.string()),
    schedule: v.optional(v.string()),
    units: v.optional(v.number()),
    addOns: v.array(v.object({ id: v.string(), quantity: v.number() })),
    answers: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
  },
  handler: async (ctx, args) => {
    await beforeChanging(ctx);
    const L = await load(ctx, ctx.session, ctx.company);
    const row = L.offered.find((r) => r.service.key === args.serviceKey);
    if (!row) throw userError("That service isn't offered here.");
    const spec = row.spec;
    if (args.condition !== undefined && !spec.modifiers.condition.levels.some((l) => l.id === args.condition)) throw userError("Choose one of the conditions shown.");
    if (args.schedule !== undefined && !spec.modifiers.recurring.options.some((o) => o.schedule === args.schedule)) throw userError("Choose one of the schedules shown.");
    for (const a of args.addOns) {
      const addOn = spec.addOns.find((x) => x.id === a.id);
      if (!addOn) throw userError("Choose from the extras shown.");
      if (!Number.isInteger(a.quantity) || a.quantity < 0 || a.quantity > addOn.maxQuantity) throw userError(`Choose up to ${addOn.maxQuantity} of "${addOn.label}".`);
    }
    if (args.units !== undefined && (!Number.isInteger(args.units) || args.units < 1 || args.units > 100)) throw userError("Choose how many.");
    // Answers to the service's own questions, kept by question id so another service asking the same reuses them.
    const answers = { ...(ctx.session.selection?.answers ?? {}) };
    for (const [id, value] of Object.entries(args.answers)) {
      const q = spec.questions.find((x) => x.id === id);
      if (!q) continue;
      if (q.kind === "number" && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000)) throw userError(`"${q.label}" needs a number.`);
      if (q.kind === "choice" && (typeof value !== "string" || !q.options.includes(value))) throw userError(`Choose an answer for "${q.label}".`);
      if (q.kind === "yes_no" && typeof value !== "boolean") throw userError(`Answer "${q.label}" with yes or no.`);
      answers[id] = typeof value === "string" ? plain(value, q.label, 500) : value;
    }
    const before = ctx.session.quote;
    await ctx.db.patch(ctx.session._id, {
      selection: { serviceKey: args.serviceKey, ...(args.condition ? { condition: args.condition } : {}), ...(args.schedule ? { schedule: args.schedule } : {}), ...(args.units !== undefined ? { units: args.units } : {}), addOns: args.addOns.filter((a) => a.quantity > 0), answers },
    });
    let after = await recalc(ctx, ctx.session._id);
    // A different crew or length needs a different time: let the held one go rather than keep a wrong reservation.
    if (ctx.session.schedule && after.quote && before && (after.quote.crew !== before.crew || after.quote.elapsedMinutes !== before.elapsedMinutes || after.quote.serviceKey !== before.serviceKey)) {
      await releaseHolds(ctx, ctx.companyId, ctx.session._id);
      await ctx.db.patch(ctx.session._id, { schedule: undefined, versionNotice: "Your choice changes how long the visit takes, so please pick a time again." });
      after = await recalc(ctx, ctx.session._id);
    }
    if (after.quote) await funnel(ctx, after, "quote_calculated", { amountCents: after.quote.grandTotalCents ?? undefined });
    return { outcome: after.quote?.outcome ?? null, grandTotalCents: after.quote?.grandTotalCents ?? null };
  },
});

/** Holds an available time for this session. Checked again here; a time taken a moment ago is refused. */
export const chooseTime = bookingMutation({
  args: { startsAt: v.number() },
  handler: async (ctx, args) => {
    await beforeChanging(ctx);
    const L = await load(ctx, ctx.session, ctx.company);
    const n = need(L, ctx.session);
    if (!n) throw userError("Choose a service first.");
    const tz = ctx.company.timezone;
    const { earliest, until } = window(L);
    const date = localParts(args.startsAt, tz).day;
    const starts = candidateStarts({ date, hours: L.business.hours, slotMinutes: L.settings.scheduling.slotMinutes, earliest, need: n, timezone: tz });
    if (!starts.includes(args.startsAt) || args.startsAt >= until) throw userError("That time can't be booked. Please choose another.");
    const supply = L.settings.scheduling.mode === "capacity" ? await loadSupply(ctx, ctx.company, args.startsAt - HOUR, args.startsAt + 24 * HOUR) : null;
    const counting = Boolean(supply && hasSupply(supply)) && requestReason(ctx.session, L, ctx.session.quote ?? null) === null;
    if (!counting) {
      await releaseHolds(ctx, ctx.companyId, ctx.session._id);
      await ctx.db.patch(ctx.session._id, { schedule: { date, startsAt: args.startsAt, windowMinutes: n.windowMinutes, preferredOnly: true }, versionNotice: undefined });
    } else {
      const held = await acquireHold(ctx, { company: ctx.company, sessionId: ctx.session._id, startsAt: args.startsAt, need: n, holdMinutes: L.settings.scheduling.holdMinutes, hours: L.business.hours });
      if (!held.ok) return { ok: false, why: held.why };
      await ctx.db.patch(ctx.session._id, { schedule: { date, startsAt: args.startsAt, windowMinutes: n.windowMinutes, preferredOnly: false, holdId: held.holdId }, versionNotice: undefined });
      const hold = (await ctx.db.get(held.holdId))!;
      await ctx.scheduler.runAt(hold.expiresAt, internal.bookingOps.expireHold, { holdId: held.holdId });
    }
    const after = await recalc(ctx, ctx.session._id);
    await funnel(ctx, after, "schedule_selected");
    return { ok: true, preferredOnly: !counting };
  },
});

/** The customer accepts the price shown. A price that moved since it was drawn is refused with the new one. */
export const acceptQuote = bookingMutation({
  args: { inputHash: v.string(), grandTotalCents: v.number() },
  handler: async (ctx, args) => {
    await beforeChanging(ctx);
    const session = await recalc(ctx, ctx.session._id);
    const quote = session.quote;
    if (!quote || quote.grandTotalCents === null) throw userError("There's no price to accept yet.");
    if (quote.inputHash !== args.inputHash || quote.grandTotalCents !== args.grandTotalCents) return { ok: false, grandTotalCents: quote.grandTotalCents, why: `The price is now $${(quote.grandTotalCents / 100).toFixed(2)}. Please review it.` };
    await ctx.db.patch(session._id, { accepted: { inputHash: quote.inputHash, grandTotalCents: quote.grandTotalCents, dueNowCents: quote.dueNowCents, version: quote.version, acceptedAt: Date.now() } });
    const after = await recalc(ctx, session._id);
    await reached(ctx, after, "details", "service");
    return { ok: true };
  },
});

export const setDetails = bookingMutation({
  args: {
    address: v.object({ line1: v.string(), line2: v.optional(v.string()), city: v.string(), region: v.string(), postalCode: v.string() }),
    answers: v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.array(v.string()))),
  },
  handler: async (ctx, args) => {
    const L = await load(ctx, ctx.session, ctx.company);
    const postal = normalizePostalCode(args.address.postalCode);
    if (ctx.session.postalCode && postal !== ctx.session.postalCode) throw userError(`The address must be in ${ctx.session.postalCode}, the ZIP code you started with. Go back to change it.`);
    const address = {
      line1: plain(args.address.line1, "Street address", 120, false),
      ...(args.address.line2?.trim() ? { line2: plain(args.address.line2, "Apartment or unit", 60) } : {}),
      city: plain(args.address.city, "City", 60, false),
      region: plain(args.address.region, "State", 40, false),
      postalCode: postal,
    };
    const answers: Doc<"bookingSessions">["answers"] = {};
    const access: string[] = [];
    const accessAnswered: string[] = [];
    for (const q of L.def.behavior.questions) {
      const raw = args.answers[q.id];
      const value = checkAnswer(q, raw);
      if (value === null) continue;
      if (q.purpose === "access") {
        access.push(`${q.label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
        accessAnswered.push(q.id);
      } else answers[q.id] = value;
    }
    await ctx.db.patch(ctx.session._id, { address, answers, accessNotes: access.length ? access.join("\n").slice(0, 3000) : undefined, accessAnswered });
    const after = await recalc(ctx, ctx.session._id);
    if (after.answersState === "complete") await reached(ctx, after, "checkout", "details");
    // Paid before the details were given: finishing the details finishes the booking.
    if (after.answersState === "complete" && after.paymentState === "succeeded" && !after.test) await commitBooking(ctx, after._id);
    return { complete: after.answersState === "complete" };
  },
});

/** Sends a request (estimate, walkthrough, recurring set-up, a size past online pricing, or out of area). */
export const sendRequest = bookingMutation({
  args: {},
  handler: async (ctx) => {
    const L = await load(ctx, ctx.session, ctx.company);
    const session = await recalc(ctx, ctx.session._id);
    const reason = session.inArea === false ? "out_of_area" : requestReason(session, L, session.quote ?? null);
    if (!reason) throw userError("This booking can be confirmed directly.");
    if (!session.contact) throw userError("Add your name and contact details first.");
    if (reason !== "out_of_area" && session.answersState !== "complete") throw userError("Please finish the details first.");
    if (session.test) {
      await ctx.db.patch(session._id, { status: "requested", confirmationState: "requested", requestedAt: Date.now() });
      await funnel(ctx, session, "request_sent");
      return { ok: true, test: true };
    }
    await submitRequest(ctx, session._id, reason === "out_of_area" ? `Outside the service area (${session.postalCode}).` : (REQUEST_WORDS[reason] ?? "Asked for a quote."));
    return { ok: true, test: false };
  },
});

/** Confirms a booking that needs no payment now. Every requirement is checked again on the server. */
export const confirm = bookingMutation({
  args: {},
  handler: async (ctx) => {
    const session = await recalc(ctx, ctx.session._id);
    if (session.paymentState === "pending" || session.paymentState === "started" || session.paymentState === "failed") throw userError("This booking needs its payment first.");
    if (session.test) {
      if (session.blockers.length) return { ok: false, blockers: session.blockers };
      await ctx.db.patch(session._id, { status: "confirmed", confirmationState: "confirmed", confirmedAt: Date.now() });
      await funnel(ctx, session, "booking_confirmed", { amountCents: session.quote?.grandTotalCents ?? undefined });
      return { ok: true, blockers: [] as string[] };
    }
    const outcome = await commitBooking(ctx, session._id);
    const after = (await ctx.db.get(session._id))!;
    return { ok: outcome === "committed" || outcome === "already", blockers: after.blockers };
  },
});

export const startPayment = bookingMutation({
  args: { clientKey: v.string() },
  handler: async (ctx, args) => {
    const session = await recalc(ctx, ctx.session._id);
    return startBookingPayment(ctx, session, args.clientKey);
  },
});

/** Back from the card form: ask Stripe now instead of waiting for its notice. Proves nothing by itself. */
export const paymentReturned = bookingMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.invoiceId !== ctx.session.invoiceId || payment.source !== "stripe") return { ok: false };
    await ctx.scheduler.runAfter(0, internal.financeStripe.syncPayment, { paymentId: payment._id });
    return { ok: true };
  },
});

/** A test booking pretends its payment went through, so the rest of the flow can be tried. Never on a live session. */
export const simulatePayment = bookingMutation({
  args: {},
  handler: async (ctx) => {
    if (!ctx.session.test) throw userError("Only a test booking can skip payment.");
    const session = await recalc(ctx, ctx.session._id);
    if (!session.quote || session.quote.dueNowCents <= 0) throw userError("Nothing needs to be paid.");
    await ctx.db.patch(session._id, { paymentState: "simulated" });
    const after = await recalc(ctx, session._id);
    await funnel(ctx, after, "payment_verified", { amountCents: session.quote.dueNowCents });
    if (!after.blockers.length) {
      await ctx.db.patch(session._id, { status: "confirmed", confirmationState: "confirmed", confirmedAt: Date.now() });
      await funnel(ctx, after, "booking_confirmed", { amountCents: session.quote.grandTotalCents ?? undefined });
    }
    return { ok: true, blockers: after.blockers };
  },
});

// ── After it's sent: managing it ──────────────────────────────────────────────────────────────────

/** Replaces the private link: the old one, and any emailed one, stop working. Answers with the new token once. */
export const rotateLink = bookingMutation({
  args: {},
  afterConfirmation: true,
  handler: async (ctx) => {
    const token = newToken();
    await ctx.db.patch(ctx.session._id, { tokenHash: tokenHash(token), linkTokenHash: undefined, tokenIssuedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "booking.link_rotated", actor: { kind: "system" }, subject: { table: "bookingSessions", id: ctx.session._id } });
    return { token };
  },
});

/** The customer updates how the team gets in. It goes to the visit's instructions, for the crew. */
export const updateAccess = bookingMutation({
  args: { notes: v.string() },
  afterConfirmation: true,
  handler: async (ctx, args) => {
    if (ctx.session.status !== "confirmed" && ctx.session.status !== "active") throw userError("This booking can't be changed here. Please contact the company.");
    const notes = plain(args.notes, "Access notes", 1000);
    await ctx.db.patch(ctx.session._id, { accessNotes: notes || undefined });
    if (ctx.session.jobId) {
      const job = await ctx.db.get(ctx.session.jobId);
      if (job && job.status === "scheduled") {
        const base = (job.instructions ?? "").split("\nAccess (updated by the customer):")[0];
        await ctx.db.patch(job._id, { instructions: `${base}${notes ? `\nAccess (updated by the customer): ${notes}` : ""}`.slice(0, 4000) });
        await recordEvent(ctx, { companyId: ctx.companyId, type: "booking.access_updated", actor: { kind: "system" }, subject: { table: "bookingSessions", id: ctx.session._id }, data: { jobId: job._id } });
      }
    }
    return { ok: true };
  },
});

/** The customer asks to change or cancel. A person handles it: nothing is moved or refunded here. */
export const requestChange = bookingMutation({
  args: { kind: v.union(v.literal("reschedule"), v.literal("cancel"), v.literal("other")), message: v.string() },
  afterConfirmation: true,
  handler: async (ctx, args) => {
    if (ctx.session.test) return { ok: true };
    const message = plain(args.message, "Your message", 1000);
    const key = `booking-change:${ctx.session._id}`;
    if (!(await liveTaskByKey(ctx, ctx.companyId, key))) {
      await openTask(ctx, {
        companyId: ctx.companyId,
        agent: "sales",
        title: `Customer asked to ${args.kind === "cancel" ? "cancel" : args.kind === "reschedule" ? "reschedule" : "change"} a booking`,
        nextAction: (message || "No message.").slice(0, 500),
        dueAt: Date.now() + 4 * HOUR,
        completionCondition: "The customer has an answer and the visit reflects it.",
        about: { table: "bookingSessions", id: ctx.session._id },
        key,
        actor: { kind: "system" },
      });
    }
    return { ok: true };
  },
});
