/**
 * Reading a customer's message into facts and an intent. Two readers share one shape: the rules here,
 * and an AI reader (claude.ts) when one is connected and credits are held for it. Whoever read it,
 * `checked` runs on the answer before anything is stored:
 *
 *  - a fact is kept only if its words are in the message, its key is one the service asks for, and its
 *    value fits that question. A reader that was talked into inventing a value has it dropped;
 *  - an intent is only ever one of the listed kinds, and "accept" never accepts anything: a quote is
 *    accepted on its own page, for one exact version.
 *
 * The customer's words are data. Nothing in them is an instruction to Sales, and no reading can change
 * a price, a permission or a policy.
 */
import type { Fact, Reading } from "./schema";
import type { Requirement } from "./facts";
import { ONE_TIME } from "./facts";
import { ALWAYS_ESCALATE } from "./settings";

export type ReadInput = {
  /** The customer's latest message. */
  text: string;
  /** What the service asks for, so only those are read. */
  requirements: Requirement[];
  /** The last question Sales asked, when exactly one is open: a short reply is read as its answer. */
  lastAsked: string | null;
  /** Whether a quote is out, which is what makes "yes" or "too expensive" mean something. */
  quoteOut: boolean;
};

const EXCERPT = 200;
const clip = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, EXCERPT);

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUMBER = "(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)";
const toNumber = (raw: string): number => WORD_NUMBERS[raw.toLowerCase()] ?? Number(raw.replace(/,/g, ""));

