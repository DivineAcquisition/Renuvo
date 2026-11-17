/**
 * Booking forms: the starting templates, what makes a form valid to publish, and what a submission
 * becomes.
 *
 * Every form asks for a name and one way to reach the person. Everything else is the company's choice,
 * and a field may name the fact its answer becomes ("bedrooms", "postalCode"), so what the customer
 * typed on the form is never asked again in conversation.
 *
 * A form says plainly whether it asks for an estimate or for a booking. Neither is a confirmed booking:
 * the confirmation page says so, and a booking exists only when Sales or a person makes one.
 *
 * Permission to text is its own unticked box with its own words. Giving a phone number is not permission.
 */
import { userError } from "../errors";
import { isEmail } from "../text";
import { sendablePhone } from "../messaging/provider";
import { ONE_TIME } from "./facts";
import { FIELD_KINDS, SERVICE_KINDS, type Fact, type FormDefinition, type FormField, type ServiceKind } from "./schema";

export const FORM_LIMITS = { fields: 30, options: 12, label: 120, help: 200, title: 80, intro: 400, answer: 1000 } as const;

/** The facts a form field may feed. Anything else a field collects is kept as a note on the opportunity. */
export const FACT_KEYS = ["postalCode", "bedrooms", "bathrooms", "area", "units", "beds", "condition", "schedule", "timing", "access", "pets", "operatingHours", "facilityType"] as const;

const SCHEDULE_OPTIONS: Record<string, string> = { "One time": ONE_TIME, "Every week": "every_7_days", "Every two weeks": "every_14_days", "Twice a month": "twice_per_month", "Once a month": "once_per_month" };
const FREQUENCY = Object.keys(SCHEDULE_OPTIONS);

const SMS_TEXT = "Yes, text me about this request at the number above. Message and data rates may apply. Reply STOP to opt out.";

const field = (id: string, label: string, kind: FormField["kind"], required: boolean, extra: Partial<FormField> = {}): FormField => ({ id, label, kind, required, options: [], ...extra });

