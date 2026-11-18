/**
 * How the Sales agent's records read on a screen. Everything here is worked out from the record at the moment of
 * asking: attention, "working", delivery, readiness. Nothing is a stored opinion, and nothing shows
 * work that is not happening.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { isManager, type Role } from "../roles";
import { ACTION_WORDS, openActions } from "./actions";
import { openFollowUps } from "./agentFollowUps";
import { ATTENTION_WORDS, attentionOf, currentQuote, STAGE_WORDS, type Opp } from "./agentOpportunity";
import { quotePer, quoteTotal } from "./agentQuotes";
import type { ServiceKind, Source } from "./agentSchema";
import { FACT_LABELS, factOf, factWords, known, requirementsFor, type Requirement } from "./facts";
import { deliveryWords, opportunityMessages } from "./outbox";
import { activeRun } from "./runs";
import { publishedByKey } from "../services/store";

export const SOURCE_WORDS: Record<Source, string> = { form: "Booking form", sms: "Text message", email: "Email", manual: "Added by a person", import: "Imported", google_lead: "Google lead", booking_page: "Booking page" };
export const KIND_WORDS: Record<ServiceKind, string> = { residential: "Home", commercial: "Commercial", short_term_rental: "Short-term rental" };

export async function cardOf(ctx: QueryCtx, opportunity: Opp) {
  const customer = await ctx.db.get(opportunity.customerId);
  const quote = await currentQuote(ctx, opportunity);
  const service = opportunity.serviceKey ? await publishedByKey(ctx, opportunity.companyId, opportunity.serviceKey) : null;
  const pending = await openActions(ctx, opportunity);
  const run = await activeRun(ctx, opportunity);
  const followUps = await openFollowUps(ctx, opportunity);
  const nextFollowUp = followUps.sort((a, b) => a.dueAt - b.dueAt)[0] ?? null;
  const next = opportunity.agent.next;
  const failed = pending.length === 0 && next?.by === "owner";
  const attention = attentionOf(opportunity, { pendingForOwner: pending.length > 0 || quote?.status === "awaiting_approval", running: run?.status === "running", blocked: failed && /could not|cannot|not allowed|paused/i.test(next?.what ?? ""), followUpAt: nextFollowUp?.dueAt ?? null });
  const stage = opportunity.agent.stage;
  return {
    opportunityId: opportunity._id,
    customerId: opportunity.customerId,
    customer: customer?.name ?? "A prospect",
    kind: opportunity.agent.kind,
    kindWords: KIND_WORDS[opportunity.agent.kind],
    service: service?.version.spec.name ?? null,
    stage,
    stageWords: STAGE_WORDS[stage],
    attention,
    attentionWords: ATTENTION_WORDS[attention],
    nextAction: next,
    quote: quote ? { quoteId: quote._id, status: quote.status, totalCents: quoteTotal(quote), per: quotePer(quote) } : null,
    source: opportunity.intake?.kind ?? null,
    sourceWords: opportunity.intake ? SOURCE_WORDS[opportunity.intake.kind] : (opportunity.source ?? "Added by a person"),
    channel: opportunity.agent.channel,
    receivedAt: opportunity.receivedAt ?? opportunity.createdAt,
    lastInboundAt: opportunity.lastInboundAt ?? null,
    lastOutboundAt: opportunity.lastOutboundAt ?? null,
    takenOver: opportunity.agent.takeover !== null,
    working: run?.status === "running",
    followUpAt: nextFollowUp?.dueAt ?? null,
    deferredUntil: opportunity.deferredUntil ?? null,
    lostReason: opportunity.lostReason ?? null,
    bookingId: opportunity.bookingId ?? null,
    draftId: opportunity.draftId ?? null,
    updatedAt: opportunity.updatedAt,
  };
}
export type OpportunityCard = Awaited<ReturnType<typeof cardOf>>;

/** The qualification checklist: what this service needs, what is known and from where, and what is still open. */
export function checklistOf(opportunity: Opp, requirements: Requirement[]) {
  return requirements.map((requirement) => {
    const fact = factOf(opportunity.agent.facts, requirement.key);
    const has = known(opportunity.agent.facts, requirement.key);
    const asked = opportunity.agent.asked.find((row) => row.key === requirement.key);
    return {
      key: requirement.key,
      label: requirement.label,
      why: requirement.why,
      phase: requirement.phase,
      // How a person fills it in by hand: the kind of answer, and the choices when there are some.
      type: requirement.type,
      options: requirement.options ?? null,
      raw: fact ? fact.value : null,
      state: has ? ("known" as const) : fact ? ("unverified" as const) : ("missing" as const),
      value: fact ? factWords(fact, requirements) : null,
      status: fact?.status ?? null,
      source: fact ? { kind: fact.source.kind, excerpt: fact.source.excerpt ?? null } : null,
      asked: asked ? { times: asked.times, at: asked.at } : null,
    };
  });
}

