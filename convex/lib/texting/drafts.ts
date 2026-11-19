/**
 * Selestial's first drafts of everything a company needs to ask permission to text, written from the
 * company's own details. The owner edits any of them; an edited draft is never regenerated over their
 * words. Each draft is checked for what carriers require of it (the 10DLC campaign compliance guide,
 * read 2026-11-19), so the screen can say exactly what is missing.
 *
 * These are drafts for the business to adopt as its own. They are not legal advice, and the screen says so.
 */
import { chosen } from "./activities";
import type { DraftKey } from "./schema";

export type DraftInput = {
  /** The customer-facing name every text starts with. */
  name: string;
  legalName?: string;
  website?: string;
  supportEmail?: string;
  supportPhone?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  activities: readonly string[];
  marketingPerWeek: number;
  links: { privacy: string; terms: string; signup?: string };
  places: readonly string[];
  otherPlace?: string;
};

const list = (words: string[]) => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

/** What customers are told they will get, in words. Only the customer activities, and never promotions. */
export function customerTopics(activities: readonly string[]): string {
  const rows = chosen(activities).filter((row) => row.audience === "customer" && row.category === "operational");
  const words = rows.map((row) => row.label.toLowerCase());
  if (words.length === 0) words.push("your requests and bookings");
  return list(words);
}

/** "+15125550100" as "(512) 555-0100", the way people read a number in a text. */
export function readablePhone(value: string | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : (value ?? "");
}

function contactLine(input: DraftInput): string {
  const ways = [input.supportPhone ? `call ${readablePhone(input.supportPhone)}` : "", input.supportEmail ? `email ${input.supportEmail}` : ""].filter(Boolean);
  return ways.length ? ways.join(" or ") : "contact us";
}