const DECLINE = /\b(no thanks?|not interested|no longer (need|interested)|too (expensive|much|pricey)|out of (my|our) budget|found (someone|somebody|another|a different)|went with (someone|another)|going with (someone|another)|we('| a)re all set|please cancel|never ?mind|i('ll| will) pass)\b/i;
const DEFER = /\b(not (right )?now|not yet|maybe later|get back to you|think (about|it over)|next (week|month|year|spring|summer|fall|winter)|in a (few|couple of) (weeks|months)|after (the|my|our) (move|holidays?|renovation|remodel|trip)|circle back|check back)\b/i;
const ACCEPT = /\b(yes|yep|yeah|sounds good|looks good|let'?s (do it|book|go ahead)|go ahead|book (it|me)|i('d| would) like to (book|schedule|go ahead)|i accept|we accept|that works|works for (me|us))\b/i;
const QUESTION = /\?|^\s*(what|how|do you|does|can you|could you|are you|is there|is it|will you|when|where|which|who)\b/i;
const OPT_OUT = /\b(stop (texting|messaging|contacting|emailing)|(don'?t|do not) (text|message|contact|email)|remove me|unsubscribe|take me off)\b/i;

const SCHEDULE_WORDS: { pattern: RegExp; value: string }[] = [
  { pattern: /\b(bi-?weekly|every (two|2|other) weeks?|every other week|fortnightly|every 14 days)\b/i, value: "every_14_days" },
  { pattern: /\b(weekly|every week|once a week|each week|every 7 days)\b/i, value: "every_7_days" },
  { pattern: /\b(twice (a|per) month|two times a month|2x (a|per) month)\b/i, value: "twice_per_month" },
  { pattern: /\b(monthly|once a month|every month|each month)\b/i, value: "once_per_month" },
  { pattern: /\b(one[- ]time|just once|only once|single (visit|clean(ing)?)|one[- ]off|a one time)\b/i, value: ONE_TIME },
];

const TIMING = /\b((this|next|on|by)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|weekend|week of|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?|as soon as possible|asap|this week|next week|mornings?|afternoons?|evenings?)\b/i;
const ACCESS = /\b(key|lockbox|door code|gate code|garage code|keypad|doorman|front desk|i('ll| will) be home|someone will be (home|there)|let you in|leave (it|the door) unlocked)\b/i;

function sentenceWith(text: string, pattern: RegExp): string | null {
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) if (pattern.test(sentence)) return clip(sentence);
  return null;
}

function find(text: string, pattern: RegExp): { value: string; excerpt: string } | null {
  const match = pattern.exec(text);
  return match ? { value: match[1], excerpt: clip(match[0]) } : null;
}

type Read = { key: string; value: string | number | boolean; excerpt: string };

/** A short reply to the one open question is its answer, in whatever form that question takes. */
function directAnswer(text: string, requirement: Requirement): Read | null {
  const reply = text.trim();
  if (reply.length === 0 || reply.length > 60) return null;
  if (requirement.type === "number") {
    const match = new RegExp(`^(?:about |around |roughly |approx(?:imately)? )?${NUMBER}\\b`, "i").exec(reply);
    return match ? { key: requirement.key, value: toNumber(match[1]), excerpt: clip(reply) } : null;
  }
  if (requirement.type === "yes_no") {
    if (/^(yes|yep|yeah|y|we do|i do|it does|there (is|are))\b/i.test(reply)) return { key: requirement.key, value: true, excerpt: clip(reply) };
    if (/^(no|nope|nah|n|we don'?t|i don'?t|it doesn'?t|none)\b/i.test(reply)) return { key: requirement.key, value: false, excerpt: clip(reply) };
    return null;
  }
  if (requirement.type === "choice") {
    const option = requirement.options?.find((row) => reply.toLowerCase().includes(row.label.toLowerCase()));
    return option ? { key: requirement.key, value: option.value, excerpt: clip(reply) } : null;
  }
  // Free text: the reply is the answer, unless it is itself a question.
  return QUESTION.test(reply) ? null : { key: requirement.key, value: clip(reply), excerpt: clip(reply) };
}

/** The rules reader. It only finds what is plainly written; anything it is unsure of it leaves out, so Sales asks. */
export function readByRule(input: ReadInput): Reading {
  const text = input.text.slice(0, 4000);
  const wants = new Set(input.requirements.map((row) => row.key));
  const facts: Read[] = [];
  const add = (row: Read | null) => {
    if (row && wants.has(row.key) && !facts.some((fact) => fact.key === row.key)) facts.push(row);
  };

  const bedrooms = find(text, new RegExp(`${NUMBER}\\s*[- ]?(?:bed(?:room)?s?|br|bd)\\b`, "i"));
  if (bedrooms) add({ key: "bedrooms", value: toNumber(bedrooms.value), excerpt: bedrooms.excerpt });
  const bathrooms = find(text, new RegExp(`${NUMBER}\\s*[- ]?(?:bath(?:room)?s?|ba)\\b`, "i"));
  if (bathrooms) add({ key: "bathrooms", value: toNumber(bathrooms.value), excerpt: bathrooms.excerpt });
  const area = find(text, /(\d[\d,]{2,6})\s*(?:sq\.?\s*f(?:ee|oo)?t\.?|square\s*f(?:ee|oo)t|sqft|sf|m²|square met(?:er|re)s?)/i);
  if (area) add({ key: "area", value: toNumber(area.value), excerpt: area.excerpt });
  const beds = find(text, new RegExp(`${NUMBER}\\s*beds\\b(?!room)`, "i"));
  if (beds) add({ key: "beds", value: toNumber(beds.value), excerpt: beds.excerpt });
  const unitRequirement = input.requirements.find((row) => row.key === "units");
  if (unitRequirement) {
    const word = /Number of (.+)s$/.exec(unitRequirement.label)?.[1];
    const units = word ? find(text, new RegExp(`${NUMBER}\\s*${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i")) : null;
    if (units) add({ key: "units", value: toNumber(units.value), excerpt: units.excerpt });
  }
  // A postal code: five digits standing alone, never part of a size or a phone number.
  const postal = /(?:^|[^\d,.$])(\d{5})(?:-\d{4})?(?!\s*(?:sq|sf|square|m²)|[\d,])/i.exec(text);
  if (postal) add({ key: "postalCode", value: postal[1], excerpt: clip(postal[0].replace(/^[^\d]/, "")) });
  for (const row of SCHEDULE_WORDS) {
    const match = row.pattern.exec(text);
    if (match) {
      add({ key: "schedule", value: row.value, excerpt: clip(match[0]) });
      break;
    }
  }
  for (const requirement of input.requirements) {
    if (requirement.type !== "choice" || requirement.key === "schedule") continue;
    const option = requirement.options?.find((row) => new RegExp(`\\b${row.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
    if (option) add({ key: requirement.key, value: option.value, excerpt: clip(new RegExp(`\\b${option.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").exec(text)![0]) });
  }
  const timing = sentenceWith(text, TIMING);
  if (timing) add({ key: "timing", value: timing, excerpt: timing });
  const access = sentenceWith(text, ACCESS);
  if (access) add({ key: "access", value: access, excerpt: access });

  const open = input.lastAsked ? input.requirements.find((row) => row.key === input.lastAsked) : undefined;
  if (open && !facts.some((fact) => fact.key === open.key)) add(directAnswer(text, open));

  const questions = text
    .split(/(?<=[.!?\n])\s+/)
    .filter((sentence) => sentence.includes("?"))
    .map(clip)
    .slice(0, 3);

  let intent: Reading["intent"] = facts.length > 0 ? "provide_info" : "other";
  if (ALWAYS_ESCALATE.test(text)) intent = "complaint";
  else if (OPT_OUT.test(text)) intent = "opt_out";
  else if (DECLINE.test(text)) intent = "decline";
  else if (DEFER.test(text)) intent = "defer";
  else if (input.quoteOut && ACCEPT.test(text) && questions.length === 0) intent = "accept";
  else if (questions.length > 0 || QUESTION.test(text)) intent = facts.length > 0 ? "provide_info" : "question";

  return { intent, facts, questions, reader: "rules" };
}

const INTENTS: readonly Reading["intent"][] = ["provide_info", "question", "accept", "decline", "defer", "opt_out", "complaint", "other"];
const fold = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * What survives of a reading once it is held against the message and the service. Every reader's
 * answer goes through this, the rules' included.
 */
export function checked(reading: Reading, input: ReadInput): Reading {
  const haystack = fold(input.text);
  const facts: Reading["facts"] = [];
  for (const fact of Array.isArray(reading.facts) ? reading.facts.slice(0, 20) : []) {
    const requirement = input.requirements.find((row) => row.key === fact.key);
    if (!requirement || facts.some((row) => row.key === fact.key)) continue;
    const excerpt = typeof fact.excerpt === "string" ? clip(fact.excerpt) : "";
    // The words must be the customer's own. A value with no words behind it is not a fact.
    if (!excerpt || !haystack.includes(fold(excerpt))) continue;
    let value = fact.value;
    if (requirement.type === "number") {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 1_000_000) continue;
      // Rooms and units are counts; a size may be large but never fractional beyond a half bath.
      if (requirement.key !== "area" && number > 200) continue;
      value = requirement.key === "bathrooms" ? Math.round(number * 2) / 2 : Math.round(number);
    } else if (requirement.type === "yes_no") {
      if (typeof value !== "boolean") continue;
    } else if (requirement.type === "choice") {
      if (!requirement.options?.some((option) => option.value === value)) continue;
    } else {
      if (typeof value !== "string" || value.trim() === "") continue;
      value = clip(value);
      if (requirement.key === "postalCode" && !/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(value)) continue;
    }
    facts.push({ key: requirement.key, value, excerpt });
  }
  let intent: Reading["intent"] = INTENTS.includes(reading.intent) ? reading.intent : "other";
  // These two are never left to a reader's judgment: the words themselves decide.
  if (ALWAYS_ESCALATE.test(input.text)) intent = "complaint";
  else if (OPT_OUT.test(input.text)) intent = "opt_out";
  if (intent === "accept" && !input.quoteOut) intent = facts.length > 0 ? "provide_info" : "other";
  const questions = (Array.isArray(reading.questions) ? reading.questions : []).filter((row): row is string => typeof row === "string" && row.trim() !== "").map(clip).slice(0, 3);
  const date = typeof reading.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(reading.date) ? reading.date : undefined;
  return { intent, facts, questions, ...(date ? { date } : {}), reader: String(reading.reader).slice(0, 40) };
}

/** A reading's facts as records, marked as the customer's own stated words. */
export function asFacts(reading: Reading, ref: string, at: number): Fact[] {
  return reading.facts.map((fact) => ({ key: fact.key, value: fact.value, source: { kind: "customer" as const, ref, excerpt: fact.excerpt }, status: "stated" as const, at }));
}

/** Why a customer declined, as far as their words say. */
export function lostReasonFrom(text: string): "price" | "timing" | "chose_another" | "other" {
  if (/\b(expensive|pricey|too much|budget|cheaper|afford)\b/i.test(text)) return "price";
  if (/\b(found|went with|going with|hired|another (company|cleaner|service))\b/i.test(text)) return "chose_another";
  if (/\b(timing|too late|too soon|schedule|not available|can'?t wait)\b/i.test(text)) return "timing";
  return "other";
}
