/**
 * Turning a finished booking into the company's records, once: the customer and property (matched, not
 * duplicated), the visit (through the same steps `jobs.create` takes, so Dispatch picks it up in the
 * same transaction), the invoice link, and the confirmation message (queued with a dedupe key, so a
 * retry never sends two). Everything happens server-side: closing the browser changes nothing.
 *
 * A request (estimate, walkthrough, recurring set-up, a size past online pricing) never makes a visit:
 * it opens a Sales task for a person, with the customer and what they asked for.
 *
 * When a paid booking can't be committed (the time was taken after the hold ended), the booking is
 * marked as needing attention and a task is opened. Nobody is told it is confirmed, and no other time is
 * picked for the customer.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { applyTemplate } from "../dispatch/templates";
import { coverJob } from "../dispatch/workflow";
import { recordEvent, type Actor } from "../events";
import { quote as runQuote, type QuoteInput } from "../services/engine";
import { saveQuote, visitScope } from "../services/operations";
import { normalizePostalCode } from "../settings/business";
import { liveTaskByKey, openTask } from "../taskState";
import { acquireHold, holdLive } from "./capacity";
import { funnel } from "./funnel";
import { queueBookingMessage } from "./messages";
import { addressLine, customerName, load, recalc, type Loaded } from "./session";
import { MANAGE_LIFE_AFTER_VISIT } from "./tokens";

const SYSTEM: Actor = { kind: "system" };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const KIND: Record<Doc<"bookingExperiences">["kind"], Doc<"customers">["kind"]> = {
  residential: "home",
  recurring: "home",
  campaign: "home",
  commercial: "commercial",
  short_term_rental: "short_term_rental",
};

/** The customer this booking is for: the company's own record with the same email, or a new one. */
export async function ensureCustomer(ctx: MutationCtx, session: Doc<"bookingSessions">, kind: Doc<"customers">["kind"]): Promise<Id<"customers">> {
  if (session.customerId) return session.customerId;
  const contact = session.contact!;
  const email = contact.email.trim().toLowerCase();
  const matches = await ctx.db
    .query("customers")
    .withIndex("by_company_email", (q) => q.eq("companyId", session.companyId).eq("email", email))
    .take(5);
  const found = matches.find((c) => c.status === "active");
  if (found) {
    if (!found.phone && contact.phone) await ctx.db.patch(found._id, { phone: contact.phone });
    await ctx.db.patch(session._id, { customerId: found._id });
    return found._id;
  }
  const customerId = await ctx.db.insert("customers", { companyId: session.companyId, name: customerName(session).slice(0, 120), kind, email, phone: contact.phone, status: "active", createdAt: Date.now() });
  await recordEvent(ctx, { companyId: session.companyId, type: "customer.created", actor: SYSTEM, subject: { table: "customers", id: customerId }, data: { source: "booking" } });
  await ctx.db.patch(session._id, { customerId });
  return customerId;
}

const sameLine = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

/** The property at this address for this customer, or a new one. Access notes go on the property only when it is new. */
export async function ensureProperty(ctx: MutationCtx, session: Doc<"bookingSessions">, customerId: Id<"customers">, kind: Doc<"customers">["kind"]): Promise<Id<"properties"> | null> {
  if (session.propertyId) return session.propertyId;
  const address = session.address;
  if (!address) return null;
  const owned = await ctx.db
    .query("properties")
    .withIndex("by_company_customer", (q) => q.eq("companyId", session.companyId).eq("customerId", customerId))
    .take(50);
  const postal = normalizePostalCode(address.postalCode);
  const found = owned.find((p) => p.status === "active" && normalizePostalCode(p.address.postalCode) === postal && sameLine(p.address.line1, address.line1));
  const propertyId =
    found?._id ??
    (await ctx.db.insert("properties", {
      companyId: session.companyId,
      customerId,
      address: { line1: address.line1, ...(address.line2 ? { line2: address.line2 } : {}), city: address.city, region: address.region, postalCode: postal },
      kind,
      ...(session.accessNotes ? { accessInstructions: session.accessNotes.slice(0, 2000) } : {}),
      status: "active",
      createdAt: Date.now(),
    }));
  if (!found) await recordEvent(ctx, { companyId: session.companyId, type: "property.created", actor: SYSTEM, subject: { table: "properties", id: propertyId }, data: { source: "booking" } });
  await ctx.db.patch(session._id, { propertyId });
  return propertyId;
}

/** What the crew reads on the visit: the customer's own answers and access notes. */
function instructions(session: Doc<"bookingSessions">, L: Loaded): string {
  const lines: string[] = ["Booked online."];
  for (const q of L.def.behavior.questions) {
    const answer = session.answers[q.id];
    if (answer === undefined || q.purpose === "access") continue;
    lines.push(`${q.label}: ${Array.isArray(answer) ? answer.join(", ") : String(answer)}`);
  }
  if (session.accessNotes) lines.push(session.accessNotes);
  return lines.join("\n").slice(0, 4000);
}

