/**
 * What the Sales agent does next for one opportunity, as checked steps.
 *
 * A run reads the opportunity and the conversation, takes what the reader found in the customer's latest
 * message (already checked against that message), and then works through a small set of tools. Each
 * tool reads the record again and applies the rules in code: what a service needs is the service's, a
 * price is the engine's (through the workspace's own pricing), capacity is the booking engine's, a
 * permission is the Owner's. A model never chooses the tool, the price, the time or the recipient; where
 * one is connected it reads a message and words a reply, and both are checked before they are used.
 *
 * Every step is recorded in words an owner can read. A step that could not happen says why.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { recordEvent } from "../events";
import { publishedCatalog } from "../services/store";
import { formatCents } from "../services/words";
import { businessSettingsOf, normalizePostalCode } from "../settings/business";
import { CONFIRM_BOOKING, FOLLOW_UP, prepareAction, quiet, REPLY_AND_QUOTE, routeAction, voiceOf, type NewAction, type Routed } from "./actions";
import { bookingReadiness, whenWords } from "./agentBooking";
import { dueProblem, planFollowUp, PURPOSE_WORDS } from "./agentFollowUps";
import { bump, currentQuote, isOpen, load, SALES, SEGMENT_OF_KIND, setNext, setStage, type Opp } from "./agentOpportunity";
import { priceOpportunity, quotePer, quoteService, quoteTotal, reviewReason, saveAgentQuote, type Priced } from "./agentQuotes";
import type { Reading, RunStep, Trigger } from "./agentSchema";
import { factOf, FACT_LABELS, factWords, kindOfService, known, missingFor, requirementsFor, withFact } from "./facts";
import { asFacts, lostReasonFrom } from "./interpret";
import { canReach } from "./outbox";
import { salesSettings } from "./settings";
import { acceptOnPageMessage, answerMessage, bookingHeldMessage, bookingStepsMessage, missingInfoReminder, plural, questionMessage, quoteMessage, quoteReminder, requestedDateMessage, serviceQuestion } from "./words";

export const TOOLS = ["read_opportunity", "read_services", "record_facts", "ask_customer", "answer_question", "calculate_quote", "prepare_quote", "request_approval", "send_message", "schedule_follow_up", "cancel_follow_ups", "check_booking_readiness", "request_booking", "escalate", "close_opportunity", "defer_opportunity"] as const;
export type Tool = (typeof TOOLS)[number];

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** The most steps one run may take. A run that reaches it stops and says so. */
export const MAX_STEPS = 12;

export type RunInput = {
  trigger: Trigger;
  runId?: Id<"salesRuns">;
  /** The reader's checked reading of the customer's latest message, when the run is about one. */
  reading?: Reading;
  /** The conversation entry the reading is of. */
  messageRef?: string;
  /** The customer's words, for excerpts shown to the owner. */
  messageText?: string;
  followUpId?: Id<"salesFollowUps">;
  /** False when the caller will word the drafts first and route them afterwards. */
  route: boolean;
};

export type RunOutput = { steps: RunStep[]; result: string; drafts: Id<"salesActions">[] };

/** Questions the agent answers by doing its job: what it costs, and whether the company takes this kind of work. */
const PRICE_QUESTION = /\b(how much|price[sd]?|pricing|costs?|quotes?|estimates?|rates?|charge[sd]?|fees?|do you (clean|offer|do|provide|service|have)|can you (clean|do|help)|are you (taking|accepting))\b/i;
/** A first name to greet by, or a neutral word when the record only has a number or an address for them. */
const firstName = (name: string, fallback: string) => (/^[+\d\s().-]+$/.test(name.trim()) || name.includes("@") || !name.trim() ? fallback : name.trim().split(/\s+/)[0]);

const WORDS = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 3));

/** An approved answer for what the customer asked, when the Playbook has one that plainly covers it. */
function approvedAnswer(questions: string[], answers: ReturnType<typeof salesSettings>["answers"]): { question: string; answer: string } | null {
  for (const question of questions) {
    const asked = WORDS(question);
    let best: { score: number; row: (typeof answers)[number] } | null = null;
    for (const row of answers) {
      const have = WORDS(`${row.topic} ${row.question}`);
      const score = [...asked].filter((word) => have.has(word)).length;
      if (score >= 2 || (score === 1 && asked.has(row.topic.toLowerCase()))) if (!best || score > best.score) best = { score, row };
    }
    if (best) return { question, answer: best.row.answer };
  }
  return null;
}

