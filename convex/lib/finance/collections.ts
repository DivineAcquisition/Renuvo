/**
 * Selestial's collection work: which reminder an open invoice is due for, and preparing the draft a
 * person approves. The schedule is the owner's decision of November 17, 2026: a friendly note 3 days
 * before the due date, then 1, 7 and 14 days overdue. After that Selestial prepares nothing more and the
 * invoice is flagged for the Owner to decide.
 *
 * Preparing never sends. A draft holds the words, the channel and what the invoice said when the words
 * were written; approving it is a separate, person-only step (convex/financeMessages.ts).
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";
import { amountRequested, inDepositStage, invoiceState } from "./invoiceState";
import { addressFor, type Channel } from "./outbox";
import type { FinanceMessageStage } from "./schema";
import { emailFor, textFor, type TemplateInput } from "./templates";

const DAY = 86_400_000;

/** The schedule, in order. A later step makes the earlier ones unnecessary. */
export const SCHEDULE: readonly FinanceMessageStage[] = ["before_due", "overdue_1", "overdue_7", "overdue_14"];
export const LAST_STEP_AFTER_DAYS = 14;

/** The step of the schedule this invoice is due for now, or null. */
export function stageDue(invoice: Pick<Doc<"invoices">, "status" | "dueAt" | "issuedAt" | "totals" | "depositCents" | "balanceRequestedAt">, now: number): FinanceMessageStage | null {
  if (invoice.status !== "open" || invoice.dueAt === undefined || amountRequested(invoice) <= 0) return null;
  const late = now - invoice.dueAt;
  if (late >= 14 * DAY) return "overdue_14";
  if (late >= 7 * DAY) return "overdue_7";
  if (late >= 1 * DAY) return "overdue_1";
  // Before the due date: only once inside the last 3 days, and not for an invoice issued inside them (it was just sent).
  if (late < 0 && -late <= 3 * DAY && (invoice.issuedAt ?? 0) < invoice.dueAt - 3 * DAY) return "before_due";
  return null;
}

export function basisOf(invoice: Doc<"invoices">, now: number) {
  return { requestedCents: amountRequested(invoice), dueAt: invoice.dueAt ?? null, state: invoiceState(invoice, now) };
}

export function sameBasis(a: { requestedCents: number; dueAt: number | null; state: string }, b: { requestedCents: number; dueAt: number | null; state: string }) {
  return a.requestedCents === b.requestedCents && a.dueAt === b.dueAt && a.state === b.state;
}

/** The channel a message to this customer starts on: email when there is an address, else a text. */
export function defaultChannel(customer: Pick<Doc<"customers">, "email" | "phone">): Channel {
  if (addressFor(customer, "email")) return "email";
  if (addressFor(customer, "sms")) return "sms";
  return "email";
}

function dueWords(at: number | undefined, timezone: string): string | null {
  if (at === undefined) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "short", day: "numeric" }).format(new Date(at));
}

export function templateInput(company: Doc<"companies">, customer: Doc<"customers">, invoice: Doc<"invoices">, now: number): TemplateInput {
  return {
    company: company.name,
    customer: customer.name,
    invoice,
    requestedCents: amountRequested(invoice),
    totalCents: invoice.totals.totalCents,
    deposit: inDepositStage(invoice),
    dueWords: dueWords(invoice.dueAt, company.timezone),
    forWhat: invoice.lines[0]?.description.split(" · ")[0]?.toLowerCase() ?? null,
    now,
    dueAt: invoice.dueAt ?? null,
  };
}

export function wordsFor(stage: FinanceMessageStage, channel: Channel, input: TemplateInput): { subject?: string; body: string } {
  return channel === "email" ? emailFor(stage, input) : { body: textFor(stage, input) };
}