/**
 * Commits a booking whose every requirement is met. Idempotent: a session that already has a visit is
 * left alone, so a retried finalize, a late webhook and a double click make one visit.
 */
export async function commitBooking(ctx: MutationCtx, sessionId: Id<"bookingSessions">): Promise<"committed" | "already" | "blocked" | "needs_attention"> {
  let session = await recalc(ctx, sessionId);
  if (session.jobId || session.status === "confirmed") return "already";
  if (session.status !== "active" || session.test) return "blocked";
  const company = (await ctx.db.get(session.companyId))!;
  const L = await load(ctx, session, company);
  const quote = session.quote!;
  const paid = session.paymentState === "succeeded";

  // The time: still held, or taken again now if it is still free. Never a different time.
  const hold = session.schedule?.holdId ? await ctx.db.get(session.schedule.holdId) : null;
  if (session.schedule && !session.schedule.preferredOnly && !holdLive(hold)) {
    const again = await acquireHold(ctx, {
      company,
      sessionId,
      startsAt: session.schedule.startsAt,
      need: { crew: quote.crew, skills: L.offered.find((r) => r.service.key === quote.serviceKey)?.spec.team.skills ?? [], postalCode: session.postalCode!, elapsedMinutes: quote.elapsedMinutes, windowMinutes: quote.windowMinutes },
      holdMinutes: 10,
      hours: [],
    });
    if (again.ok) {
      await ctx.db.patch(sessionId, { schedule: { ...session.schedule, holdId: again.holdId } });
      session = await recalc(ctx, sessionId);
    } else if (paid) {
      await needsAttention(ctx, session, L, "The payment was received, but the chosen time was taken after the hold ended. Call the customer to agree a new time, or refund them.");
      return "needs_attention";
    }
  }
  // Taking details after payment is supported, but a visit is never made without them: the booking
  // waits as "payment received, details incomplete" and is finished when the customer adds them.
  if (session.answersState !== "complete") return "blocked";
  if (session.blockers.length) {
    if (paid) {
      await needsAttention(ctx, session, L, `The payment was received, but the booking can't be confirmed yet: ${session.blockers.join(" ")}`);
      return "needs_attention";
    }
    return "blocked";
  }

  const row = L.offered.find((r) => r.service.key === quote.serviceKey)!;
  const kind = KIND[L.experience.kind];
  const customerId = await ensureCustomer(ctx, session, kind);
  const propertyId = (await ensureProperty(ctx, session, customerId, kind))!;
  session = (await ctx.db.get(sessionId))!;
  const startsAt = session.schedule!.startsAt;
  const endsAt = startsAt + quote.elapsedMinutes * MINUTE;
  const input = JSON.parse(quote.input) as QuoteInput;
  const result = runQuote(row.spec, input);
  const now = Date.now();
  const jobId = await ctx.db.insert("jobs", {
    companyId: session.companyId,
    customerId,
    propertyId,
    serviceType: row.spec.name.slice(0, 80),
    scope: visitScope(row.spec),
    requiredSkills: row.spec.team.skills,
    serviceSnapshot: {
      serviceId: row.service.key,
      name: row.spec.name,
      scope: visitScope(row.spec),
      durationMinutes: quote.elapsedMinutes,
      defaultCrew: row.spec.team.crewSize,
      skills: row.spec.team.skills,
      capturedAt: now,
      versionId: row.version._id,
      version: row.version.version,
      priceSource: "quote",
    },
    priceCents: quote.totalCents ?? undefined,
    startsAt,
    endsAt,
    status: "scheduled",
    ...(quote.crew > 1 ? { requiredCrew: quote.crew } : {}),
    ...(quote.windowMinutes > 0 ? { arrivalWindowMinutes: quote.windowMinutes } : {}),
    instructions: instructions(session, L),
    createdAt: now,
  });
  const quoteId = await saveQuote(ctx, { companyId: session.companyId, service: row.service, version: row.version, quoteInput: input, result, purpose: "visit", actor: SYSTEM, jobId });
  const job = (await ctx.db.get(jobId))!;
  await ctx.db.patch(jobId, { serviceSnapshot: { ...job.serviceSnapshot!, quoteId } });
  const template = await applyTemplate(ctx, (await ctx.db.get(jobId))!);
  await recordEvent(ctx, { companyId: session.companyId, type: "job.created", actor: SYSTEM, subject: { table: "jobs", id: jobId }, data: { source: "booking", ...(template ? { checklistVersion: template.version } : {}) } });

  const liveHold = session.schedule?.holdId ? await ctx.db.get(session.schedule.holdId) : null;
  if (liveHold) await ctx.db.patch(liveHold._id, { status: "committed", jobId, updatedAt: now });
  if (session.invoiceId) await ctx.db.patch(session.invoiceId, { jobId, propertyId, updatedAt: now });
  await ctx.db.patch(sessionId, {
    status: "confirmed",
    confirmationState: "confirmed",
    capacityState: "committed",
    jobId,
    confirmedAt: now,
    blockers: [],
    expiresAt: Math.max(session.expiresAt, endsAt + MANAGE_LIFE_AFTER_VISIT),
    updatedAt: now,
  });
  await recordEvent(ctx, { companyId: session.companyId, type: "booking.confirmed", actor: SYSTEM, subject: { table: "bookingSessions", id: sessionId }, data: { jobId, amountCents: quote.grandTotalCents ?? 0, paid } });
  await funnel(ctx, (await ctx.db.get(sessionId))!, "booking_confirmed", { amountCents: quote.grandTotalCents ?? undefined });
  if (session.recoveryOfferedAt) await funnel(ctx, (await ctx.db.get(sessionId))!, "recovery_completed");
  // Dispatch looks at the new visit in this same step, as it does for any visit.
  await coverJob(ctx, jobId);
  await queueBookingMessage(ctx, { sessionId, purpose: "booking_confirmation", dedupeKey: `booking:${sessionId}:confirmation` });
  return "committed";
}

