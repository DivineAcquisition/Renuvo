/**
 * What Sales does next for one opportunity, as checked steps.
 *
 * A run reads the opportunity and the conversation, takes what the reader found in the customer's
 * latest message (already checked against that message), and then works through a small set of tools.
 * Each tool reads the record again and applies the rules in code: what a service needs is the
 * service's, a price is the engine's, capacity is Dispatch's rules, a permission is the Owner's. A model
 * never chooses the tool, the price, the time or the recipient; where one is connected it reads a
 * message and words a reply, and both are checked before they are used.
 *
 * Every step is recorded in words an owner can read. A step that could not happen says why.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { recordEvent } from "../events";
import { publishedCatalog } from "../services/store";
import { formatCents } from "../services/words";
import { businessSettingsOf, normalizePostalCode } from "../settings/business";
import { CONFIRM_BOOKING, FOLLOW_UP, prepareAction, quiet, REPLY_AND_QUOTE, routeAction, voiceOf, type NewAction, type Routed } from "./actions";
import { bookingReadiness, whenWords } from "./booking";
import { factOf, FACT_LABELS, factWords, kindOfService, known, missingFor, requirementsFor, withFact } from "./facts";
import { dueProblem, planFollowUp, PURPOSE_WORDS } from "./followUps";
import { asFacts, lostReasonFrom } from "./interpret";
import { canReach } from "./outbox";
import { bump, currentQuote, isOpen, SALES, setNext, setStage } from "./opportunities";
import { approveVersion, priceOpportunity, reviewReason, saveQuoteVersion, versionOf } from "./quotes";
import type { Reading, RunStep, Trigger } from "./schema";
import { salesSettings } from "./settings";
import { acceptOnPageMessage, answerMessage, bookingStepsMessage, missingInfoReminder, plural, questionMessage, quoteMessage, quoteReminder, requestedDateMessage, serviceQuestion } from "./words";
import { requestApproval } from "../approvalQueue";

export const TOOLS = ["read_opportunity", "read_services", "record_facts", "ask_customer", "answer_question", "calculate_quote", "prepare_quote", "request_approval", "send_message", "schedule_follow_up", "cancel_follow_ups", "check_booking_readiness", "create_booking", "escalate", "close_opportunity", "defer_opportunity"] as const;
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

/** Questions Sales answers by doing its job: what it costs, and whether the company takes this kind of work. */
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