const shortDate = (at: number, timezone: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(new Date(at));

export async function advance(ctx: MutationCtx, company: Doc<"companies">, opportunityId: Id<"salesOpportunities">, input: RunInput): Promise<RunOutput> {
  const steps: RunStep[] = [];
  const drafts: Id<"salesActions">[] = [];
  const settings = salesSettings(company);
  const step = (tool: Tool, outcome: RunStep["outcome"], summary: string) => {
    if (steps.length < MAX_STEPS) steps.push({ tool, outcome, summary: summary.slice(0, 400), at: Date.now() });
  };
  const fresh = () => load(ctx, opportunityId);
  let opportunity = await fresh();
  const customer = await ctx.db.get(opportunity.customerId);
  const onRecord = customer?.name ?? "";
  const name = firstName(onRecord, "") ? onRecord : "This prospect";
  const first = firstName(onRecord, "the customer");
  const done = (result: string): RunOutput => ({ steps, result, drafts });

  /** Writes an action and, unless the caller is wording it first, routes it by the Owner's permission. */
  const act = async (action: NewAction): Promise<Routed | "drafted"> => {
    const row = await prepareAction(ctx, company, await fresh(), { ...action, runId: input.runId });
    if (action.kind !== "escalation" && action.kind !== "booking_request" && !input.route) {
      drafts.push(row._id);
      step("send_message", "proposed", `Prepared: ${action.summary}`);
      return "drafted";
    }
    const routed = await routeAction(ctx, company, await fresh(), row);
    const words: Record<Routed, string> = {
      sent: `${action.kind === "booking_request" ? "Done" : "Sent"}: ${action.summary}`,
      awaiting_approval: `Prepared and waiting for your approval: ${action.summary}`,
      batched: `Prepared for your first review batch: ${action.summary}`,
      held: `Prepared, not sent, because Sales is paused: ${action.summary}`,
      not_allowed: `Prepared, not sent, because this is switched off for Sales: ${action.summary}`,
      failed: `Could not be done: ${action.summary}`,
      for_person: `Handed to you: ${action.summary}`,
    };
    step(action.kind === "escalation" ? "escalate" : action.kind === "booking_request" ? "request_booking" : "send_message", routed === "sent" ? "done" : routed === "failed" || routed === "not_allowed" ? "refused" : "proposed", words[routed]);
    return routed;
  };
  const escalate = (summary: string, reason: string, evidence: NewAction["evidence"] = []) => act({ kind: "escalation", summary, reason, evidence, permission: REPLY_AND_QUOTE });

  step("read_opportunity", "read", `${name}: ${opportunity.agent.stage.replace(/_/g, " ")}, ${opportunity.agent.facts.filter((fact) => fact.status !== "unverified").length} details on record.`);
  if (opportunity.agent.takeover) return done("A person is handling this conversation, so the agent did nothing.");
  if (opportunity.agent.stage === "won" || opportunity.agent.stage === "closed_lost") return done("The opportunity is closed.");
  if (opportunity.agent.match === "needs_review") return done("This person may already be a customer. A person says whether they are the same before the agent replies.");

  // ── A follow-up that came due: is it still right to send? ───────────────────────────────────────
  const followUp = input.followUpId ? await ctx.db.get(input.followUpId) : null;
  if (input.trigger === "follow_up_due") {
    if (!followUp || followUp.status !== "scheduled") return done("The reminder was already handled.");
    const problem = await dueProblem(ctx, opportunity, followUp);
    if (problem) {
      await ctx.db.patch(followUp._id, { status: "stopped", stopReason: problem, doneAt: Date.now() });
      await recordEvent(ctx, { companyId: company._id, type: "follow_up.stopped", actor: SALES, subject: { table: "salesFollowUps", id: followUp._id }, data: { purpose: followUp.purpose, attempt: followUp.attempt } });
      step("cancel_follow_ups", "done", `Did not send the ${PURPOSE_WORDS[followUp.purpose].toLowerCase()} reminder: ${problem}`);
      return done(`Reminder not sent. ${problem}`);
    }
  }

  // ── What the customer just said ─────────────────────────────────────────────────────────────────
  const reading = input.reading;
  if (reading) {
    const at = Date.now();
    let facts = opportunity.agent.facts;
    const recorded: string[] = [];
    const conflicts: string[] = [];
    for (const fact of asFacts(reading, input.messageRef ?? "", at)) {
      const next = withFact(facts, fact);
      if (next.conflict && !next.changed) conflicts.push(`${FACT_LABELS[fact.key] ?? fact.key}: on record as ${String(next.conflict.value)}, the message says ${String(fact.value)}`);
      if (next.changed) {
        facts = next.facts;
        recorded.push(FACT_LABELS[fact.key] ?? fact.key.replace(/^answer:/, ""));
      }
    }
    if (recorded.length > 0) {
      opportunity = await bump(ctx, opportunity, { facts, ...(factOf(facts, "timing") && !opportunity.timing?.slot ? { timing: { ...opportunity.timing, text: String(factOf(facts, "timing")!.value) } } : {}) });
      step("record_facts", "done", `Recorded from ${first}'s message: ${recorded.join(", ")}.`);
    }
    if (conflicts.length > 0) {
      await escalate(`${name} said something that differs from what is on record.`, "A confirmed detail is not overwritten by a message. A person should say which is right.", conflicts.map((detail) => ({ label: "Differs", detail })));
      return done("A detail in the message conflicts with the record, so it went to a person.");
    }
    const said = input.messageText ? [{ label: `${first} wrote`, detail: input.messageText.slice(0, 280) }] : [];
    const keywords = settings.escalation.keywords;
    if (reading.intent === "complaint" || (input.messageText && keywords.some((word) => input.messageText!.toLowerCase().includes(word)))) {
      await quiet(ctx, opportunity, "The message raised something a person must handle.", SALES);
      await escalate(`${name} raised something only a person should answer.`, "Damage, disputes, refunds, legal matters and the words your Playbook lists always go to a person, whatever the agent is allowed to send.", said);
      return done("Handed to a person. The agent sent nothing.");
    }
    if (reading.intent === "opt_out") {
      await quiet(ctx, opportunity, "The customer asked not to be contacted.", SALES);
      await setStage(ctx, await fresh(), "closed_lost", SALES, { reason: "opted_out", note: "The customer asked not to be contacted." });
      step("close_opportunity", "done", `${first} asked not to be contacted. Closed, and nothing more will be sent.`);
      return done("Closed: the customer asked not to be contacted.");
    }
    if (reading.intent === "decline") {
      await quiet(ctx, opportunity, "The customer declined.", SALES);
      const reason = lostReasonFrom(input.messageText ?? "");
      await setStage(ctx, await fresh(), "closed_lost", SALES, { reason, note: input.messageText?.slice(0, 300) });
      step("close_opportunity", "done", `${first} declined (${reason.replace(/_/g, " ")}). Closed with the reason; no further messages.`);
      return done("Closed: the customer declined.");
    }
    if (reading.intent === "defer" && opportunity.agent.stage !== "booking_pending") {
      await quiet(ctx, opportunity, "The customer asked for more time.", SALES);
      const until = reading.date ? Date.parse(`${reading.date}T15:00:00Z`) : NaN;
      const when = Number.isFinite(until) && until > Date.now() + DAY ? until : Date.now() + 30 * DAY;
      opportunity = await setStage(ctx, await fresh(), "deferred", SALES, { deferredUntil: when, note: input.messageText?.slice(0, 300) });
      const voice = await voiceOf(ctx, company, opportunity);
      const service = opportunity.serviceKey ? (await publishedCatalog(ctx, company._id)).find((row) => row.service.key === opportunity.serviceKey)?.version.spec.name ?? null : null;
      const planned = await planFollowUp(ctx, company, opportunity, { purpose: reading.date ? "requested_date" : "deferred", attempt: 1, reason: reading.date ? `${first} asked to be contacted on this date.` : `${first} asked for more time. One check-in, then it is yours to decide.`, preview: requestedDateMessage(onRecord, voice, { service }), at: when, actor: SALES });
      await setNext(ctx, opportunity, { what: `Check back with ${first} once`, by: "sales", dueAt: planned?.dueAt ?? when });
      step("defer_opportunity", "done", `${first} asked for more time. Deferred, with one check-in planned.`);
      return done("Deferred at the customer's request.");
    }
  }

  // ── The service ─────────────────────────────────────────────────────────────────────────────────
  const catalog = (await publishedCatalog(ctx, company._id)).filter((row) => row.service.status === "active");
  step("read_services", "read", `${plural(catalog.length, "published service")} in Services & Pricing.`);
  if (catalog.length === 0) {
    await escalate("No service is published, so the agent has nothing to quote from.", "The agent quotes only from published services. Publish one in Services & Pricing and the agent picks this up.");
    return done("No published service to quote from.");
  }
  if (!settings.eligibility.kinds.includes(opportunity.agent.kind)) {
    await escalate(`${name} is asking about ${opportunity.agent.kind.replace(/_/g, " ")} work, which your Playbook says the agent does not handle.`, "The Playbook lists the kinds of work the agent takes. This one is outside it.");
    return done("Outside what the agent handles.");
  }
  let service = catalog.find((row) => row.service.key === opportunity.serviceKey) ?? null;
  if (!service) {
    const text = `${opportunity.inquiry ?? ""} ${input.messageText ?? ""}`.toLowerCase();
    const named = catalog.filter((row) => text.includes(row.version.spec.name.toLowerCase()));
    const ofKind = catalog.filter((row) => kindOfService(row.version.spec) === opportunity.agent.kind);
    const chosen = named.length === 1 ? named[0] : ofKind.length === 1 ? ofKind[0] : catalog.length === 1 ? catalog[0] : null;
    if (chosen) {
      const kind = kindOfService(chosen.version.spec);
      opportunity = await bump(ctx, opportunity, { serviceKey: chosen.service.key, kind, segment: SEGMENT_OF_KIND[kind] });
      service = chosen;
      step("read_services", "done", `Matched the request to ${chosen.version.spec.name}.`);
    }
  }
  // Can the agent reach this person at all? No address, no recorded permission, a STOP, or a channel that is not
  // connected each mean a message would be refused, so a person is told now instead of approving one that cannot go.
  if (customer) {
    const reach = await canReach(ctx, company._id, customer, opportunity.agent.channel);
    if (!reach.ok && reach.code !== "quiet_hours" && reach.code !== "agent_paused" && reach.code !== "frequency") {
      const other = opportunity.agent.channel === "sms" ? "email" : "sms";
      const fallback = reach.code === "company_suspended" ? null : await canReach(ctx, company._id, customer, other);
      if (fallback?.ok) {
        opportunity = await bump(ctx, opportunity, { channel: other });
        step("read_opportunity", "done", `${reach.words} The agent will use ${other === "email" ? "email" : "text"} instead, where permission is on record.`);
      } else {
        await escalate(`The agent cannot ${opportunity.agent.channel === "sms" ? "text" : "email"} ${name}.`, `${reach.words} Record how they agreed to be contacted, fix the setup, or reply to them yourself.`, [{ label: opportunity.agent.channel === "sms" ? "Texting" : "Email", detail: reach.words }]);
        return done(`Cannot reach the customer: ${reach.words}`);
      }
    }
  }
  const voice = await voiceOf(ctx, company, opportunity);
  const channel = opportunity.agent.channel;
  // "How much is it?" is the request itself: the agent answers it by getting what the price needs and quoting.
  // Any other question needs an answer the Owner approved.
  const asked = (reading?.questions ?? []).filter((question) => !PRICE_QUESTION.test(question));
  const answer = asked.length > 0 ? approvedAnswer(asked, settings.answers) : null;
  const unanswered = asked.length > 0 && !answer ? asked[0] : null;
  if (unanswered && opportunity.agent.stage !== "booking_pending") {
    await escalate(`${name} asked a question the agent has no approved answer for.`, "The agent answers only from the Playbook's approved answers and the service catalog. Reply yourself, or add an approved answer and hand it back.", [{ label: `${first} asked`, detail: unanswered }]);
    return done("The customer asked something the agent cannot answer from approved information.");
  }
  if (!service) {
    const fitting = catalog.filter((row) => kindOfService(row.version.spec) === opportunity.agent.kind);
    const options = (fitting.length ? fitting : catalog).map((row) => row.version.spec.name);
    await act({ kind: "question", channel, subject: `Your request to ${company.name}`, body: serviceQuestion(onRecord, voice, options), summary: `Ask ${first} which service they want.`, reason: "The request does not say which service, and more than one could fit.", evidence: [{ label: "Request", detail: (opportunity.inquiry ?? "").slice(0, 280) }], nextStep: "Once the service is known, the agent asks only what that service's price needs.", permission: REPLY_AND_QUOTE });
    return done("Asked which service is wanted.");
  }
  const spec = service.version.spec;
  const requirements = requirementsFor(spec, opportunity.agent.kind);

  // ── Deferred, and its date arrived ──────────────────────────────────────────────────────────────
  if (opportunity.agent.stage === "deferred") {
    if (input.trigger !== "follow_up_due" || !followUp) return done("Deferred. The agent waits for the date or the customer.");
    opportunity = await setStage(ctx, opportunity, opportunity.firstResponseAt ? "qualifying" : "new", SALES);
    await act({ kind: "follow_up", channel, subject: `Checking back from ${company.name}`, body: requestedDateMessage(onRecord, voice, { service: spec.name }), followUpId: followUp._id, summary: `Check back with ${first}, as they asked.`, reason: followUp.reason, evidence: [{ label: "Planned", detail: PURPOSE_WORDS[followUp.purpose] }], nextStep: "If there is no answer, the opportunity goes to you. The agent does not keep chasing.", permission: FOLLOW_UP });
    return done("Checked back with the customer on the date they asked for.");
  }

  // ── A booking in progress ───────────────────────────────────────────────────────────────────────
  if (opportunity.agent.stage === "booking_pending") {
    const readiness = await bookingReadiness(ctx, company, opportunity);
    step("check_booking_readiness", "read", readiness.booking ? `The booking is ${readiness.booking.status}${readiness.blockers.length ? `: ${readiness.blockers[0]}` : ""}.` : readiness.ready ? "Everything the booking needs is in place and the time is open." : `Not ready: ${readiness.blockers[0]}`);
    if (readiness.booking) {
      const waiting = readiness.items.filter((item) => item.state === "todo" || item.state === "blocked");
      const mine = waiting.find((item) => item.by === "owner");
      if (readiness.booking.status !== "confirmed") await setNext(ctx, await fresh(), mine ? { what: `The booking for ${first} waits on you: ${mine.detail}`, by: "owner", dueAt: Date.now() + DAY } : { what: `Waiting for ${first} to finish the booking steps`, by: "customer", dueAt: Date.now() + 2 * DAY });
      return done(readiness.booking.status === "confirmed" ? "The booking is confirmed." : `Booking requested: ${readiness.blockers[0] ?? "waiting"}`);
    }
    if (readiness.ready && readiness.slot && readiness.quote) {
      const when = whenWords(readiness.slot, company.timezone);
      await act({
        kind: "booking_request",
        channel,
        subject: `Your booking with ${company.name}`,
        body: bookingHeldMessage(onRecord, voice, { when, depositCents: readiness.quote.depositCents ?? null, agreement: readiness.quote.agreementRequired === true }),
        quoteId: readiness.quote._id,
        summary: `Book ${first} for ${when}.`,
        reason: "The customer accepted the quote, the address and access are on record, and the time is open. Capacity is checked again in the same step that holds it.",
        evidence: readiness.items.filter((item) => item.state === "done").map((item) => ({ label: item.label, detail: item.detail })),
        nextStep: "The booking holds the time. Payment and an agreement, when your Playbook asks for them, come next; then it is confirmed and handed to Dispatch.",
        permission: CONFIRM_BOOKING,
      });
      return done((await fresh()).bookingId ? "The booking was requested." : "The booking is ready and waiting on the next step.");
    }
    const theirs = readiness.items.filter((item) => (item.state === "todo" || item.state === "blocked") && item.by === "customer");
    const mine = readiness.items.filter((item) => (item.state === "todo" || item.state === "blocked") && item.by === "owner");
    const key = `booking:${theirs.map((item) => item.key).join("+")}`;
    const told = opportunity.agent.asked.find((row) => row.key === key);
    if (theirs.length > 0 && (!told || input.trigger === "follow_up_due")) {
      const stepsForCustomer = theirs.map((item) => (item.key === "details" ? "add the service address and how our team gets in." : item.key === "time" ? "choose a time that works for you." : item.detail));
      await ctx.db.patch(opportunity._id, { asked: [...opportunity.agent.asked.filter((row) => row.key !== key), { key, at: Date.now(), times: (told?.times ?? 0) + 1 }].slice(-30) });
      const body = bookingStepsMessage(onRecord, voice, stepsForCustomer);
      const routed = await act({ kind: followUp ? "follow_up" : "booking_steps", channel, subject: `Next steps for your booking with ${company.name}`, body, quoteId: readiness.quote?._id, followUpId: followUp?._id, summary: `Tell ${first} what is still needed before the booking can be requested.`, reason: "The quote is accepted, and the booking cannot be made until these are done.", evidence: theirs.map((item) => ({ label: item.label, detail: item.detail })), nextStep: "The agent requests the booking as soon as these are done and the time is still open.", permission: followUp ? FOLLOW_UP : REPLY_AND_QUOTE });
      if (routed === "sent" && !followUp) {
        const planned = await planFollowUp(ctx, company, await fresh(), { purpose: "missing_info", attempt: 1, reason: `${first} accepted the quote and has not finished the booking details.`, preview: body, quoteId: readiness.quote?._id, actor: SALES });
        if (planned) step("schedule_follow_up", "done", "Planned one reminder about the booking details.");
      }
    }
    if (mine.length > 0) await setNext(ctx, await fresh(), { what: `The booking for ${first} is waiting on you: ${mine[0].detail}`, by: "owner", dueAt: Date.now() + DAY });
    else if (theirs.length > 0) {
      const now = await fresh();
      await setNext(ctx, now, now.agent.next?.by === "owner" ? now.agent.next : { what: `Waiting for ${first} to finish the booking details`, by: "customer", dueAt: Date.now() + 2 * DAY });
    }
    return done(`Booking pending: ${readiness.blockers[0] ?? "waiting"}`);
  }

  // ── A quote is out ──────────────────────────────────────────────────────────────────────────────
  const quote = await currentQuote(ctx, opportunity);
  if (opportunity.agent.stage === "quote_sent" && quote && quote.status === "sent") {
    const validUntil = shortDate(quote.expiresAt, company.timezone);
    if (input.trigger === "follow_up_due" && followUp) {
      await act({ kind: "follow_up", channel, subject: `Your quote from ${company.name}`, body: quoteReminder(onRecord, voice, { service: quoteService(quote), totalCents: quoteTotal(quote), validUntil }), quoteId: quote._id, followUpId: followUp._id, summary: `Remind ${first} about the quote (reminder ${followUp.attempt} of ${followUp.maxAttempts}).`, reason: followUp.reason, evidence: [{ label: "Quote", detail: `${formatCents(quoteTotal(quote))}, open until ${validUntil}` }], nextStep: followUp.attempt >= followUp.maxAttempts ? "This is the last reminder. After it, the opportunity comes to you." : "One more reminder is planned if there is no answer.", permission: FOLLOW_UP });
      return done("Sent a quote reminder.");
    }
    if (reading) {
      // New details after a quote went out can change its price. The engine is asked again; a different price is a new quote.
      const priced = await priceOpportunity(ctx, company, opportunity);
      if (priced.kind === "priced" && priced.pricing.firstCents !== quoteTotal(quote) && reading.facts.length > 0) {
        step("calculate_quote", "done", `The new details change the price from ${formatCents(quoteTotal(quote))} to ${formatCents(priced.pricing.firstCents)}.`);
        opportunity = await setStage(ctx, opportunity, "quote_ready", SALES);
        return quoteFrom(priced, true);
      }
      if (reading.intent === "accept") {
        await act({ kind: "reply", channel, subject: `Your quote from ${company.name}`, body: acceptOnPageMessage(onRecord, voice), quoteId: quote._id, summary: `Point ${first} to the quote page to accept.`, reason: "A yes by message does not say which quote was accepted. The quote page records the exact price and scope.", evidence: input.messageText ? [{ label: `${first} wrote`, detail: input.messageText.slice(0, 280) }] : [], nextStep: "When they accept on the page, the agent starts the booking.", permission: REPLY_AND_QUOTE });
        return done("Pointed the customer to the quote page to accept.");
      }
      if (answer) {
        await act({ kind: "reply", channel, subject: `Your quote from ${company.name}`, body: answerMessage(onRecord, voice, answer.answer, "Your quote is here whenever you're ready: {link}"), quoteId: quote._id, summary: `Answer ${first}'s question from an approved answer.`, reason: "The Playbook has an approved answer for what they asked.", evidence: [{ label: `${first} asked`, detail: answer.question }, { label: "Approved answer", detail: answer.answer.slice(0, 280) }], nextStep: "The quote stays open for them to accept.", permission: REPLY_AND_QUOTE });
        return done("Answered from an approved answer.");
      }
      await escalate(`${name} replied about the quote and the agent has nothing approved to say back.`, "The message is not an acceptance, a decline or a question with an approved answer.", input.messageText ? [{ label: `${first} wrote`, detail: input.messageText.slice(0, 280) }] : []);
      return done("The reply needs a person.");
    }
    return done("The quote is with the customer.");
  }

  // ── A quote waiting for a person, or approved and not yet sent ──────────────────────────────────
  if (opportunity.agent.stage === "quote_ready" && quote && (quote.status === "awaiting_approval" || quote.status === "saved") && !reading) {
    if (quote.approval?.state === "waiting") return done("The quote is waiting for your review.");
    if (quote.approval?.state === "approved") return sendQuote(quote, false);
  }

  // ── Qualifying, then quoting ────────────────────────────────────────────────────────────────────
  const facts = opportunity.agent.facts;
  const postal = factOf(facts, "postalCode");
  const areas = businessSettingsOf(company).serviceAreas;
  if (postal && known(facts, "postalCode") && areas.length > 0 && !areas.includes(normalizePostalCode(String(postal.value)))) {
    await escalate(`${name} is in ${String(postal.value)}, outside your service areas.`, "The agent does not promise work where the company has said it does not go. Decline, or add the area under Business & hours and hand it back.", [{ label: "Postal code", detail: String(postal.value) }]);
    return done("Outside the service area.");
  }
  const missing = missingFor(requirements, facts, "quote");
  if (missing.length > 0) {
    const ask = missing.slice(0, 2);
    const now = Date.now();
    const repeats = ask.map((row) => opportunity.agent.asked.find((row2) => row2.key === row.key)?.times ?? 0);
    // Asked twice and still unanswered: a third ask is a person's call, not the agent's.
    if (input.trigger !== "follow_up_due" && repeats.every((times) => times >= 2)) {
      await escalate(`${name} has been asked twice for ${ask.map((row) => row.label.toLowerCase()).join(" and ")} and has not answered.`, "The agent does not keep repeating a question. Ask another way, call them, or close it.", ask.map((row) => ({ label: "Still missing", detail: row.label })));
      return done("Still missing details after two asks; handed to a person.");
    }
    const body = followUp ? missingInfoReminder(onRecord, voice, { service: spec.name, ask }) : questionMessage(onRecord, voice, { service: spec.name, ask, answered: answer ? answer.answer : null });
    await ctx.db.patch(opportunity._id, { asked: [...opportunity.agent.asked.filter((row) => !ask.some((item) => item.key === row.key)), ...ask.map((row, index) => ({ key: row.key, at: now, times: repeats[index] + 1 }))].slice(-30) });
    const have = requirements.filter((row) => row.phase === "quote" && known(facts, row.key));
    if (opportunity.agent.stage === "new" && input.route === false) opportunity = await setStage(ctx, await fresh(), "qualifying", SALES);
    await act({
      kind: followUp ? "follow_up" : "question",
      channel,
      subject: `Your ${spec.name} request with ${company.name}`,
      body,
      followUpId: followUp?._id,
      summary: followUp ? `Remind ${first} about the details still needed (reminder ${followUp.attempt} of ${followUp.maxAttempts}).` : `Ask ${first} for ${ask.map((row) => row.label.toLowerCase()).join(" and ")}.`,
      reason: `${spec.name} is priced from ${requirements.filter((row) => row.phase === "quote" && row.why === "price").map((row) => row.label.toLowerCase()).join(", ") || "its published rate"}. ${plural(missing.length, "detail")} ${missing.length === 1 ? "is" : "are"} still missing.`,
      evidence: [...have.slice(0, 4).map((row) => ({ label: row.label, detail: factWords(factOf(facts, row.key)!, requirements) })), ...missing.slice(0, 3).map((row) => ({ label: "Missing", detail: row.label }))],
      nextStep: missing.length > 2 ? `${plural(missing.length - 2, "more question")} after this, then the quote.` : "With these answered, the agent prepares the quote.",
      permission: followUp ? FOLLOW_UP : REPLY_AND_QUOTE,
    });
    if ((await fresh()).agent.stage === "new") await setStage(ctx, await fresh(), "qualifying", SALES);
    return done(`Asked for ${ask.map((row) => row.label.toLowerCase()).join(" and ")}.`);
  }
  if (input.trigger === "follow_up_due" && followUp) {
    await ctx.db.patch(followUp._id, { status: "stopped", stopReason: "The missing details arrived.", doneAt: Date.now() });
  }
  const priced = await priceOpportunity(ctx, company, opportunity);
  return quoteFrom(priced, false);

  async function quoteFrom(result: Priced, revised: boolean): Promise<RunOutput> {
    if (result.kind === "no_service") {
      await escalate(`The service ${first} asked about is no longer published.`, "The agent quotes only from a published, active service.");
      return done("The service is not available to quote.");
    }
    if (result.kind === "incomplete") {
      await escalate(`The price for ${first} still needs: ${result.missing.join(", ")}.`, "The pricing rules ask for something the agent has no question for. Add it to the service's quoting questions, or price this one yourself in the workspace.", result.missing.map((detail) => ({ label: "Needed", detail })));
      return done("The pricing rules need more than the agent can ask for.");
    }
    if (result.kind === "walkthrough") {
      step("calculate_quote", "refused", `The service's rules say this needs a walkthrough or a custom quote: ${result.reasons[0]}`);
      await escalate(`${name}'s request needs a custom quote or a walkthrough.`, `${result.serviceName}'s own pricing rules say a firm price cannot be given from answers alone. The agent does not estimate around them. Prepare a proposal or schedule a walkthrough from the workspace.`, result.reasons.slice(0, 4).map((detail) => ({ label: "Why", detail })));
      return done("Needs a custom quote or a walkthrough.");
    }
    step("calculate_quote", "done", `${result.serviceName}: ${formatCents(result.pricing.firstCents)}${result.pricing.ongoingCents !== null ? ` first visit, then ${formatCents(result.pricing.ongoingCents)} per visit` : ` per ${result.pricing.visit.quote.per}`}${result.outcome === "estimate" ? " (an estimate)" : ""}.`);
    const saved = await saveAgentQuote(ctx, company, await fresh(), result, SALES);
    step("prepare_quote", saved.created ? "done" : "read", saved.created ? `Saved a quote at ${formatCents(quoteTotal(saved.quote))}.` : `The quote at ${formatCents(quoteTotal(saved.quote))} already matches.`);
    opportunity = await fresh();
    if (opportunity.agent.stage !== "quote_ready") opportunity = await setStage(ctx, opportunity, "quote_ready", SALES);
    let current = (await ctx.db.get(saved.quote._id))!;
    if (current.approval?.state !== "approved") {
      const why = reviewReason(company, opportunity, current);
      if (why) {
        const approval = current.approval?.approvalId ? await ctx.db.get(current.approval.approvalId) : null;
        if (!approval || approval.status !== "pending") {
          const approvalId = await requestApproval(ctx, {
            companyId: company._id,
            action: REPLY_AND_QUOTE,
            summary: `Review ${name}'s quote before it goes out: ${formatCents(quoteTotal(current))} for ${quoteService(current)}.`,
            reason: `${why} The price is from ${quoteService(current)} as published, and the details on the opportunity.`,
            authorizes: `This quote at ${formatCents(quoteTotal(current))} may be sent to ${name}. The agent then sends it under its own permission for replies and quotes.`,
            ifWaiting: "The quote is not sent. The customer keeps waiting.",
            proposal: { kind: "sales_quote", quoteId: current._id, totalCents: quoteTotal(current) },
            decideBy: Date.now() + DAY,
            about: { table: "salesOpportunities", id: opportunity._id },
            ...(opportunity.taskId ? { taskId: opportunity.taskId } : {}),
          });
          await ctx.db.patch(current._id, { status: "awaiting_approval", approval: { state: "waiting", approvalId } });
        }
        await setNext(ctx, opportunity, { what: `Review ${first}'s quote (${formatCents(quoteTotal(current))}): ${why}`, by: "owner", dueAt: Date.now() + DAY });
        step("request_approval", "proposed", `The quote needs your review before it goes out: ${why}`);
        return done("The quote is ready and needs your review.");
      }
      await ctx.db.patch(current._id, { approval: { state: "approved", by: "rules" } });
      current = (await ctx.db.get(current._id))!;
      step("prepare_quote", "done", "A firm price from the published rules, so it needs no review.");
    }
    return sendQuote(current, revised);
  }

  async function sendQuote(current: Doc<"salesQuotes">, revised: boolean): Promise<RunOutput> {
    const validUntil = shortDate(Date.now() + settings.quotes.validDays * DAY, company.timezone);
    const snapshot = (current.snapshot ?? {}) as { cadence?: string | null; outcome?: string };
    const ongoing = current.kind === "recurring" && snapshot.cadence ? { cents: current.visit.totalCents, cadence: snapshot.cadence } : null;
    const body = quoteMessage(onRecord, await voiceOf(ctx, company, await fresh()), { service: quoteService(current), totalCents: quoteTotal(current), per: quotePer(current), estimate: (snapshot.outcome ?? current.visit.outcome) === "estimate", validUntil, depositCents: current.depositCents, ongoing });
    await act({
      kind: "send_quote",
      channel,
      subject: `${revised ? "Your updated quote" : "Your quote"} from ${company.name}`,
      body: revised ? body.replace("Your quote for", "Your updated quote for") : body,
      quoteId: current._id,
      summary: `Send ${first} ${revised ? "the updated" : "the"} quote: ${formatCents(quoteTotal(current))} for ${quoteService(current)}.`,
      reason: `Everything ${quoteService(current)}'s price needs is on record, and the pricing engine gave ${formatCents(quoteTotal(current))}.`,
      evidence: [{ label: "Service", detail: quoteService(current) }, ...requirements.filter((row) => row.phase === "quote" && known(opportunity.agent.facts, row.key)).slice(0, 5).map((row) => ({ label: row.label, detail: factWords(factOf(opportunity.agent.facts, row.key)!, requirements) })), { label: "Valid", detail: `${settings.quotes.validDays} days, until ${validUntil}` }],
      nextStep: "The customer reviews it on a secure page, chooses a time and accepts, declines or asks a question. Follow-ups are planned if they do not answer.",
      permission: REPLY_AND_QUOTE,
    });
    return done(`Prepared a quote at ${formatCents(quoteTotal(current))}.`);
  }
}

/** Whether an opportunity has anything for the agent to do, for sweeps that pick up work after a pause or a missed trigger. */
export function wantsWork(opportunity: Opp, now: number): boolean {
  if (!opportunity.intake || !isOpen(opportunity.agent.stage) || opportunity.agent.takeover || opportunity.agent.match === "needs_review") return false;
  const next = opportunity.agent.next;
  if (!next) return true;
  return next.by === "sales" && next.dueAt <= now;
}