function address(input: DraftInput): string {
  return [input.street, input.city, [input.state, input.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function draftFor(key: DraftKey, input: DraftInput): string {
  const n = input.name;
  const legal = input.legalName && input.legalName !== n ? `${input.legalName} (doing business as ${n})` : n;
  const marketing = chosen(input.activities).some((row) => row.category === "marketing");
  switch (key) {
    case "sms_consent":
      return `Text me about ${customerTopics(input.activities)} from ${n} at the number I provided. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of purchase. See our Texting Terms and Privacy Policy.`;
    case "marketing_consent":
      return marketing
        ? `Also text me offers and promotions from ${n}, up to ${input.marketingPerWeek} a week. Msg & data rates may apply. Reply STOP to opt out. Consent is not a condition of purchase.`
        : "";
    case "help_reply":
      return `${n}: for help with our texts, ${contactLine(input)}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`;
    case "stop_reply":
      return `${n}: you're unsubscribed and will get no more texts from us. Reply START to subscribe again.`;
    case "start_reply":
      return `${n}: you're subscribed to texts about ${customerTopics(input.activities)}. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;
    case "terms":
      return [
        `## ${n} texting terms`,
        `These terms cover text messages from ${legal}${address(input) ? `, ${address(input)}` : ""}.`,
        "## What you'll receive",
        `If you agree to texts, ${n} texts you about ${customerTopics(input.activities)}.${marketing ? ` If you also agree to marketing texts, ${n} may text you offers and promotions, up to ${input.marketingPerWeek} a week.` : ""}`,
        "## How often",
        "Message frequency varies with your requests and bookings.",
        "## Cost",
        "Message and data rates may apply. Check your mobile plan for details.",
        "## Stopping texts",
        "Reply STOP to any text to stop receiving them. You'll get one message confirming you're unsubscribed. Reply START to subscribe again.",
        "## Help",
        `Reply HELP for help, or ${contactLine(input)}.`,
        "## Carriers",
        "Carriers are not liable for delayed or undelivered messages.",
        "## Privacy",
        `How we handle your information, including your phone number, is described in our Privacy Policy: ${input.links.privacy}`,
      ].join("\n\n");
    case "privacy":
      return [
        `## ${n} privacy policy`,
        `This policy explains how ${legal} collects and uses information about customers, people who ask about our cleaning services, and people who apply to work with us.`,
        "## What we collect",
        "Your name, phone number, email address, service address, the details of the cleanings you ask about or book, payment status, and the messages you send us.",
        "## How we use it",
        "To answer your questions, prepare estimates, schedule and carry out cleanings, send reminders and receipts, process applications, and improve our service.",
        "## Text messages",
        `If you agree to texts, we use your phone number to send the texts you agreed to. We do not sell or share your mobile phone number, or your agreement to receive texts, with third parties or affiliates for their marketing or promotional purposes. Text messaging originator opt-in data and consent are not shared with any third parties, except service providers that deliver our messages for us.`,
        "## Who we share information with",
        `Service providers that help us run ${n}, such as our scheduling and messaging platform and payment processor, only to provide those services to us. We share information when the law requires it. We never sell your information.`,
        "## Your choices",
        `Reply STOP to any text to stop texts. To see, correct or delete your information, ${contactLine(input)}.`,
        "## Contact",
        `${legal}${address(input) ? `, ${address(input)}` : ""}. ${contactLine(input).replace(/^./, (c) => c.toUpperCase())}.`,
      ].join("\n\n");
    case "opt_in_flow":
      return optInFlow(input);
  }
}

const PLACE_FLOW: Record<string, (input: DraftInput) => string> = {
  booking_form: (input) => `Customers can agree on ${input.name}'s online booking form`,
  quote_form: (input) => `People asking for an estimate can agree on ${input.name}'s estimate request form`,
  website: (input) => `Anyone can sign up on ${input.name}'s texting sign-up form${input.links.signup ? ` at ${input.links.signup}` : ""}`,
  cleaner_application: (input) => `People applying to work with ${input.name} can agree on its job application form`,
  team_onboarding: (input) => `Cleaners on ${input.name}'s team can agree while setting up their team portal`,
};

/** The message flow carriers read: where and how people agree, in the company's words. */
export function optInFlow(input: DraftInput): string {
  const sentences = input.places.filter((place) => PLACE_FLOW[place]).map((place) => PLACE_FLOW[place](input));
  if (input.places.includes("other") && input.otherPlace) sentences.push(`Also: ${input.otherPlace.trim().replace(/\.$/, "")}`);
  const how = "by checking an optional, unchecked box labelled for texts, separate from any other terms. The box shows the wording, links to the texting terms and privacy policy, and says how to get help (HELP) and stop (STOP). Each agreement is recorded with the wording shown, the date and where it was given, and no text is sent without one.";
  const lines = [sentences.length ? `${sentences.join(". ")}, ${how}` : `People agree to texts ${how}`];
  if (input.links.signup) lines.push(`Public sign-up form: ${input.links.signup}`);
  lines.push(`Texting terms: ${input.links.terms}`, `Privacy policy: ${input.links.privacy}`);
  return lines.join(" ").slice(0, 2048);
}

/** What carriers require each draft to say that it does not yet say. Empty means it is complete. */
export function draftGaps(key: DraftKey, text: string, input: Pick<DraftInput, "name" | "activities">): string[] {
  const t = text.toLowerCase();
  const name = input.name.toLowerCase();
  const gaps: string[] = [];
  const need = (ok: boolean, words: string) => {
    if (!ok) gaps.push(words);
  };
  const marketing = chosen(input.activities).some((row) => row.category === "marketing");
  switch (key) {
    case "sms_consent":
      need(t.includes(name), `name your business (${input.name})`);
      need(/frequency/.test(t), "say message frequency varies");
      need(/rates may apply/.test(t), 'say "Msg & data rates may apply"');
      need(/\bstop\b/.test(t), "say how to opt out (STOP)");
      need(/\bhelp\b/.test(t), "say how to get help (HELP)");
      need(/terms/.test(t) && /privacy/.test(t), "point to your texting terms and privacy policy");
      need(!/\b(promotion|offer|deal|discount|sale)s?\b/.test(t), "leave promotions out (they need their own, separate permission)");
      break;
    case "marketing_consent":
      if (!marketing) break;
      need(t.length > 0, "ask separately for permission to send promotions");
      need(t.includes(name), `name your business (${input.name})`);
      need(/rates may apply/.test(t), 'say "Msg & data rates may apply"');
      need(/\bstop\b/.test(t), "say how to opt out (STOP)");
      break;
    case "help_reply":
      need(t.includes(name), `name your business (${input.name})`);
      need(/@|\d{3}/.test(t), "give a way to reach you (phone or email)");
      need(/\bstop\b/.test(t), "say how to opt out (STOP)");
      break;
    case "stop_reply":
      need(t.includes(name), `name your business (${input.name})`);
      need(/unsubscribe|no more|won't|will not|stopped/.test(t), "confirm no more texts will be sent");
      break;
    case "start_reply":
      need(t.includes(name), `name your business (${input.name})`);
      need(/\bstop\b/.test(t), "say how to opt out (STOP)");
      need(/\bhelp\b/.test(t), "say how to get help (HELP)");
      break;
    case "terms":
      need(t.includes(name), `name your business (${input.name})`);
      need(/rates may apply/.test(t), "say message and data rates may apply");
      need(/frequency/.test(t), "say how often texts come");
      need(/\bstop\b/.test(t), "say how to opt out (STOP)");
      need(/\bhelp\b/.test(t), "say how to get help (HELP)");
      break;
    case "privacy":
      need(t.includes(name), `name your business (${input.name})`);
      need(/not (sell|share)|never sell|do not sell or share/.test(t) && /third part/.test(t), "say mobile information is not sold or shared with third parties for marketing");
      break;
    case "opt_in_flow":
      need(text.trim().length >= 40, "describe where and how people agree (at least a sentence)");
      need(/unchecked|optional/.test(t), "say the text box is optional and unchecked");
      need(/privacy/.test(t), "include the privacy policy link");
      break;
  }
  return gaps;
}