export async function advance(ctx: MutationCtx, company: Doc<"companies">, opportunityId: Id<"salesOpportunities">, input: RunInput): Promise<RunOutput> {
  const steps: RunStep[] = [];
  const drafts: Id<"salesActions">[] = [];
  const settings = salesSettings(company);
  const step = (tool: Tool, outcome: RunStep["outcome"], summary: string) => {
    if (steps.length < MAX_STEPS) steps.push({ tool, outcome, summary: summary.slice(0, 400), at: Date.now() });
  };
  const fresh = async () => (await ctx.db.get(opportunityId))!;
  let opportunity = await fresh();
  const customer = await ctx.db.get(opportunity.customerId);
  const onRecord = customer?.name ?? "";
  const name = firstName(onRecord, "") ? onRecord : "This prospect";
  const first = firstName(onRecord, "the customer");
  const done = (result: string): RunOutput => ({ steps, result, drafts });

  /** Writes an action and, unless the caller is wording it first, routes it by the Owner's permission. */
  const act = async (action: NewAction): Promise<Routed | "drafted"> => {
    const row = await prepareAction(ctx, company, await fresh(), { ...action, runId: input.runId });
    if (action.kind !== "escalation" && !input.route) {
      drafts.push(row._id);
      step("send_message", "proposed", `Prepared: ${action.summary}`);
      return "drafted";
    }
    const routed = await routeAction(ctx, company, await fresh(), row);
    const words: Record<Routed, string> = {
      sent: `Sent: ${action.summary}`,
      awaiting_approval: `Prepared and waiting for your approval: ${action.summary}`,
      batched: `Prepared for your first review batch: ${action.summary}`,
      held: `Prepared, not sent, because Sales is paused: ${action.summary}`,
      not_allowed: `Prepared, not sent, because this is switched off for Sales: ${action.summary}`,
      failed: `Could not be sent: ${action.summary}`,
      for_person: `Handed to you: ${action.summary}`,
    };
    step(action.kind === "escalation" ? "escalate" : "send_message", routed === "sent" ? "done" : routed === "failed" || routed === "not_allowed" ? "refused" : "proposed", words[routed]);
    return routed;
  };
  const escalate = (summary: string, reason: string, evidence: NewAction["evidence"] = []) => act({ kind: "escalation", summary, reason, evidence, permission: REPLY_AND_QUOTE });

  step("read_opportunity", "read", `${name}: ${opportunity.stage.replace(/_/g, " ")}, ${opportunity.facts.filter((fact) => fact.status !== "unverified").length} details on record.`);
  if (opportunity.takeover) return done("A person is handling this conversation, so Sales did nothing.");
  if (opportunity.stage === "won" || opportunity.stage === "closed_lost") return done("The opportunity is closed.");

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
    let facts = opportunity.facts;
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
    if (reading.intent === "complaint") {
      await quiet(ctx, opportunity, "The message raised something a person must handle.", SALES);
      await escalate(`${name} raised something only a person should answer.`, "Damage, disputes, refunds and legal matters always go to a person, whatever Sales is allowed to send.", said);
      return done("Handed to a person. Sales sent nothing.");
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
    if (reading.intent === "defer") {
      await quiet(ctx, opportunity, "The customer asked for more time.", SALES);
      const until = reading.date ? Date.parse(`${reading.date}T15:00:00Z`) : NaN;
      const at = Number.isFinite(until) && until > Date.now() + DAY ? until : Date.now() + 30 * DAY;
      opportunity = await setStage(ctx, await fresh(), "deferred", SALES, { deferredUntil: at, note: input.messageText?.slice(0, 300) });
      const voice = await voiceOf(ctx, company, opportunity);
      const planned = await planFollowUp(ctx, company, opportunity, { purpose: reading.date ? "requested_date" : "deferred", attempt: 1, reason: reading.date ? `${first} asked to be contacted on this date.` : `${first} asked for more time. One check-in, then it is yours to decide.`, preview: requestedDateMessage(onRecord, voice, { service: opportunity.serviceKey ? ((await currentService())?.version.spec.name ?? null) : null }), at, actor: SALES });
      await setNext(ctx, opportunity, { what: `Check back with ${first} once`, by: "sales", dueAt: planned?.dueAt ?? at });
      step("defer_opportunity", "done", `${first} asked for more time. Deferred, with one check-in planned.`);
      return done("Deferred at the customer's request.");
    }
  }

  // ── The service ─────────────────────────────────────────────────────────────────────────────────
  async function currentService() {
    const catalog = await publishedCatalog(ctx, company._id);
    return catalog.find((row) => row.service.key === (opportunity.serviceKey ?? "")) ?? null;
  }
  const catalog = await publishedCatalog(ctx, company._id);
  step("read_services", "read", `${plural(catalog.length, "published service")} in Services & Pricing.`);
  if (catalog.length === 0) {
    await escalate("No service is published, so Sales has nothing to quote from.", "Sales quotes only from published services. Publish one in Services & Pricing and Sales picks this up.");
    return done("No published service to quote from.");
  }
  if (!settings.eligibility.kinds.includes(opportunity.kind)) {
    await escalate(`${name} is asking about ${opportunity.kind.replace(/_/g, " ")} work, which your Playbook says Sales does not handle.`, "The Playbook lists the kinds of work Sales takes. This one is outside it.");
    return done("Outside what Sales handles.");
  }
  let service = catalog.find((row) => row.service.key === opportunity.serviceKey) ?? null;
  if (!service) {
    const text = `${opportunity.inquiry} ${input.messageText ?? ""}`.toLowerCase();
    const named = catalog.filter((row) => text.includes(row.version.spec.name.toLowerCase()));
    const ofKind = catalog.filter((row) => kindOfService(row.version.spec) === opportunity.kind);
    const chosen = named.length === 1 ? named[0] : ofKind.length === 1 ? ofKind[0] : catalog.length === 1 ? catalog[0] : null;
    if (chosen) {
      opportunity = await bump(ctx, opportunity, { serviceKey: chosen.service.key, kind: kindOfService(chosen.version.spec) });
      service = chosen;
      step("read_services", "done", `Matched the request to ${chosen.version.spec.name}.`);
    }
  }
  // Can Sales reach this person at all? No address, no recorded permission, a STOP, or a channel that is not
  // connected each mean a message would be refused, so a person is told now instead of approving one that cannot go.
  if (customer) {
    const reach = await canReach(ctx, company._id, customer, opportunity.channel);
    if (!reach.ok && reach.code !== "quiet_hours" && reach.code !== "agent_paused" && reach.code !== "frequency") {
      const other = opportunity.channel === "sms" ? "email" : "sms";
      const fallback = reach.code === "company_suspended" ? null : await canReach(ctx, company._id, customer, other);
      if (fallback?.ok) {
        opportunity = await bump(ctx, opportunity, { channel: other });
        step("read_opportunity", "done", `${reach.words} Sales will use ${other === "email" ? "email" : "text"} instead, where permission is on record.`);
      } else {
        await escalate(`Sales cannot ${opportunity.channel === "sms" ? "text" : "email"} ${name}.`, `${reach.words} Record how they agreed to be contacted, fix the setup, or reply to them yourself.`, [{ label: opportunity.channel === "sms" ? "Texting" : "Email", detail: reach.words }]);
        return done(`Cannot reach the customer: ${reach.words}`);
      }
    }
  }
  const voice = await voiceOf(ctx, company, opportunity);
  const channel = opportunity.channel;
  // "How much is it?" is the request itself: Sales answers it by getting what the price needs and quoting. Any other
  // question needs an answer the Owner approved.
  const asked = (reading?.questions ?? []).filter((question) => !PRICE_QUESTION.test(question));
  const answer = asked.length > 0 ? approvedAnswer(asked, settings.answers) : null;
  const unanswered = asked.length > 0 && !answer ? asked[0] : null;
  // The customer's own question comes first. With no approved answer for it, a person answers; Sales does not talk past it.
  if (unanswered && opportunity.stage !== "booking_pending") {
    await escalate(`${name} asked a question Sales has no approved answer for.`, "Sales answers only from the Playbook's approved answers and the service catalog. Reply yourself, or add an approved answer and hand it back.", [{ label: `${first} asked`, detail: unanswered }]);
    return done("The customer asked something Sales cannot answer from approved information.");
  }
  if (!service) {
    const options = (catalog.filter((row) => kindOfService(row.version.spec) === opportunity.kind).length ? catalog.filter((row) => kindOfService(row.version.spec) === opportunity.kind) : catalog).map((row) => row.version.spec.name);
    await act({ kind: "question", channel, subject: `Your request to ${company.name}`, body: serviceQuestion(onRecord, voice, options), summary: `Ask ${first} which service they want.`, reason: "The request does not say which service, and more than one could fit.", evidence: [{ label: "Request", detail: opportunity.inquiry.slice(0, 280) }], nextStep: "Once the service is known, Sales asks only what that service's price needs.", permission: REPLY_AND_QUOTE });
    return done("Asked which service is wanted.");
  }
  const spec = service.version.spec;
  const requirements = requirementsFor(spec, opportunity.kind);

  // ── Deferred, and its date arrived ──────────────────────────────────────────────────────────────
  if (opportunity.stage === "deferred") {
    if (input.trigger !== "follow_up_due" || !followUp) return done("Deferred. Sales waits for the date or the customer.");
    opportunity = await setStage(ctx, opportunity, opportunity.firstResponseAt ? "qualifying" : "new", SALES);
    await act({ kind: "follow_up", channel, subject: `Checking back from ${company.name}`, body: requestedDateMessage(onRecord, voice, { service: spec.name }), followUpId: followUp._id, summary: `Check back with ${first}, as they asked.`, reason: followUp.reason, evidence: [{ label: "Planned", detail: PURPOSE_WORDS[followUp.purpose] }], nextStep: "If there is no answer, the opportunity goes to you. Sales does not keep chasing.", permission: FOLLOW_UP });
    return done("Checked back with the customer on the date they asked for.");
  }

  // ── A booking in progress ───────────────────────────────────────────────────────────────────────
  if (opportunity.stage === "booking_pending") {
    const readiness = await bookingReadiness(ctx, company, opportunity);
    step("check_booking_readiness", "read", readiness.ready ? "Every booking requirement is met and the time is open." : `Not ready: ${readiness.blockers[0]}`);
    if (readiness.ready && readiness.facts.slot && readiness.facts.version) {
      const when = whenWords(readiness.facts.slot, company.timezone);
      await act({
        kind: "booking_confirmation",
        channel,
        subject: `Your booking with ${company.name}`,
        body: "",
        quote: { quoteId: readiness.facts.quote!._id, version: readiness.facts.version.version },
        summary: `Confirm ${first}'s booking for ${when}.`,
        reason: "Every booking requirement is met and the time is open. Capacity is checked once more in the same step that makes the job.",
        evidence: readiness.items.filter((item) => item.state === "done").map((item) => ({ label: item.label, detail: item.detail })),
        nextStep: "The job goes to Dispatch, which arranges the cleaning team. The customer is told they are booked, not that a cleaner is confirmed.",
        permission: CONFIRM_BOOKING,
      });
      return done((await fresh()).jobId ? "Booked and handed to Dispatch." : "The booking is ready and waiting on the next step.");
    }
    const mine = readiness.items.filter((item) => (item.state === "todo" || item.state === "blocked") && item.by === "owner");
    const theirs = readiness.items.filter((item) => (item.state === "todo" || item.state === "blocked") && item.by === "customer");
    const key = `booking:${theirs.map((item) => item.key).join("+")}`;
    const told = opportunity.asked.find((row) => row.key === key);
    if (theirs.length > 0 && (!told || input.trigger === "follow_up_due")) {
      const stepsForCustomer = theirs.map((item) => (item.key === "details" ? "we need the service address and how our team gets in." : item.key === "time" ? "please choose a time that works; you can do that on your quote page." : item.key === "agreement" ? "please sign the service agreement we sent." : item.key === "deposit" ? `the ${readiness.facts.version?.depositCents ? formatCents(readiness.facts.version.depositCents) : ""} deposit is due. It is paid on a secure page; the link comes with your invoice.`.replace("  ", " ") : item.detail));
      await ctx.db.patch(opportunity._id, { asked: [...opportunity.asked.filter((row) => row.key !== key), { key, at: Date.now(), times: (told?.times ?? 0) + 1 }].slice(-30) });
      const purpose = theirs.some((item) => item.key === "deposit") ? "deposit" : theirs.some((item) => item.key === "agreement") ? "agreement" : "missing_info";
      const body = bookingStepsMessage(onRecord, voice, stepsForCustomer);
      const routed = await act({ kind: followUp ? "follow_up" : "booking_steps", channel, subject: `Next steps for your booking with ${company.name}`, body, followUpId: followUp?._id, summary: `Tell ${first} what is still needed before the booking can be confirmed.`, reason: "The quote is accepted, and the booking is not confirmed until these are done.", evidence: theirs.map((item) => ({ label: item.label, detail: item.detail })), nextStep: "Sales confirms the booking as soon as these are done and the time is still open.", permission: followUp ? FOLLOW_UP : REPLY_AND_QUOTE });
      if (routed === "sent" && !followUp) {
        const planned = await planFollowUp(ctx, company, await fresh(), { purpose, attempt: 1, reason: `${first} accepted the quote and has not finished the booking steps.`, preview: body, quoteVersion: readiness.facts.version?.version, actor: SALES });
        if (planned) step("schedule_follow_up", "done", `Planned one reminder about the booking steps.`);
      }
    }
    if (mine.length > 0) await setNext(ctx, await fresh(), { what: `Booking for ${first} is waiting on you: ${mine[0].detail}`, by: "owner", dueAt: Date.now() + DAY });
    else if (theirs.length > 0) await setNext(ctx, await fresh(), (await fresh()).nextAction?.by === "owner" ? (await fresh()).nextAction! : { what: `Waiting for ${first} to finish the booking steps`, by: "customer", dueAt: Date.now() + 2 * DAY });
    return done(`Booking pending: ${readiness.blockers[0] ?? "waiting"}`);
  }

  // ── A quote is out ──────────────────────────────────────────────────────────────────────────────
  const quote = await currentQuote(ctx, opportunity);
  if (opportunity.stage === "quote_sent" && quote && quote.status === "sent") {
    const sent = await versionOf(ctx, quote, quote.sentVersion ?? quote.currentVersion);
    const validUntil = new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, month: "short", day: "numeric" }).format(new Date(quote.validUntil ?? Date.now()));
    if (input.trigger === "follow_up_due" && followUp && sent) {
      await act({ kind: "follow_up", channel, subject: `Your quote from ${company.name}`, body: quoteReminder(onRecord, voice, { service: sent.serviceName, totalCents: sent.totalCents, validUntil }), quote: { quoteId: quote._id, version: sent.version }, followUpId: followUp._id, summary: `Remind ${first} about the quote (reminder ${followUp.attempt} of ${followUp.maxAttempts}).`, reason: followUp.reason, evidence: [{ label: "Quote", detail: `Q-${quote.number} v${sent.version}, ${formatCents(sent.totalCents)}, open until ${validUntil}` }], nextStep: followUp.attempt >= followUp.maxAttempts ? "This is the last reminder. After it, the opportunity comes to you." : "One more reminder is planned if there is no answer.", permission: FOLLOW_UP });
      return done("Sent a quote reminder.");
    }
    if (reading) {
      // New details after a quote went out can change its price. The engine is asked again; a different price is a new version.
      const priced = await priceOpportunity(ctx, company, opportunity);
      if (priced.kind === "priced" && sent && (priced.result.totalCents !== sent.priceCents || priced.version._id !== sent.serviceVersionId) && reading.facts.length > 0) {
        step("calculate_quote", "done", `The new details change the price from ${formatCents(sent.priceCents)} to ${formatCents(priced.result.totalCents)}.`);
        opportunity = await setStage(ctx, opportunity, "quote_ready", SALES);
        return quoteFrom(priced, true);
      }
      if (reading.intent === "accept") {
        await act({ kind: "reply", channel, subject: `Your quote from ${company.name}`, body: acceptOnPageMessage(onRecord, voice), quote: sent ? { quoteId: quote._id, version: sent.version } : undefined, summary: `Point ${first} to the quote page to accept.`, reason: "A yes by message does not say which version was accepted. The quote page records the exact price and scope.", evidence: input.messageText ? [{ label: `${first} wrote`, detail: input.messageText.slice(0, 280) }] : [], nextStep: "When they accept on the page, Sales starts the booking steps.", permission: REPLY_AND_QUOTE });
        return done("Pointed the customer to the quote page to accept.");
      }
      if (answer) {
        await act({ kind: "reply", channel, subject: `Your quote from ${company.name}`, body: answerMessage(onRecord, voice, answer.answer, "Your quote is here whenever you're ready: {link}"), quote: sent ? { quoteId: quote._id, version: sent.version } : undefined, summary: `Answer ${first}'s question from an approved answer.`, reason: "The Playbook has an approved answer for what they asked.", evidence: [{ label: `${first} asked`, detail: answer.question }, { label: "Approved answer", detail: answer.answer.slice(0, 280) }], nextStep: "The quote stays open for them to accept.", permission: REPLY_AND_QUOTE });
        return done("Answered from an approved answer.");
      }
      await escalate(`${name} replied about the quote and Sales has nothing approved to say back.`, "The message is not an acceptance, a decline or a question with an approved answer.", input.messageText ? [{ label: `${first} wrote`, detail: input.messageText.slice(0, 280) }] : []);
      return done("The reply needs a person.");
    }
    return done("The quote is with the customer.");
  }

  // ── Qualifying, then quoting ────────────────────────────────────────────────────────────────────
  const postal = factOf(opportunity.facts, "postalCode");
  const areas = businessSettingsOf(company).serviceAreas;
  if (postal && known(opportunity.facts, "postalCode") && areas.length > 0 && !areas.includes(normalizePostalCode(String(postal.value)))) {
    await escalate(`${name} is in ${String(postal.value)}, outside your service areas.`, "Sales does not promise work where the company has said it does not go. Decline, or add the area under Business & hours and hand it back.", [{ label: "Postal code", detail: String(postal.value) }]);
    return done("Outside the service area.");
  }
  const missing = missingFor(requirements, opportunity.facts, "quote");
  if (missing.length > 0) {
    const ask = missing.slice(0, 2);
    const now = Date.now();
    const repeats = ask.map((row) => opportunity.asked.find((asked) => asked.key === row.key)?.times ?? 0);
    // Asked twice and still unanswered: a third ask is a person's call, not Sales's.
    if (input.trigger !== "follow_up_due" && repeats.every((times) => times >= 2)) {
      await escalate(`${name} has been asked twice for ${ask.map((row) => row.label.toLowerCase()).join(" and ")} and has not answered.`, "Sales does not keep repeating a question. Ask another way, call them, or close it.", ask.map((row) => ({ label: "Still missing", detail: row.label })));
      return done("Still missing details after two asks; handed to a person.");
    }
    const answered = answer ? answer.answer : null;
    const body = followUp ? missingInfoReminder(onRecord, voice, { service: spec.name, ask }) : questionMessage(onRecord, voice, { service: spec.name, ask, answered });
    await ctx.db.patch(opportunity._id, { asked: [...opportunity.asked.filter((row) => !ask.some((item) => item.key === row.key)), ...ask.map((row, index) => ({ key: row.key, at: now, times: repeats[index] + 1 }))].slice(-30) });
    const have = requirements.filter((row) => row.phase === "quote" && known(opportunity.facts, row.key));
    if (opportunity.stage === "new" && input.route === false) opportunity = await setStage(ctx, await fresh(), "qualifying", SALES);
    await act({
      kind: followUp ? "follow_up" : "question",
      channel,
      subject: `Your ${spec.name} request with ${company.name}`,
      body,
      followUpId: followUp?._id,
      summary: followUp ? `Remind ${first} about the details still needed (reminder ${followUp.attempt} of ${followUp.maxAttempts}).` : `Ask ${first} for ${ask.map((row) => row.label.toLowerCase()).join(" and ")}.`,
      reason: `${spec.name} is priced from ${requirements.filter((row) => row.phase === "quote" && row.why === "price").map((row) => row.label.toLowerCase()).join(", ") || "its published rate"}. ${plural(missing.length, "detail")} ${missing.length === 1 ? "is" : "are"} still missing.`,
      evidence: [...have.slice(0, 4).map((row) => ({ label: row.label, detail: factWords(factOf(opportunity.facts, row.key)!, requirements) })), ...missing.slice(0, 3).map((row) => ({ label: "Missing", detail: row.label }))],
      nextStep: missing.length > 2 ? `${plural(missing.length - 2, "more question")} after this, then the quote.` : "With these answered, Sales prepares the quote.",
      permission: followUp ? FOLLOW_UP : REPLY_AND_QUOTE,
    });
    if ((await fresh()).stage === "new") await setStage(ctx, await fresh(), "qualifying", SALES);
    return done(`Asked for ${ask.map((row) => row.label.toLowerCase()).join(" and ")}.`);
  }
  if (input.trigger === "follow_up_due" && followUp) {
    await ctx.db.patch(followUp._id, { status: "stopped", stopReason: "The missing details arrived.", doneAt: Date.now() });
  }
  const priced = await priceOpportunity(ctx, company, opportunity);
  return quoteFrom(priced, false);

  async function quoteFrom(priced: Awaited<ReturnType<typeof priceOpportunity>>, revised: boolean): Promise<RunOutput> {
    if (priced.kind === "no_service") {
      await escalate(`The service ${first} asked about is no longer published.`, "Sales quotes only from a published, active service.");
      return done("The service is not available to quote.");
    }
    if (priced.kind === "incomplete") {
      await escalate(`The price for ${first} still needs: ${priced.missing.join(", ")}.`, "The pricing rules ask for something Sales has no question for. Add it to the service's quoting questions, or price this one yourself.", priced.missing.map((detail) => ({ label: "Needed", detail })));
      return done("The pricing rules need more than Sales can ask for.");
    }
    if (priced.kind === "walkthrough") {
      step("calculate_quote", "refused", `The service's rules say this needs a walkthrough or a custom quote: ${priced.reasons[0]}`);
      await escalate(`${name}'s request needs a custom quote or a walkthrough.`, `${priced.service.name}'s own pricing rules say a firm price cannot be given from answers alone. Sales does not estimate around them.`, priced.reasons.slice(0, 4).map((detail) => ({ label: "Why", detail })));
      return done("Needs a custom quote or a walkthrough.");
    }
    step("calculate_quote", "done", `${priced.service.name}, version ${priced.version.version}: ${formatCents(priced.result.totalCents)} per ${priced.result.per}${priced.result.outcome === "estimate" ? " (an estimate)" : ""}.`);
    const saved = await saveQuoteVersion(ctx, company, await fresh(), priced, SALES);
    step("prepare_quote", saved.created ? "done" : "read", saved.created ? `Saved quote Q-${saved.quote.number}, version ${saved.version.version}, at ${formatCents(saved.version.totalCents)}.` : `Quote Q-${saved.quote.number} version ${saved.version.version} already matches.`);
    opportunity = await fresh();
    if (opportunity.stage !== "quote_ready") opportunity = await setStage(ctx, opportunity, "quote_ready", SALES);
    let quote = (await ctx.db.get(saved.quote._id))!;
    if (quote.approvedVersion !== saved.version.version) {
      const why = reviewReason(company, opportunity, saved.version);
      if (why) {
        if (!quote.approvalId || (await ctx.db.get(quote.approvalId))?.status !== "pending") {
          const approvalId = await requestApproval(ctx, {
            companyId: company._id,
            action: REPLY_AND_QUOTE,
            summary: `Review ${name}'s quote before it goes out: ${formatCents(saved.version.totalCents)} for ${saved.version.serviceName}.`,
            reason: `${why} The price is from ${saved.version.serviceName} version ${saved.version.serviceVersion} and the details on the opportunity.`,
            authorizes: `Quote Q-${quote.number} version ${saved.version.version} at ${formatCents(saved.version.totalCents)} may be sent to ${name}. Sales then sends it under its own permission for replies and quotes.`,
            ifWaiting: "The quote is not sent. The customer keeps waiting.",
            proposal: { kind: "sales_quote", quoteId: quote._id, version: saved.version.version, totalCents: saved.version.totalCents },
            decideBy: Date.now() + DAY,
            about: { table: "salesOpportunities", id: opportunity._id },
            taskId: opportunity.taskId,
          });
          await ctx.db.patch(quote._id, { status: "awaiting_approval", approvalId, updatedAt: Date.now() });
        }
        await setNext(ctx, opportunity, { what: `Review ${first}'s quote (${formatCents(saved.version.totalCents)}): ${why}`, by: "owner", dueAt: Date.now() + DAY });
        step("request_approval", "proposed", `The quote needs your review before it goes out: ${why}`);
        return done("The quote is ready and needs your review.");
      }
      quote = await approveVersion(ctx, quote, saved.version.version, "rules", SALES);
      step("prepare_quote", "done", "A firm price from the published rules with no discount, so it needs no review.");
    }
    const validUntil = new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, month: "short", day: "numeric" }).format(new Date(Date.now() + saved.version.validDays * DAY));
    const body = quoteMessage(onRecord, await voiceOf(ctx, company, opportunity), { service: saved.version.serviceName, totalCents: saved.version.totalCents, per: saved.version.per, estimate: saved.version.outcome === "estimate", validUntil, depositCents: saved.version.depositCents });
    await act({
      kind: "send_quote",
      channel,
      subject: `${revised ? "Your updated quote" : "Your quote"} from ${company.name}`,
      body: revised ? body.replace("Your quote for", "Your updated quote for") : body,
      quote: { quoteId: quote._id, version: saved.version.version },
      summary: `Send ${first} ${revised ? "the updated" : "the"} quote: ${formatCents(saved.version.totalCents)} for ${saved.version.serviceName}.`,
      reason: `Everything ${saved.version.serviceName}'s price needs is on record, and the pricing engine gave ${formatCents(saved.version.priceCents)}${saved.version.taxCents ? ` plus ${formatCents(saved.version.taxCents)} tax` : ""}.`,
      evidence: [{ label: "Service", detail: `${saved.version.serviceName}, version ${saved.version.serviceVersion}` }, ...requirements.filter((row) => row.phase === "quote" && known(opportunity.facts, row.key)).slice(0, 5).map((row) => ({ label: row.label, detail: factWords(factOf(opportunity.facts, row.key)!, requirements) })), { label: "Valid", detail: `${saved.version.validDays} days, until ${validUntil}` }],
      nextStep: "The customer reviews it on a secure page and accepts, declines or asks a question. Follow-ups are planned if they do not answer.",
      permission: REPLY_AND_QUOTE,
    });
    return done(`Prepared quote Q-${quote.number} at ${formatCents(saved.version.totalCents)}.`);
  }
}

/** Whether an opportunity has anything for Sales to do, for sweeps that pick up work after a pause or a missed trigger. */
export function wantsWork(opportunity: Doc<"salesOpportunities">, now: number): boolean {
  if (!isOpen(opportunity.stage) || opportunity.takeover) return false;
  const next = opportunity.nextAction;
  if (!next) return true;
  return next.by === "sales" && next.dueAt <= now;
}
