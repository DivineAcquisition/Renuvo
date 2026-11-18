/**
 * Taking an inquiry in, from any source, once, as a pipeline opportunity the Sales agent works.
 *
 *  - Who it is. A person is matched to a customer on record only by their own address: the same email,
 *    or the same phone with the same name. The same phone under a different name (a household, a front
 *    desk) is not a match: a new record is made and the opportunity is marked for a person to say
 *    whether they are the same. A name alone never matches anyone.
 *  - What it is. Every inquiry is its own opportunity, even for a customer who has others. Matching a
 *    person never merges two requests.
 *  - Permission. What the person agreed to is recorded as they gave it: a text they sent, a box they
 *    ticked, or what a person at the company wrote down. An import records nothing, so the sending
 *    policy refuses to contact them until someone records real permission.
 *  - Once. `dedupeKey` names the inquiry (a form's submission, a provider's message id), so a delivery
 *    that arrives twice files one opportunity.
 *
 * A reply from the customer is recorded in the conversation, stops any reminder that was planned, and
 * sets aside anything Sales had drafted before it arrived. Then Sales reads it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { setPermission } from "../compliance/permissions";
import { normalAddress } from "../compliance/recipients";
import type { Channel, PermissionSource } from "../compliance/schema";
import { recordEvent, type Actor } from "../events";
import { RECORD_STATUSES, type WorkKind } from "../statuses";
import { quiet } from "./actions";
import { agentStage, load, SALES, SEGMENT_OF_KIND, setNext, type Opp } from "./agentOpportunity";
import type { Fact, ServiceKind, Source } from "./agentSchema";

type Ctx = QueryCtx | MutationCtx;
const MINUTE = 60_000;
const SCAN_LIMIT = 2000;

const WORK_KIND: Record<ServiceKind, WorkKind> = { residential: "home", commercial: "commercial", short_term_rental: "short_term_rental" };
const fold = (value: string | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export type Contact = { name: string; email?: string; phone?: string };

export type Matched = { state: "matched"; customer: Doc<"customers"> } | { state: "none" } | { state: "needs_review"; candidates: Doc<"customers">[] };

/** Who on record this contact is, by their own address. Reads a bounded number of customers; the table has no index on an address yet. */
export async function matchCustomer(ctx: Ctx, companyId: Id<"companies">, contact: Contact): Promise<Matched> {
  const email = normalAddress("email", contact.email);
  const phone = normalAddress("sms", contact.phone);
  if (!email && !phone) return { state: "none" };
  const byEmail: Doc<"customers">[] = [];
  const byPhone: Doc<"customers">[] = [];
  for (const status of RECORD_STATUSES) {
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
      .take(SCAN_LIMIT);
    for (const row of rows) {
      if (email && normalAddress("email", row.email) === email) byEmail.push(row);
      else if (phone && normalAddress("sms", row.phone) === phone) byPhone.push(row);
    }
  }
  if (byEmail.length === 1) return { state: "matched", customer: byEmail[0] };
  if (byEmail.length > 1) return { state: "needs_review", candidates: byEmail.slice(0, 5) };
  // The same number is the same person only when the name agrees. Otherwise someone decides.
  const sameName = byPhone.filter((row) => fold(row.name) === fold(contact.name) && fold(contact.name) !== "");
  if (sameName.length === 1) return { state: "matched", customer: sameName[0] };
  if (byPhone.length > 0) return { state: "needs_review", candidates: byPhone.slice(0, 5) };
  return { state: "none" };
}

export type Consent = {
  channel: Channel;
  source: PermissionSource;
  /** What the record of it is: "Ticked the box on the Home Cleaning form", "Texted the company's number first". */
  evidence: string;
  /** The exact words the person agreed to, for a box on a form. */
  disclosureText?: string;
};

export type NewInquiry = {
  contact: Contact;
  /** A customer already on record, chosen by a person. Skips matching. */
  customerId?: Id<"customers">;
  kind: ServiceKind;
  source: { kind: Source; externalId?: string; campaign?: string; medium?: string; referrer?: string };
  inquiry: string;
  receivedAt: number;
  channel: Channel;
  facts?: Fact[];
  serviceKey?: string;
  timing?: string;
  consent?: Consent[];
  dedupeKey: string;
  /** The provider's id for the first message, so the same delivery is kept once. */
  providerId?: string;
  actor: Actor;
};

