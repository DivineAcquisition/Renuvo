/**
 * The setup path: which steps and questions this owner sees. Pure, and shared by the functions and the
 * screens, so the server and the browser never disagree about what comes next.
 *
 * A question is asked only when its answer is not already known, it matters for what the owner chose, and
 * it cannot simply wait. Every question can be answered "I'm not sure".
 */
import type { Choice } from "./facts";
import type { Priority } from "./schema";

export const STAGES = [
  { id: "company", label: "Your company" },
  { id: "priority", label: "Your priority" },
  { id: "prepare", label: "Prepare your workspace" },
  { id: "review", label: "Review & start" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export type PriorityInfo = {
  id: Priority;
  title: string;
  /** The launch agent that does this work, or null for setup the owner does with Selestial's help. */
  agent: "sales" | "dispatch" | "recruiter" | "retention" | null;
  /** What the owner gets first, in one sentence. */
  first: string;
  /** Said plainly when the work behind it is not built yet. */
  caveat?: string;
};

export const PRIORITY_INFO: PriorityInfo[] = [
  { id: "sales", title: "Turn more inquiries into bookings", agent: "sales", first: "Start with Sales. We'll prepare your inquiry process and show which leads are ready for follow-up." },
  { id: "dispatch", title: "Keep jobs covered and organized", agent: "dispatch", first: "Start with Dispatch. We'll check your upcoming jobs for missing coverage and ask cleaners for the hours you don't have." },
  { id: "recruiter", title: "Find and onboard cleaners", agent: "recruiter", first: "Start with Recruiter. We'll prepare your hiring brief and what you screen for, ready to review applicants." },
  {
    id: "retention",
    title: "Keep customers coming back",
    agent: "retention",
    first: "Start with Retention. We'll get your customer records and recurring service ready, so follow-up has what it needs.",
  },
  { id: "pricing", title: "Set up services and pricing", agent: null, first: "We'll prepare one service you can review, with a live quote preview, before anything is published." },
  { id: "booking", title: "Get agreements and booking ready", agent: null, first: "We'll prepare a booking page draft and a service agreement draft for you to review." },
];

export type Question = {
  id: string;
  /** The priorities this question matters for. */
  for: Priority[];
  title: string;
  /** Why it is asked, when that is not obvious. */
  why: string;
  kind: "single" | "multi";
  choices: Choice[];
  /** Can be skipped without stopping anything. */
  optional: boolean;
};

export const QUESTIONS: Question[] = [
  {
    id: "inquiries.channels",
    for: ["sales", "booking"],
    title: "How do new customers reach you today?",
    why: "Sales starts where your inquiries already arrive, instead of asking you to move them.",
    kind: "multi",
    choices: [
      { value: "phone", label: "Phone calls" },
      { value: "text", label: "Text messages" },
      { value: "email", label: "Email" },
      { value: "website_form", label: "A form on my website" },
      { value: "google", label: "Google (Maps, ads, reviews)" },
      { value: "social", label: "Social media" },
      { value: "referrals", label: "Word of mouth" },
    ],
    optional: false,
  },
  {
    id: "pricing.state",
    for: ["sales", "pricing", "booking"],
    title: "How do you price a job today?",
    why: "A firm quote needs a price you have approved. Without one, we prepare a quote request instead of a price.",
    kind: "single",
    choices: [
      { value: "set_prices", label: "I have set prices", hint: "A price list or a formula you already use" },
      { value: "some_prices", label: "Some services are priced", hint: "Others I quote one by one" },
      { value: "quote_each", label: "I quote every job myself" },
      { value: "starting_out", label: "I'm still working it out" },
    ],
    optional: false,
  },
  {
    id: "jobs.where",
    for: ["dispatch", "retention"],
    title: "Where is your schedule kept today?",
    why: "Dispatch can only cover jobs it can see. This tells us the simplest way to bring yours in.",
    kind: "single",
    choices: [
      { value: "calendar", label: "A calendar", hint: "Google Calendar or similar" },
      { value: "software", label: "Scheduling software" },
      { value: "spreadsheet", label: "A spreadsheet" },
      { value: "paper", label: "Paper, texts or memory" },
      { value: "none_yet", label: "No regular jobs yet" },
    ],
    optional: false,
  },
  {
    id: "jobs.assigning",
    for: ["dispatch"],
    title: "How do cleaners get their jobs?",
    why: "Dispatch offers work the way your cleaners already expect it.",
    kind: "single",
    choices: [
      { value: "i_assign", label: "I assign every job" },
      { value: "regulars", label: "Regular cleaners keep regular customers" },
      { value: "first_to_accept", label: "I offer it and whoever accepts first takes it" },
      { value: "leads_assign", label: "Crew leads sort it out" },
    ],
    optional: true,
  },
  {
    id: "hiring.now",
    for: ["recruiter"],
    title: "Are you hiring right now?",
    why: "Recruiter prepares for the opening you have, not one you might have later.",
    kind: "single",
    choices: [
      { value: "now", label: "Yes, I need people now" },
      { value: "soon", label: "Soon, in the next month or two" },
      { value: "pipeline", label: "Not yet, but I want applicants ready" },
    ],
    optional: false,
  },
  {
    id: "hiring.sources",
    for: ["recruiter"],
    title: "Where do applicants come from?",
    why: "Recruiter only contacts people who applied to you. This tells us where to look for them.",
    kind: "multi",
    choices: [
      { value: "job_boards", label: "Job boards", hint: "Indeed, Craigslist and similar" },
      { value: "email", label: "They email me" },
      { value: "referrals", label: "Referrals from my team" },
      { value: "social", label: "Social media" },
      { value: "walk_ins", label: "Calls and walk-ins" },
    ],
    optional: true,
  },
  {
    id: "customers.where",
    for: ["retention", "sales"],
    title: "Where are your customer records today?",
    why: "Follow-up needs to know who your customers are and when you last cleaned for them.",
    kind: "single",
    choices: [
      { value: "software", label: "In software I can export from" },
      { value: "spreadsheet", label: "A spreadsheet" },
      { value: "phone", label: "My phone and messages" },
      { value: "few", label: "I only have a few so far" },
    ],
    optional: true,
  },
  {
    id: "agreements.have",
    for: ["booking"],
    title: "Do you have a service agreement you use today?",
    why: "We start from your own wording when you have it, and from a template when you don't.",
    kind: "single",
    choices: [
      { value: "own", label: "Yes, my own document" },
      { value: "informal", label: "Only terms in emails or texts" },
      { value: "none", label: "No, I need one" },
    ],
    optional: true,
  },
];

export const UNSURE = "unsure";

/** The questions for what this owner chose, in order, each asked once however many priorities want it. */
export function questionsFor(primary: Priority | undefined, secondary: Priority[]): Question[] {
  if (!primary) return [];
  const chosen = [primary, ...secondary.filter((value) => value !== primary)];
  // The first priority's questions come first; a secondary priority adds only its required ones.
  return QUESTIONS.filter((question) => question.for.includes(primary) || (!question.optional && question.for.some((value) => chosen.includes(value)))).sort(
    (a, b) => Number(b.for.includes(primary)) - Number(a.for.includes(primary)),
  );
}

export type Step = { id: string; stage: StageId; optional: boolean };

/** Every step of this owner's path. It changes only when their choices do. */
export function stepsFor(primary: Priority | undefined, secondary: Priority[]): Step[] {
  return [
    { id: "start", stage: "company", optional: false },
    { id: "basics", stage: "company", optional: false },
    { id: "team", stage: "company", optional: true },
    { id: "priority", stage: "priority", optional: false },
    ...questionsFor(primary, secondary).map((question) => ({ id: `q:${question.id}`, stage: "priority" as const, optional: question.optional })),
    { id: "records", stage: "prepare", optional: true },
    { id: "prepare", stage: "prepare", optional: false },
    { id: "review", stage: "review", optional: false },
  ];
}

const answered = (value: string | string[] | undefined) => (Array.isArray(value) ? value.length > 0 : Boolean(value));

/** How far along the path the owner is, counted in the steps of their own path. */
export function progress(input: { primary?: Priority; secondary: Priority[]; step: string; answers: Record<string, string | string[]>; skipped: string[] }): { done: number; total: number; stage: StageId } {
  const steps = stepsFor(input.primary, input.secondary);
  const at = Math.max(0, steps.findIndex((step) => step.id === input.step));
  return { done: at, total: steps.length, stage: steps[at]?.stage ?? "company" };
}

/** Required questions still unanswered: what stops "Review & start" from being offered as complete. */
export function unanswered(primary: Priority | undefined, secondary: Priority[], answers: Record<string, string | string[]>): Question[] {
  return questionsFor(primary, secondary).filter((question) => !question.optional && !answered(answers[question.id]));
}

export type Connection = { id: string; title: string; does: string; href: string; for: Priority[] };

/** Connections that already work in Selestial, in business words, by the priority they help. Nothing here is a connector that does not exist. */
export const CONNECTIONS: Connection[] = [
  { id: "google-calendar", title: "Google Calendar", does: "Check existing appointments and keep visits on your calendar.", href: "/app/integrations", for: ["dispatch", "retention", "sales"] },
  { id: "gmail", title: "Gmail hiring inbox", does: "Find applicants who already applied by email.", href: "/app/agents/recruiter", for: ["recruiter"] },
  { id: "google-business", title: "Google Business Profile", does: "Read and answer your Google reviews.", href: "/app/integrations", for: ["retention", "sales"] },
  { id: "google-ads", title: "Google Ads lead forms", does: "Read incoming customer inquiries from your ads.", href: "/app/integrations", for: ["sales"] },
  { id: "stripe", title: "Stripe", does: "Collect customer payments and deposits.", href: "/app/finance", for: ["booking", "sales"] },
  { id: "google-drive", title: "Google Drive", does: "Bring in price lists and documents you already keep.", href: "/app/integrations", for: ["pricing", "booking"] },
];

export function connectionsFor(primary: Priority | undefined, secondary: Priority[]): Connection[] {
  if (!primary) return [];
  const chosen = [primary, ...secondary];
  return CONNECTIONS.filter((row) => row.for.some((value) => chosen.includes(value))).sort((a, b) => Number(b.for.includes(primary)) - Number(a.for.includes(primary))).slice(0, 4);
}