export async function invoiceDrafts(ctx: QueryCtx | MutationCtx, invoice: Pick<Doc<"invoices">, "_id" | "companyId">): Promise<Doc<"financeMessages">[]> {
  return ctx.db
    .query("financeMessages")
    .withIndex("by_company_invoice", (q) => q.eq("companyId", invoice.companyId).eq("invoiceId", invoice._id))
    .take(100);
}

/**
 * Prepares one draft. A schedule step already prepared (in any state, skipped included) is not prepared
 * again, and an older draft still waiting for the same invoice is set aside: the newest one is what
 * the invoice needs now.
 */
export async function prepareDraft(
  ctx: MutationCtx,
  input: { invoice: Doc<"invoices">; stage: FinanceMessageStage; channel?: Channel; preparedBy: Doc<"financeMessages">["preparedBy"]; actor: Actor },
): Promise<{ draftId: Id<"financeMessages">; created: boolean }> {
  const { invoice, stage } = input;
  const existing = await invoiceDrafts(ctx, invoice);
  if (SCHEDULE.includes(stage)) {
    // A step of the schedule is prepared once per invoice, whatever became of it.
    const same = existing.find((row) => row.stage === stage);
    if (same) return { draftId: same._id, created: false };
  } else {
    // The invoice itself, or a reminder a person asked for: one waiting draft at a time; asked again later, a new one.
    const waiting = existing.find((row) => row.stage === stage && row.status === "draft");
    if (waiting) return { draftId: waiting._id, created: false };
  }
  const company = (await ctx.db.get(invoice.companyId))!;
  const customer = (await ctx.db.get(invoice.customerId))!;
  const now = Date.now();
  const channel = input.channel ?? defaultChannel(customer);
  const words = wordsFor(stage, channel, templateInput(company, customer, invoice, now));
  for (const row of existing) {
    if (row.status === "draft" && row.kind === "reminder" && stage !== "invoice") {
      await ctx.db.patch(row._id, { status: "stale", closedReason: "A newer reminder replaced it.", updatedAt: now });
    }
  }
  const draftId = await ctx.db.insert("financeMessages", {
    companyId: invoice.companyId,
    invoiceId: invoice._id,
    customerId: invoice.customerId,
    kind: stage === "invoice" ? "invoice" : "reminder",
    stage,
    channel,
    subject: words.subject,
    body: words.body,
    status: "draft",
    edited: false,
    basis: basisOf(invoice, now),
    preparedBy: input.preparedBy,
    createdAt: now,
    updatedAt: now,
  });
  await recordEvent(ctx, { companyId: invoice.companyId, type: "collection.drafted", actor: input.actor, subject: { table: "financeMessages", id: draftId }, data: { stage, channel, amountCents: amountRequested(invoice) } });
  return { draftId, created: true };
}

/** Rewrites a draft Selestial wrote from the invoice as it is now. A draft the Owner edited is left to them. */
export async function refreshDraft(ctx: MutationCtx, draft: Doc<"financeMessages">, invoice: Doc<"invoices">, channel: Channel = draft.channel) {
  const company = (await ctx.db.get(invoice.companyId))!;
  const customer = (await ctx.db.get(invoice.customerId))!;
  const now = Date.now();
  const words = wordsFor(draft.stage, channel, templateInput(company, customer, invoice, now));
  await ctx.db.patch(draft._id, { channel, subject: words.subject, body: words.body, basis: basisOf(invoice, now), edited: false, updatedAt: now });
}

/** Why a waiting draft no longer applies, or null. */
export function noLongerNeeded(draft: Doc<"financeMessages">, invoice: Doc<"invoices"> | null): string | null {
  if (!invoice) return "The invoice no longer exists.";
  if (invoice.status === "void") return "The invoice was voided.";
  if (invoice.status === "paid") return "The invoice was paid.";
  if (draft.kind === "reminder" && amountRequested(invoice) === 0) return invoice.totals.processingCents > 0 ? "A payment is on its way." : "Nothing is being asked for right now.";
  return null;
}