export const FORM_TEMPLATES: Record<ServiceKind, { name: string; blurb: string; definition: FormDefinition }> = {
  residential: {
    name: "Home cleaning inquiry",
    blurb: "Size, condition, how often and when. What a home cleaning price usually needs.",
    definition: {
      title: "Get a cleaning quote",
      intro: "Tell us about your home and we'll send you a price. This is a request for an estimate, not a booking.",
      intent: "estimate",
      kind: "residential",
      serviceKeys: [],
      fields: [
        field("postal", "ZIP or postal code", "postal_code", true, { factKey: "postalCode" }),
        field("bedrooms", "Bedrooms", "number", true, { factKey: "bedrooms" }),
        field("bathrooms", "Bathrooms", "number", true, { factKey: "bathrooms", help: "Count a half bath as .5" }),
        field("area", "Approximate square footage", "number", false, { factKey: "area" }),
        field("frequency", "How often?", "choice", true, { options: FREQUENCY, factKey: "schedule" }),
        field("pets", "Any pets in the home?", "yes_no", false),
        field("pet_details", "Tell us about them", "text", false, { factKey: "pets", showIf: { fieldId: "pets", equals: "Yes" } }),
        field("timing", "When would you like service?", "text", false, { factKey: "timing", help: "A day, a date, or \"as soon as possible\"" }),
        field("notes", "Anything else we should know?", "longtext", false),
      ],
      consent: { sms: true, smsText: SMS_TEXT },
      submitLabel: "Request my quote",
      confirmation: { title: "Thanks, we have your request", body: "We'll reply with your price or a quick question. Nothing is booked yet: you'll confirm a time after you've seen your quote." },
    },
  },
  commercial: {
    name: "Commercial cleaning inquiry",
    blurb: "The facility, its size, how often, when it can be cleaned, and whether a walkthrough is wanted.",
    definition: {
      title: "Request a commercial cleaning proposal",
      intro: "Tell us about your space. Most commercial work is priced after a short walkthrough. This is a request for a proposal, not a booking.",
      intent: "estimate",
      kind: "commercial",
      serviceKeys: [],
      fields: [
        field("business", "Business name", "text", true),
        field("facility", "Type of facility", "choice", true, { options: ["Office", "Medical or dental", "Retail", "Restaurant", "Warehouse or industrial", "Other"], factKey: "facilityType" }),
        field("postal", "ZIP or postal code", "postal_code", true, { factKey: "postalCode" }),
        field("area", "Approximate square footage", "number", true, { factKey: "area" }),
        field("frequency", "How often?", "choice", true, { options: ["One time", "Every week", "Every two weeks", "Once a month", "Several times a week"] }),
        field("hours", "When can the space be cleaned?", "text", true, { factKey: "operatingHours", help: "For example: weekdays after 6 pm" }),
        field("walkthrough", "Would you like a walkthrough before a proposal?", "yes_no", false),
        field("role", "Your role", "text", false, { help: "So we know who makes the decision" }),
        field("notes", "Scope or anything else we should know", "longtext", false),
      ],
      consent: { sms: true, smsText: SMS_TEXT },
      submitLabel: "Request a proposal",
      confirmation: { title: "Thanks, we have your request", body: "We'll be in touch to arrange a walkthrough or send a proposal. Nothing is booked yet." },
    },
  },
  short_term_rental: {
    name: "Short-term rental turnover inquiry",
    blurb: "Bedrooms and beds, the turnover window, laundry, restocking and access.",
    definition: {
      title: "Get a turnover cleaning quote",
      intro: "Tell us about your rental and we'll send a price per turnover. This is a request for an estimate, not a booking.",
      intent: "estimate",
      kind: "short_term_rental",
      serviceKeys: [],
      fields: [
        field("postal", "ZIP or postal code", "postal_code", true, { factKey: "postalCode" }),
        field("bedrooms", "Bedrooms", "number", true, { factKey: "bedrooms" }),
        field("beds", "Beds to make up", "number", true, { factKey: "beds" }),
        field("bathrooms", "Bathrooms", "number", true, { factKey: "bathrooms" }),
        field("window", "Checkout and check-in times", "text", true, { factKey: "timing", help: "For example: out at 11 am, in at 4 pm" }),
        field("laundry", "Laundry", "choice", true, { options: ["Washer and dryer on site", "Taken off site", "No laundry needed"] }),
        field("restock", "Should we restock supplies?", "yes_no", false),
        field("access", "How does our team get in?", "text", false, { factKey: "access", help: "A lockbox, a door code, a property manager" }),
        field("turnovers", "Turnovers in a typical month", "number", false),
        field("notes", "Anything else we should know?", "longtext", false),
      ],
      consent: { sms: true, smsText: SMS_TEXT },
      submitLabel: "Request my quote",
      confirmation: { title: "Thanks, we have your request", body: "We'll reply with your price per turnover or a quick question. Nothing is booked yet." },
    },
  },
};

const clean = (value: string, label: string, max: number, required = true): string => {
  const out = value.trim().replace(/\s+/g, " ");
  if (!out && required) throw userError(`${label} is needed.`);
  if (out.length > max) throw userError(`${label} is too long. Keep it under ${max} characters.`);
  return out;
};