/** Facts on record that the service does not ask for: kept and shown, never asked again. */
export function otherFacts(opportunity: Opp, requirements: Requirement[]) {
  return opportunity.agent.facts
    .filter((fact) => !requirements.some((row) => row.key === fact.key))
    .map((fact) => ({ key: fact.key, label: FACT_LABELS[fact.key] ?? fact.key.replace(/^answer:|^addOn:/, ""), value: typeof fact.value === "boolean" ? (fact.value ? "Yes" : "No") : String(fact.value), status: fact.status, source: { kind: fact.source.kind, excerpt: fact.source.excerpt ?? null } }));
}

export async function requirementsOf(ctx: QueryCtx, opportunity: Opp): Promise<{ requirements: Requirement[]; serviceName: string | null }> {
  const service = opportunity.serviceKey ? await publishedByKey(ctx, opportunity.companyId, opportunity.serviceKey) : null;
  return { requirements: requirementsFor(service?.version.spec ?? null, opportunity.agent.kind), serviceName: service?.version.spec.name ?? null };
}

/** The conversation, oldest first, with what the provider reported for each message Sales or a person sent. */
export async function threadOf(ctx: QueryCtx, opportunity: Pick<Opp, "_id" | "companyId">, limit = 200) {
  const rows = await ctx.db
    .query("salesMessages")
    .withIndex("by_company_opportunity", (q) => q.eq("companyId", opportunity.companyId).eq("opportunityId", opportunity._id))
    .order("desc")
    .take(limit);
  const outbox = new Map((await opportunityMessages(ctx, opportunity)).map((row) => [row._id as string, row]));
  const members = new Map<string, string>();
  const out = [];
  for (const row of rows.reverse()) {
    const sent = row.messageId ? outbox.get(row.messageId) : undefined;
    let author = "Customer";
    if (row.author.kind === "agent") author = "Sales agent";
    else if (row.author.kind === "system") author = "Selestial";
    else if (row.author.kind === "member") {
      if (!members.has(row.author.memberId)) members.set(row.author.memberId, (await ctx.db.get(row.author.memberId))?.name ?? "A team member");
      author = members.get(row.author.memberId)!;
    }
    out.push({
      messageId: row._id,
      direction: row.direction,
      channel: row.channel,
      author,
      authorKind: row.author.kind,
      subject: row.subject ?? null,
      // The link is shown as a placeholder: the real address is made only when the message is sent.
      body: row.body.replaceAll("{link}", "[quote link]"),
      at: row.at,
      delivery: sent ? { ...deliveryWords(sent), at: sent.deliveredAt ?? sent.sentAt ?? sent.failedAt ?? sent.queuedAt } : null,
    });
  }
  return out;
}

export function actionView(action: Doc<"salesActions">, customer: string) {
  return {
    actionId: action._id,
    opportunityId: action.opportunityId,
    customer,
    kind: action.kind,
    kindWords: ACTION_WORDS[action.kind],
    status: action.status,
    channel: action.channel ?? null,
    subject: action.subject ?? null,
    body: action.body ? action.body.replaceAll("{link}", "[quote link]") : null,
    summary: action.summary,
    reason: action.reason,
    evidence: action.evidence,
    nextStep: action.nextStep ?? null,
    permission: action.permission,
    level: action.level,
    writtenBy: action.writtenBy === "rules" ? "Your templates" : "AI wording, checked against your templates",
    edited: action.editedBy !== undefined,
    inBatch: action.batchId !== undefined,
    quoteId: action.quoteId ?? null,
    bookingId: action.bookingId ?? null,
    result: action.result ?? null,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}
export type ActionView = ReturnType<typeof actionView>;

/** Access instructions are for the people who run the work. Office sees that they are on record, not what they say. */
export function accessFor(role: Role, value: string | undefined): { onRecord: boolean; text: string | null } {
  const text = value?.trim() || null;
  return { onRecord: text !== null, text: isManager(role) ? text : null };
}

export async function customerName(ctx: QueryCtx, customerId: Id<"customers">): Promise<string> {
  return (await ctx.db.get(customerId))?.name ?? "A prospect";
}
