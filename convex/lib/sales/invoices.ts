/**
 * The invoice a booking asks the customer to pay before service: the first visit at its settled price,
 * with a deposit when the booking asks for one. Issued the way Finance issues any invoice (a number, a
 * due date, a pay link), on behalf of the person who authorized it: an Owner or a Manager, or an Owner
 * or Manager approving an Office member's request. Nothing here marks anything paid; only a payment does.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { recordEvent } from "../events";
import { recompute, emptyTotals } from "../finance/ledger";
import { linesTotal } from "../finance/money";
import { newPublicId } from "../finance/payLinks";
import { dueAfterDays, invoiceNumber, settingsOf, settingsRow } from "../finance/settings";

function lineId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueBookingInvoice(ctx: MutationCtx, booking: Doc<"bookings">, by: Id<"members">): Promise<Doc<"invoices">> {
  if (booking.invoiceId) {
    const existing = await ctx.db.get(booking.invoiceId);
    if (existing && existing.status !== "void") return existing;
  }
  const company = (await ctx.db.get(booking.companyId))!;
  const row = await settingsRow(ctx, booking.companyId);
  const settings = settingsOf(row);
  const version = await ctx.db.get(booking.first?.versionId ?? booking.versionId);
  const name = version?.spec.name ?? "Cleaning service";
  const serviceKey = booking.first?.serviceKey ?? booking.serviceKey;
  const priceCents = booking.first?.priceCents ?? booking.priceCents;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, month: "short", day: "numeric", year: "numeric" }).format(new Date(booking.slot.startsAt));
  const lines = [{ id: lineId(), kind: "service" as const, description: `${name} · ${day}${booking.kind === "recurring" ? " (first visit)" : ""}`, quantity: 1, unitCents: priceCents, amountCents: priceCents, taxable: settings.taxableServiceIds.includes(serviceKey), serviceId: serviceKey }];
  const taxRateBps = settings.taxRateBps ?? 0;
  const base = linesTotal(lines, taxRateBps);
  const deposit = booking.requirements.payment.policy === "deposit" && booking.requirements.payment.dueNowCents > 0 && booking.requirements.payment.dueNowCents < base.totalCents ? booking.requirements.payment.dueNowCents : undefined;
  const now = Date.now();
  const number = invoiceNumber(settings);
  if (row) await ctx.db.patch(row._id, { nextInvoiceNumber: settings.nextInvoiceNumber + 1 });
  else await ctx.db.insert("financeSettings", { companyId: booking.companyId, taxableServiceIds: [], paymentTermsDays: settings.paymentTermsDays, allowPartialPayments: settings.allowPartialPayments, nextInvoiceNumber: settings.nextInvoiceNumber + 1, invoicePrefix: settings.invoicePrefix, revision: 0, updatedBy: by, updatedAt: now });
  // Due before the visit when payment is asked for up front; never after the visit starts.
  const dueAt = Math.min(dueAfterDays(now, settings.paymentTermsDays, company.timezone), Math.max(now, booking.slot.startsAt));
  const invoiceId = await ctx.db.insert("invoices", {
    companyId: booking.companyId,
    customerId: booking.customerId,
    propertyId: booking.propertyId,
    status: "open",
    number,
    lines,
    taxRateBps,
    taxLabel: settings.taxLabel,
    totals: { ...emptyTotals(), ...base, balanceCents: base.totalCents },
    depositCents: deposit,
    memo: settings.invoiceNote ?? undefined,
    publicId: newPublicId(),
    issuedAt: now,
    issuedBy: by,
    dueAt,
    revision: 1,
    createdBy: booking.createdBy ?? by,
    createdAt: now,
    updatedAt: now,
  });
  const invoice = await recompute(ctx, invoiceId);
  await recordEvent(ctx, { companyId: booking.companyId, type: "invoice.issued", actor: { kind: "member", memberId: by }, subject: { table: "invoices", id: invoiceId }, data: { amountCents: invoice.totals.totalCents, number, depositCents: deposit ?? null, bookingId: booking._id } });
  return invoice;
}

/** Whether what the booking asked for up front has been paid, from the invoice's recorded payments only. */
export function paidUpFront(booking: Doc<"bookings">, invoice: Doc<"invoices"> | null): boolean {
  const policy = booking.requirements.payment.policy;
  if (policy !== "deposit" && policy !== "full") return true;
  if (!invoice || invoice.status === "void") return false;
  const needed = policy === "full" ? invoice.totals.totalCents : (invoice.depositCents ?? invoice.totals.totalCents);
  return invoice.totals.paidCents >= needed;
}
