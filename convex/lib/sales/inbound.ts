/**
 * A text that reached the company's number and is not a keyword (STOP, HELP, START): is it Sales's?
 *
 *  - From a prospect with an open opportunity: yes. It joins that conversation and Sales reads it.
 *  - From a number nobody on record has: it is a new inquiry, if the Playbook says Sales takes inquiries
 *    by text. Texting the company first is the permission to answer by text, and is recorded as that.
 *  - From a customer the company has already served, with no open opportunity: no. That relationship is
 *    Retention's, and the text goes where it went before Sales existed (a task for a person).
 *  - From a cleaner or an applicant: no.
 *
 * Unlike the compliance handler, which keeps only an excerpt, Sales keeps the message: it is the
 * customer's request, and the conversation cannot be read without it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { RecipientRecord } from "../compliance/recipients";
import { AGENT_PROFILES } from "../departments";
import { allow } from "../rateLimit";
import { quiet } from "./actions";
import { fileInquiry, hasServiceHistory, openOpportunityFor, recordInbound } from "./intake";
import { setStage, SYSTEM } from "./opportunities";
import { enqueueRun } from "./runs";
import { salesSettings } from "./settings";

const HOUR = 60 * 60_000;

export async function salesInboundSms(ctx: MutationCtx, input: { companyId: Id<"companies">; from: string; body: string; receivedAt: number; known: RecipientRecord[]; providerId?: string }): Promise<boolean> {
  if (!AGENT_PROFILES.sales.built) return false;
  const company = await ctx.db.get(input.companyId);
  if (!company) return false;
  // A number shared with a cleaner or an applicant is not Sales's to answer.
  if (input.known.some((person) => person.kind !== "customer")) return false;
  const customers = input.known.filter((person) => person.kind === "customer");
  if (customers.length > 1) return false;

  let opportunity: Doc<"salesOpportunities"> | null = null;
  if (customers.length === 1) {
    const customerId = customers[0].id as Id<"customers">;
    opportunity = await openOpportunityFor(ctx, company._id, customerId);
    if (!opportunity) {
      // No open request, and the company has cleaned for them: this is an existing customer's message.
      if (await hasServiceHistory(ctx, company._id, customerId)) return false;
    }
  }
  if (opportunity) {
    if (!(await allow(ctx, `sales-inbound:${company._id}:${input.from}`, 30, HOUR))) return true;
    const { message, created } = await recordInbound(ctx, opportunity, { channel: "sms", body: input.body, providerId: input.providerId, at: input.receivedAt });
    if (!created) return true;
    const fresh = (await ctx.db.get(opportunity._id))!;
    // While a person holds the conversation the message is kept and shown, and Sales does not answer it.
    if (!fresh.takeover) await enqueueRun(ctx, fresh, { trigger: "reply", key: `reply:${message._id}`, messageId: message._id });
    return true;
  }
  if (!salesSettings(company).eligibility.textInquiries) return false;
  // A stream of texts from unknown numbers cannot open a stream of opportunities.
  if (!(await allow(ctx, `sales-inquiry:${company._id}:${input.from}`, 3, HOUR)) || !(await allow(ctx, `sales-inquiry:${company._id}`, 200, HOUR))) return true;
  const { opportunity: filed, created } = await fileInquiry(ctx, company, {
    contact: { name: customers[0]?.name ?? "", phone: input.from },
    customerId: customers[0] ? (customers[0].id as Id<"customers">) : undefined,
    kind: "residential",
    source: { kind: "sms", externalId: input.providerId },
    inquiry: input.body,
    receivedAt: input.receivedAt,
    channel: "sms",
    consent: [{ channel: "sms", source: "text_reply", evidence: "Texted the company's number first to ask about service." }],
    dedupeKey: `sms:${input.providerId ?? `${input.from}:${input.receivedAt}`}`,
    providerId: input.providerId,
    actor: SYSTEM,
  });
  if (created) {
    const first = await ctx.db
      .query("salesMessages")
      .withIndex("by_company_opportunity", (q) => q.eq("companyId", company._id).eq("opportunityId", filed._id))
      .first();
    await enqueueRun(ctx, filed, { trigger: "inquiry", key: `inquiry:${filed._id}`, messageId: first?._id });
  }
  return true;
}

/** The customer opted out (STOP, or asked in their own words). Sales stops and closes what it had open with them. */
export async function salesOptedOut(ctx: MutationCtx, companyId: Id<"companies">, known: RecipientRecord[]): Promise<void> {
  for (const person of known) {
    if (person.kind !== "customer") continue;
    const rows = await ctx.db
      .query("salesOpportunities")
      .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", person.id as Id<"customers">))
      .take(50);
    for (const row of rows) {
      if (row.stage === "won" || row.stage === "closed_lost" || row.channel !== "sms") continue;
      await quiet(ctx, row, "The customer asked not to be texted.", SYSTEM);
      // A booking already in progress is a person's to sort out; anything earlier is closed.
      if (row.stage !== "booking_pending") await setStage(ctx, (await ctx.db.get(row._id))!, "closed_lost", SYSTEM, { reason: "opted_out", note: "Replied STOP." });
    }
  }
}