/** A form as it may be saved. Anything a published form could not safely show or collect is refused here. */
export function normalizeForm(input: FormDefinition): FormDefinition {
  if (!(SERVICE_KINDS as readonly string[]).includes(input.kind)) throw userError("Choose what kind of work the form is for.");
  if (input.fields.length > FORM_LIMITS.fields) throw userError(`A form can have up to ${FORM_LIMITS.fields} questions.`);
  const ids = new Set<string>();
  const fields: FormField[] = [];
  for (const row of input.fields) {
    const id = row.id.trim();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(id) || ids.has(id)) throw userError("Each question needs its own short id (letters, numbers and underscores).");
    ids.add(id);
    if (!(FIELD_KINDS as readonly string[]).includes(row.kind)) throw userError("That kind of question is not supported.");
    const options = row.kind === "choice" ? row.options.map((option) => clean(option, "An option", 60)) : [];
    if (row.kind === "choice" && (options.length < 2 || options.length > FORM_LIMITS.options || new Set(options).size !== options.length)) throw userError(`"${row.label}" needs between 2 and ${FORM_LIMITS.options} different options.`);
    if (row.factKey !== undefined && !(FACT_KEYS as readonly string[]).includes(row.factKey)) throw userError(`"${row.label}" is linked to something Sales does not track.`);
    fields.push({ id, label: clean(row.label, "A question's label", FORM_LIMITS.label), kind: row.kind, required: row.required, options, ...(row.help?.trim() ? { help: clean(row.help, "Help text", FORM_LIMITS.help) } : {}), ...(row.factKey ? { factKey: row.factKey } : {}), ...(row.showIf ? { showIf: { fieldId: row.showIf.fieldId, equals: clean(row.showIf.equals, "The answer a question depends on", 60) } } : {}) });
  }
  for (const [index, row] of fields.entries()) {
    if (!row.showIf) continue;
    // A question can only depend on one asked before it, so the form never loops.
    const parent = fields.slice(0, index).find((other) => other.id === row.showIf!.fieldId);
    if (!parent || (parent.kind !== "choice" && parent.kind !== "yes_no")) throw userError(`"${row.label}" can only depend on a choice or yes/no question that comes before it.`);
    if (row.required) throw userError(`"${row.label}" is shown only sometimes, so it cannot be required.`);
  }
  const duplicates = fields.filter((row) => row.factKey).map((row) => row.factKey!);
  if (new Set(duplicates).size !== duplicates.length) throw userError("Two questions feed the same detail. Keep one.");
  if (input.accent !== undefined && !/^#[0-9a-fA-F]{6}$/.test(input.accent)) throw userError("The accent color is a six-digit hex color, for example #6838EF.");
  return {
    title: clean(input.title, "The title", FORM_LIMITS.title),
    intro: clean(input.intro, "The introduction", FORM_LIMITS.intro, false),
    intent: input.intent,
    kind: input.kind,
    serviceKeys: [...new Set(input.serviceKeys.map((key) => key.trim()).filter(Boolean))].slice(0, 12),
    fields,
    consent: { sms: input.consent.sms, smsText: input.consent.sms ? clean(input.consent.smsText, "The wording for permission to text", 400) : input.consent.smsText.trim().slice(0, 400) },
    ...(input.accent ? { accent: input.accent.toLowerCase() } : {}),
    submitLabel: clean(input.submitLabel, "The button's label", 40),
    confirmation: { title: clean(input.confirmation.title, "The confirmation title", FORM_LIMITS.title), body: clean(input.confirmation.body, "The confirmation message", FORM_LIMITS.intro) },
  };
}

/** What stops a draft from being published, in words. Empty when it can go live. */
export function publishProblems(definition: FormDefinition): string[] {
  const problems: string[] = [];
  if (definition.fields.length === 0) problems.push("Add at least one question.");
  if (!/not a (confirmed )?booking|nothing is booked|estimate|proposal|request/i.test(`${definition.intro} ${definition.confirmation.body}`)) problems.push("Say on the form or its confirmation that submitting it is a request, not a confirmed booking.");
  if (definition.consent.sms && !/stop/i.test(definition.consent.smsText)) problems.push("The wording for permission to text must say how to stop the texts (reply STOP).");
  return problems;
}

export type Answers = Record<string, string | number | boolean>;

export function isShown(row: FormField, answers: Answers): boolean {
  if (!row.showIf) return true;
  const parent = answers[row.showIf.fieldId];
  const value = typeof parent === "boolean" ? (parent ? "Yes" : "No") : String(parent ?? "");
  return value.toLowerCase() === row.showIf.equals.toLowerCase();
}

export type Submission = {
  name: string;
  email: string;
  phone: string;
  message: string;
  serviceKey: string;
  answers: Answers;
  smsConsent: boolean;
};