export async function opportunityByKey(ctx: Ctx, companyId: Id<"companies">, dedupeKey: string): Promise<Doc<"salesOpportunities"> | null> {
  // An inquiry is named by its source's own id, so the same one is never filed twice.
  return ctx.db
    .query("salesOpportunities")
    .withIndex("by_company_dedupe", (q) => q.eq("companyId", companyId).eq("dedupeKey", dedupeKey))
    .first();
}

/** Files one inquiry as one opportunity. The same `dedupeKey` answers with the opportunity it already made. */
const SOURCE_WORDS: Record<Source, string> = { form: "Form", sms: "Text message", email: "Email", manual: "Entered by the team", import: "Import", google_lead: "Google lead form", booking_page: "Booking page" };

export async function fileInquiry(ctx: MutationCtx, company: Doc<"companies">, input: NewInquiry): Promise<{ opportunity: Opp; created: boolean }> {
  const existing = await opportunityByKey(ctx, company._id, input.dedupeKey);
  if (existing) return { opportunity: await load(ctx, existing._id), created: false };
  const now = Date.now();
  const name = input.contact.name.trim().slice(0, 160) || input.contact.email?.trim() || input.contact.phone?.trim() || "New inquiry";
  let customer: Doc<"customers"> | null = input.customerId ? await ctx.db.get(input.customerId) : null;
  if (customer && customer.companyId !== company._id) customer = null;
  let match: Doc<"salesOpportunities">["match"] = { state: "matched" };
  if (!customer) {
    const found = await matchCustomer(ctx, company._id, { ...input.contact, name });
    if (found.state === "matched") customer = found.customer;
    else {
      const customerId = await ctx.db.insert("customers", { companyId: company._id, name, kind: WORK_KIND[input.kind], email: normalAddress("email", input.contact.email) ?? undefined, phone: input.contact.phone?.trim().slice(0, 40) || undefined, status: "active", createdAt: now });
      await recordEvent(ctx, { companyId: company._id, type: "customer.created", actor: input.actor, subject: { table: "customers", id: customerId }, data: { from: "sales_inquiry" } });
      customer = (await ctx.db.get(customerId))!;
      match = found.state === "needs_review" ? { state: "needs_review", candidates: found.candidates.map((row) => row._id) } : { state: "created" };
    }
  }
  // What they agreed to, as they gave it. Nothing is assumed from the fact that they asked.
  for (const consent of input.consent ?? []) {
    if (!normalAddress(consent.channel, consent.channel === "email" ? customer.email : customer.phone)) continue;
    await setPermission(ctx, { companyId: company._id, recipient: { kind: "customer", id: customer._id }, channel: consent.channel, category: "operational", status: "granted", source: consent.source, evidence: consent.evidence.slice(0, 300), ...(consent.disclosureText ? { disclosureText: consent.disclosureText.slice(0, 1000) } : {}), recordedBy: input.actor.kind === "member" ? { kind: "member", memberId: input.actor.memberId } : input.source.kind === "manual" ? { kind: "system" } : { kind: "recipient" }, at: now, actor: input.actor });
  }
  const opportunityId = await ctx.db.insert("salesOpportunities", {
    companyId: company._id,
    title: name,
    segment: SEGMENT_OF_KIND[input.kind],
    customerId: customer._id,
    stage: "new",
    ...(input.actor.kind === "member" ? { ownerMemberId: input.actor.memberId, createdBy: input.actor.memberId } : {}),
    source: SOURCE_WORDS[input.source.kind],
    followUps: "on",
    intake: input.source,
    inquiry: input.inquiry.trim().slice(0, 4000) || "(no message)",
    receivedAt: input.receivedAt,
    kind: input.kind,
    serviceKey: input.serviceKey,
    ...(input.timing?.trim() ? { timing: { text: input.timing.trim().slice(0, 300) } } : {}),
    facts: (input.facts ?? []).slice(0, 60),
    asked: [],
    match,
    channel: input.channel,
    humanTouches: input.actor.kind === "member" ? 1 : 0,
    dedupeKey: input.dedupeKey,
    revision: 0,
    lastInboundAt: input.receivedAt,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("salesMessages", { companyId: company._id, opportunityId, customerId: customer._id, direction: "in", channel: input.source.kind === "form" ? "form" : input.source.kind === "sms" ? "sms" : input.source.kind === "email" ? "email" : "internal", author: input.actor.kind === "member" ? { kind: "member", memberId: input.actor.memberId } : { kind: "customer" }, body: input.inquiry.trim().slice(0, 4000) || "(no message)", providerId: input.providerId, at: input.receivedAt });
  await recordEvent(ctx, { companyId: company._id, type: "opportunity.created", actor: input.actor, subject: { table: "salesOpportunities", id: opportunityId }, data: { source: input.source.kind, kind: input.kind, match: match.state } });
  let opportunity = await load(ctx, opportunityId);
  opportunity = await setNext(ctx, opportunity, match.state === "needs_review" ? { what: `${name} may already be a customer. Say whether they are the same person before the agent replies.`, by: "owner", dueAt: now + 60 * MINUTE } : { what: `Read ${name}'s inquiry and reply`, by: "sales", dueAt: now + 15 * MINUTE }, SALES);
  return { opportunity, created: true };
}

/**
 * A message from the customer on an open opportunity. Kept once per provider id. Whatever Sales had
 * planned or drafted before it arrived is stopped: nothing written before a reply goes out after it.
 */
export async function recordInbound(ctx: MutationCtx, opportunity: Opp, input: { channel: "sms" | "email"; body: string; subject?: string; providerId?: string; at: number }): Promise<{ message: Doc<"salesMessages">; created: boolean }> {
  if (input.providerId) {
    const seen = await ctx.db
      .query("salesMessages")
      .withIndex("by_company_provider", (q) => q.eq("companyId", opportunity.companyId).eq("providerId", input.providerId))
      .first();
    if (seen) return { message: seen, created: false };
  }
  const messageId = await ctx.db.insert("salesMessages", { companyId: opportunity.companyId, opportunityId: opportunity._id, customerId: opportunity.customerId, direction: "in", channel: input.channel, author: { kind: "customer" }, subject: input.subject?.slice(0, 200), body: input.body.trim().slice(0, 4000), providerId: input.providerId, at: input.at });
  // An out-of-order delivery never moves the clock backwards.
  const lastInboundAt = Math.max(opportunity.lastInboundAt ?? 0, input.at);
  await ctx.db.patch(opportunity._id, { lastInboundAt, revision: opportunity.agent.revision + 1, updatedAt: Date.now() });
  await quiet(ctx, opportunity, "The customer replied.", { kind: "system" });
  await recordEvent(ctx, { companyId: opportunity.companyId, type: "opportunity.reply_received", actor: { kind: "system" }, subject: { table: "salesOpportunities", id: opportunity._id }, data: { channel: input.channel } });
  return { message: (await ctx.db.get(messageId))!, created: true };
}

/**
 * The open opportunity the agent works that a message from this customer belongs to: the one the agent
 * last wrote to, else the newest. A deal a person runs by hand is never picked up from a text.
 */
export async function openOpportunityFor(ctx: Ctx, companyId: Id<"companies">, customerId: Id<"customers">): Promise<Opp | null> {
  const rows = await ctx.db
    .query("salesOpportunities")
    .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
    .take(50);
  const open = rows.filter((row) => row.intake !== undefined && agentStage(row) !== "won" && agentStage(row) !== "closed_lost");
  if (open.length === 0) return null;
  const best = open.sort((a, b) => (b.lastOutboundAt ?? b.createdAt) - (a.lastOutboundAt ?? a.createdAt))[0];
  return load(ctx, best._id);
}

/** Whether anyone has ever cleaned for this customer. Such a customer's messages belong to Retention, not to Sales. */
export async function hasServiceHistory(ctx: Ctx, companyId: Id<"companies">, customerId: Id<"customers">): Promise<boolean> {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
    .take(20);
  return jobs.some((job) => job.status !== "cancelled");
}