/** Sends a request: a Sales task with what the customer asked for. No visit, no payment, no reserved crew. */
export async function submitRequest(ctx: MutationCtx, sessionId: Id<"bookingSessions">, words: string): Promise<void> {
  const session = (await ctx.db.get(sessionId))!;
  if (session.status !== "active" || session.test) return;
  const company = (await ctx.db.get(session.companyId))!;
  const L = await load(ctx, session, company);
  const kind = KIND[L.experience.kind];
  const customerId = session.inArea === false ? null : await ensureCustomer(ctx, session, kind);
  if (customerId) await ensureProperty(ctx, session, customerId, kind);
  const fresh = (await ctx.db.get(sessionId))!;
  const service = fresh.quote ? L.offered.find((r) => r.service.key === fresh.quote!.serviceKey)?.spec.name : undefined;
  const preferred = fresh.schedule ? new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(fresh.schedule.startsAt)) : null;
  const key = `booking-request:${sessionId}`;
  const existing = await liveTaskByKey(ctx, session.companyId, key);
  const taskId =
    existing?._id ??
    (await openTask(ctx, {
      companyId: session.companyId,
      agent: "sales",
      title: `${fresh.inArea === false ? "Out-of-area request" : "Booking request"}: ${customerName(fresh) || "a customer"}${service ? ` · ${service}` : ""}`.slice(0, 200),
      nextAction: [words, addressLine(fresh.address) ? `Address: ${addressLine(fresh.address)}.` : null, preferred ? `Preferred time: ${preferred}.` : null, fresh.quote?.grandTotalCents ? `Online estimate: $${(fresh.quote.grandTotalCents / 100).toFixed(2)}.` : null, "Contact the customer and agree the next step."].filter(Boolean).join(" ").slice(0, 500),
      dueAt: Date.now() + 4 * HOUR,
      completionCondition: "The customer has a quote, a walkthrough time, or a clear answer.",
      about: { table: "bookingSessions", id: sessionId },
      key,
      actor: SYSTEM,
    }));
  const now = Date.now();
  await ctx.db.patch(sessionId, { status: "requested", confirmationState: "requested", requestedAt: now, taskId, blockers: [], updatedAt: now });
  await recordEvent(ctx, { companyId: session.companyId, type: "booking.requested", actor: SYSTEM, subject: { table: "bookingSessions", id: sessionId }, data: { outOfArea: fresh.inArea === false } });
  await funnel(ctx, (await ctx.db.get(sessionId))!, "request_sent");
  if (customerId && L.def.behavior.notifyOfficeOnRequest) await queueBookingMessage(ctx, { sessionId, purpose: "booking_request_received", dedupeKey: `booking:${sessionId}:request` });
}

/** A paid booking that couldn't be committed: visible to the office as a task, honest to the customer. */
export async function needsAttention(ctx: MutationCtx, session: Doc<"bookingSessions">, L: Loaded, why: string): Promise<void> {
  if (session.status === "needs_attention") return;
  const kind = KIND[L.experience.kind];
  const customerId = await ensureCustomer(ctx, session, kind);
  await ensureProperty(ctx, session, customerId, kind);
  const key = `booking-recovery:${session._id}`;
  const existing = await liveTaskByKey(ctx, session.companyId, key);
  const taskId =
    existing?._id ??
    (await openTask(ctx, {
      companyId: session.companyId,
      agent: "sales",
      title: `Paid booking needs a person: ${customerName(session) || "a customer"}`.slice(0, 200),
      nextAction: why.slice(0, 500),
      dueAt: Date.now() + HOUR,
      completionCondition: "The customer has an agreed time and a visit, or has been refunded.",
      about: { table: "bookingSessions", id: session._id },
      key,
      actor: SYSTEM,
    }));
  const now = Date.now();
  await ctx.db.patch(session._id, { status: "needs_attention", confirmationState: "needs_attention", taskId, updatedAt: now });
  await recordEvent(ctx, { companyId: session.companyId, type: "booking.needs_attention", actor: SYSTEM, subject: { table: "bookingSessions", id: session._id }, data: { paid: session.paymentState === "succeeded" } });
  await funnel(ctx, (await ctx.db.get(session._id))!, "needs_attention");
}