export type CheckedSubmission =
  | { ok: true; contact: { name: string; email?: string; phone?: string }; answers: Answers; facts: Fact[]; notes: string[]; timing?: string; serviceKey?: string; smsConsent: boolean }
  | { ok: false; problems: Record<string, string> };

/** Checks a submission against the published form and turns it into a contact, facts and notes. Hidden and unknown fields are dropped. */
export function checkSubmission(definition: FormDefinition, input: Submission, at: number, ref: string): CheckedSubmission {
  const problems: Record<string, string> = {};
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) problems.name = "Enter your name.";
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  if (email && !isEmail(email)) problems.email = "That email address doesn't look right.";
  if (phone && !sendablePhone(phone)) problems.phone = "That phone number doesn't look right.";
  if (!email && !phone) problems.email = "Enter an email address or a phone number so we can reply.";
  if (input.smsConsent && !phone) problems.phone = "Add a mobile number to get texts, or untick the box.";
  if (input.message.length > 2000) problems.message = "Keep your message under 2,000 characters.";
  const serviceKey = input.serviceKey.trim();
  if (serviceKey && !definition.serviceKeys.includes(serviceKey)) problems.service = "Choose one of the services listed.";

  const answers: Answers = {};
  const facts: Fact[] = [];
  const notes: string[] = [];
  let timing: string | undefined;
  for (const row of definition.fields) {
    if (!isShown(row, answers)) continue;
    const raw = input.answers[row.id];
    const empty = raw === undefined || raw === "" || raw === null;
    if (empty) {
      if (row.required) problems[row.id] = "This one is needed.";
      continue;
    }
    let value: string | number | boolean;
    if (row.kind === "number") {
      const number = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
      if (!Number.isFinite(number) || number < 0 || number > 1_000_000) {
        problems[row.id] = "Enter a number.";
        continue;
      }
      value = Math.round(number * 2) / 2;
    } else if (row.kind === "yes_no") {
      value = raw === true || String(raw).toLowerCase() === "yes";
    } else if (row.kind === "choice") {
      if (!row.options.includes(String(raw))) {
        problems[row.id] = "Choose one of the options.";
        continue;
      }
      value = String(raw);
    } else {
      value = String(raw).trim().replace(/\s+/g, " ");
      if (value.length > FORM_LIMITS.answer) {
        problems[row.id] = "That's too long.";
        continue;
      }
      if (row.kind === "email" && !isEmail(value.toLowerCase())) problems[row.id] = "That email address doesn't look right.";
      if (row.kind === "phone" && !sendablePhone(value)) problems[row.id] = "That phone number doesn't look right.";
      if (row.kind === "postal_code" && !/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(value)) problems[row.id] = "That postal code doesn't look right.";
      if (row.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) problems[row.id] = "Choose a date.";
      if (problems[row.id]) continue;
    }
    answers[row.id] = value;
    const shown = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
    if (row.factKey === "schedule") {
      const mapped = SCHEDULE_OPTIONS[shown];
      if (mapped) facts.push({ key: "schedule", value: mapped, source: { kind: "form", ref, excerpt: shown }, status: "confirmed", at });
      else notes.push(`${row.label}: ${shown}`);
    } else if (row.factKey === "condition") {
      // A condition is a level of one service; the label is kept and matched to the service's levels when it is priced.
      notes.push(`${row.label}: ${shown}`);
    } else if (row.factKey) {
      facts.push({ key: row.factKey, value: row.factKey === "postalCode" ? shown.toUpperCase() : typeof value === "boolean" ? shown : value, source: { kind: "form", ref, excerpt: shown.slice(0, 200) }, status: "confirmed", at });
      if (row.factKey === "timing") timing = shown;
    } else {
      notes.push(`${row.label}: ${shown}`);
    }
  }
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, contact: { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) }, answers, facts, notes, timing, ...(serviceKey ? { serviceKey } : {}), smsConsent: input.smsConsent && definition.consent.sms };
}
