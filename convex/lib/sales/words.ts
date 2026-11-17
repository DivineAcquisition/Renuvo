/**
 * What Sales says to a customer. Every message starts here, written by the company's templates from
 * facts that are already checked: the price is the quote's, the date is the record's, the questions are
 * the service's. An AI reader may reword a draft; `acceptWording` then holds the rewording against the
 * draft and keeps it only if it added no number, no link and no promise.
 *
 * Sales never pretends to be a person. It introduces itself once as the company's assistant.
 */
import { formatCents } from "../services/words";
import type { Requirement } from "./facts";

/** Greets by first name. A record that only has a number or an address for the person is greeted without one. */
const first = (name: string) => (/^[+\d\s().-]+$/.test(name.trim()) || name.includes("@") || !name.trim() ? "there" : name.trim().split(/\s+/)[0]);

export type Voice = { company: string; tone: "warm" | "direct" | "formal"; signature: string | null; firstContact: boolean; channel: "sms" | "email" };

function opener(name: string, voice: Voice): string {
  const hello = voice.tone === "formal" ? `Hello ${first(name)},` : `Hi ${first(name)},`;
  // The first message says who is writing. A text also says how to stop them, once.
  return voice.firstContact ? `${hello} this is ${voice.company}'s assistant.` : hello;
}

function closer(voice: Voice): string {
  const sign = voice.signature ? `\n${voice.signature}` : voice.channel === "email" ? `\n${voice.company}` : "";
  const stop = voice.firstContact && voice.channel === "sms" ? " Reply STOP to opt out." : "";
  return `${stop}${sign}`;
}

/** At most two questions at a time, in the order the service needs them. */
export function questionMessage(name: string, voice: Voice, input: { service: string | null; ask: Requirement[]; answered: string | null }): string {
  const asks = input.ask.slice(0, 2).map((row) => row.ask);
  const thanks = voice.firstContact ? ` Thanks for asking about ${input.service ?? "our cleaning services"}.` : input.answered ? ` ${input.answered}` : voice.tone === "warm" ? " Thanks for that." : "";
  const need = asks.length === 1 ? `To give you an exact price, one question: ${asks[0]}` : `To give you an exact price, two quick questions: ${asks[0]} ${asks[1]}`;
  return `${opener(name, voice)}${thanks} ${need}${closer(voice)}`;
}

export function serviceQuestion(name: string, voice: Voice, services: string[]): string {
  const list = services.length > 0 ? ` We offer ${services.slice(0, 5).join(", ")}.` : "";
  return `${opener(name, voice)}${voice.firstContact ? " Thanks for reaching out." : ""} Which service are you looking for?${list}${closer(voice)}`;
}

export function quoteMessage(name: string, voice: Voice, input: { service: string; totalCents: number; per: string; estimate: boolean; validUntil: string; depositCents?: number }): string {
  const price = `${input.estimate ? "an estimate of " : ""}${formatCents(input.totalCents)} per ${input.per}`;
  const deposit = input.depositCents ? ` A deposit of ${formatCents(input.depositCents)} holds your booking.` : "";
  return `${opener(name, voice)} Your quote for ${input.service} is ready: ${price}.${deposit} You can review what's included and accept it here: {link} It stays open until ${input.validUntil}. Any questions, just reply.${closer(voice)}`;
}

export function answerMessage(name: string, voice: Voice, answer: string, next: string | null): string {
  return `${opener(name, voice)} ${answer}${next ? ` ${next}` : ""}${closer(voice)}`;
}

/** A "yes" by text is not an acceptance: the quote page records exactly which version was accepted. */
export function acceptOnPageMessage(name: string, voice: Voice): string {
  return `${opener(name, voice)} Glad to hear it. To confirm, please accept the quote on its page, so the exact price and scope are on record: {link}${closer(voice)}`;
}

export function missingInfoReminder(name: string, voice: Voice, input: { service: string | null; ask: Requirement[] }): string {
  const asks = input.ask.slice(0, 2).map((row) => row.ask).join(" ");
  return `${opener(name, voice)} Following up on your ${input.service ?? "cleaning"} request. I can send your price as soon as I know: ${asks} No rush if now isn't a good time.${closer(voice)}`;
}

export function quoteReminder(name: string, voice: Voice, input: { service: string; totalCents: number; validUntil: string }): string {
  return `${opener(name, voice)} Checking in on your ${input.service} quote (${formatCents(input.totalCents)}). It's open until ${input.validUntil}: {link} If you have a question about what's included, reply here and I'll answer it.${closer(voice)}`;
}

export function requestedDateMessage(name: string, voice: Voice, input: { service: string | null }): string {
  return `${opener(name, voice)} You asked us to check back about ${input.service ?? "your cleaning request"} around now. Would you like me to pick it back up? If plans changed, just say so and I'll close it out.${closer(voice)}`;
}

/** What still stands between an accepted quote and a confirmed booking, in the customer's terms. */
export function bookingStepsMessage(name: string, voice: Voice, steps: string[]): string {
  const list = steps.length === 1 ? steps[0] : steps.map((step, index) => `${index + 1}) ${step}`).join(" ");
  return `${opener(name, voice)} Thanks for accepting your quote. Before we can confirm your booking: ${list} Your time is not confirmed until then.${closer(voice)}`;
}

/** The booking is confirmed: a job exists. It never says a cleaner is confirmed, because that is Dispatch's to say. */
export function bookingConfirmedMessage(name: string, voice: Voice, input: { service: string; when: string; where: string | null }): string {
  return `${opener(name, voice)} You're booked: ${input.service} on ${input.when}${input.where ? ` at ${input.where}` : ""}. We're now arranging your cleaning team and will be in touch before the visit. Reply here if anything changes.${closer(voice)}`;
}

const NUMBERS = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const PROMISES = /\b(guarantee[sd]?|discount(ed|s)?|% ?off|free|complimentary|promo(tion)?|coupon|special offer|limited time|only \d+ (spots?|slots?) left|confirmed (crew|cleaner|team)|your cleaner (is|will be)|we (have|do have) (availability|an opening)|available (on|at|this|next)|refund|insured|bonded|background[- ]checked|licensed)\b/gi;

const tokens = (value: string, pattern: RegExp) => new Set((value.match(pattern) ?? []).map((token) => token.toLowerCase().replace(/,/g, "")));

/**
 * A rewording is kept only if it says nothing the draft did not: every number in it is one the draft
 * has, the link placeholder is where it was (once, or not at all), it carries no address of its own,
 * and it makes no promise the draft did not make. Anything else and the draft goes out as written.
 */
export function acceptWording(draft: string, candidate: string | null, channel: "sms" | "email"): string | null {
  if (!candidate) return null;
  const text = candidate.trim();
  if (text.length < 10 || text.length > (channel === "sms" ? 640 : 2400)) return null;
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co)\b/i.test(text)) return null;
  const links = (value: string) => (value.match(/\{link\}/g) ?? []).length;
  if (links(text) !== links(draft)) return null;
  if (/\{(?!link\})[a-z_]+\}/i.test(text)) return null;
  const allowed = tokens(draft, NUMBERS);
  for (const number of tokens(text, NUMBERS)) if (!allowed.has(number)) return null;
  const promised = tokens(draft, PROMISES);
  for (const promise of tokens(text, PROMISES)) if (!promised.has(promise)) return null;
  // A text that opted the person in to stopping must still say so.
  if (/Reply STOP/i.test(draft) && !/Reply STOP/i.test(text)) return null;
  return text;
}

/** Words for the owner: how one requirement reads once answered or still open. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
