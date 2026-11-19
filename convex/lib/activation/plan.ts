/**
 * The activation plan: which first tasks Selestial starts for the owner's focus, decided by code from a
 * snapshot of the company's records. Pure, so the server and the review screen agree, and every rule is
 * tested without a database.
 *
 * Templates and prerequisite checks decide what runs. Nothing here reads a model, so nothing can invent a
 * permission, a price or a fact: a task whose input is missing waits for the smallest specific answer.
 */
import type { Agent } from "../statuses";
import type { Priority } from "../setup/schema";
import type { Blocker, TaskState } from "./schema";

/** The owner's focus in their own terms. Setup's priorities map onto these. */
export const FOCUS: Record<Priority, { words: string; agent: Agent; lead: string }> = {
  sales: { words: "Get more bookings", agent: "sales", lead: "Sales prepares your inquiry process and follows through on open inquiries. Dispatch checks you can fulfill the work." },
  pricing: { words: "Set up services and pricing", agent: "sales", lead: "Sales prepares a service and pricing draft you review before anything is published." },
  booking: { words: "Get agreements and booking ready", agent: "sales", lead: "Sales prepares a booking page and an agreement draft, ready for your review." },
  recruiter: { words: "Hire cleaners", agent: "recruiter", lead: "Recruiter drafts your role and application, and looks for applicants where you've authorized it. Dispatch supplies real coverage needs." },
  dispatch: { words: "Stop chasing cleaners", agent: "dispatch", lead: "Dispatch checks coverage for upcoming appointments and what's missing for cleaners to be offered work." },
  retention: { words: "Keep more customers", agent: "retention", lead: "Retention reviews completed services, recurring plans and open concerns, and prepares your feedback and recovery steps." },
};

/** What the plan reads from the company's records. Counted, never estimated. */
export type Snapshot = {
  now: number;
  companyName: string;
  plan: Record<Agent, { ok: boolean; words: string }>;
  paused: Agent[];
  /** Confirmed facts only, in the owner's words. A fact merely found on a page is not here. */
  facts: { areas: string | null; categories: string[]; phone: string | null; email: string | null; location: string | null; workforce: string[] };
  sales: { activeServices: number; draftServiceId: string | null; bookingPageId: string | null; agreementId: string | null; openInquiries: number; inquiryIds: string[]; approvedAnswers: number; proposedAnswers: number; firstBatchDecided: boolean; replyLevel: string };
  recruiter: { openNeeds: number; openNeedId: string | null; draftNeedId: string | null; inbox: "connected" | "broken" | "none"; applications: number; inviteLevel: string };
  dispatch: { upcomingJobs: number; uncoveredJobs: number; uncoveredJobIds: string[]; readyCleaners: number; cleanersWithoutAvailability: number; canText: boolean; offerLevel: string };
  retention: { completedJobs: number; activePlans: number; customers: number; openCases: number; guaranteeWritten: boolean; reviewLink: boolean; feedbackAfterFirst: boolean; feedbackLevel: string };
  canEmail: boolean;
};

export type TemplateId =
  | "sales.service_draft"
  | "sales.booking_page"
  | "sales.agreement_draft"
  | "sales.faq_answers"
  | "sales.inquiry_follow_through"
  | "recruiter.role_draft"
  | "recruiter.applicant_review"
  | "dispatch.coverage_review"
  | "dispatch.readiness"
  | "retention.review"
  | "retention.care_setup";

export type Planned = {
  template: TemplateId;
  agent: Agent;
  title: string;
  objective: string;
  sources: { label: string; count: number; href?: string }[];
  expectedOutput: string;
  prerequisites: { words: string; met: boolean }[];
  authority: { action: string | null; words: string };
  estimate: { credits: number; externalCents: number; words: string };
  priority: number;
  dependsOn: TemplateId[];
  completion: string;
  /** Where it starts: queued, or blocked/unavailable with the one thing that would unblock it. */
  state: Extract<TaskState, "queued" | "waiting_info" | "waiting_connection" | "paused" | "unavailable">;
  statusLine: string;
  blocker?: Blocker;
  /** Preparation work in the workspace (a draft, a checklist), or an agent running its own workflow. */
  kind: "preparation" | "agent_workflow";
};

/** The most a first batch holds, so a company never gets every possible task just because an agent exists. */
export const MAX_TASKS = 8;
/** The most inquiries or visits one task works through; the agents' own routines pick up the rest. */
export const BATCH_LIMIT = { inquiries: 10, jobs: 25 } as const;

const LEVEL_WORDS: Record<string, string> = {
  off: "is off, so nothing is sent",
  propose: "asks you first for each one",
  execute_and_report: "may act and tells you after",
  execute: "may act on its own",
  paused: "is paused",
  unknown: "is not set",
  person_only: "is always a person's decision",
};
const authorityWords = (agentName: string, level: string, what: string) => `${what}: ${agentName} ${LEVEL_WORDS[level] ?? "follows your settings"}.`;

const NONE = { credits: 0, externalCents: 0, words: "No AI credits: this is prepared from templates and your confirmed answers." };

type Template = {
  agent: Agent;
  kind: Planned["kind"];
  title: string;
  objective: (s: Snapshot) => string;
  expectedOutput: (s: Snapshot) => string;
  completion: string;
  sources: (s: Snapshot) => Planned["sources"];
  authority: (s: Snapshot) => Planned["authority"];
  estimate: (s: Snapshot) => Planned["estimate"];
  dependsOn?: TemplateId[];
  /** The one thing missing, if anything. Checked in order: plan, paused, connection, information. */
  gate: (s: Snapshot) => { state: "waiting_info" | "waiting_connection"; blocker: Blocker; statusLine: string } | null;
  queuedLine: string;
};

const facts = (s: Snapshot) => [s.facts.areas, s.facts.categories.length ? "x" : null, s.facts.phone, s.facts.email].filter(Boolean).length;

export const TEMPLATES: Record<TemplateId, Template> = {
  "sales.service_draft": {
    agent: "sales",
    kind: "preparation",
    title: "Prepare a service and pricing draft",
    objective: () => "Give Sales a service it can describe and, once you publish it, price.",
    expectedOutput: (s) => (s.sales.draftServiceId ? "Your existing service draft, kept as you left it." : "A service draft in Services & Pricing, with example prices clearly marked."),
    completion: "A service draft exists in Services & Pricing. It is not published until you publish it.",
    sources: (s) => [{ label: "Who you clean for (confirmed)", count: s.facts.categories.length }],
    authority: () => ({ action: null, words: "Internal preparation. Publishing a service or changing a price is always yours." }),
    estimate: () => NONE,
    gate: () => null,
    queuedLine: "Waiting to prepare your service draft.",
  },
  "sales.booking_page": {
    agent: "sales",
    kind: "preparation",
    title: "Prepare your booking page",
    objective: () => "Give customers one place to ask for a cleaning, in your company's name.",
    expectedOutput: (s) => (s.sales.bookingPageId ? "Your existing booking page, kept as you left it." : "A booking page draft in Sales › Booking forms."),
    completion: "A booking page draft exists. It takes no bookings until you publish it with a live service.",
    sources: (s) => [{ label: "Published services", count: s.sales.activeServices, href: "/app/services" }],
    authority: () => ({ action: null, words: "Internal preparation. Publishing the page is always yours." }),
    estimate: () => NONE,
    gate: () => null,
    queuedLine: "Waiting to prepare your booking page.",
  },
  "sales.agreement_draft": {
    agent: "sales",
    kind: "preparation",
    title: "Prepare a service agreement draft",
    objective: () => "Start your customer agreement from Selestial's starting text, for you to review.",
    expectedOutput: (s) => (s.sales.agreementId ? "Your existing agreement draft, kept as you left it." : "An agreement draft in Agreements, marked as not reviewed."),
    completion: "An agreement draft exists. Nobody has reviewed or approved its terms.",
    sources: (s) => [{ label: "Who you clean for (confirmed)", count: s.facts.categories.length }],
    authority: () => ({ action: null, words: "Internal preparation. Nothing is sent for signature." }),
    estimate: () => NONE,
    gate: () => null,
    queuedLine: "Waiting to prepare your agreement draft.",
  },
  "sales.faq_answers": {
    agent: "sales",
    kind: "preparation",
    title: "Propose answers to common questions",
    objective: () => "Turn what you confirmed about your company into answers Sales may give, once you approve them.",
    expectedOutput: () => "Proposed answers in the Sales Playbook. Sales uses none of them until you approve each one.",
    completion: "Proposed answers are in the Playbook, waiting for your approval.",
    sources: (s) => [{ label: "Confirmed company facts", count: facts(s) }],
    authority: () => ({ action: null, words: "Proposals only. An answer is used only after you approve it in the Playbook." }),
    estimate: () => NONE,
    gate: (s) =>
      facts(s) === 0
        ? {
            state: "waiting_info",
            statusLine: "Waiting for the areas you serve.",
            blocker: { kind: "information", words: "Tell us the areas you serve, so Sales can answer where you clean.", action: { label: "Add your service areas", href: "/app/setup" } },
          }
        : null,
    queuedLine: "Waiting to write proposed answers from your confirmed details.",
  },
  "sales.inquiry_follow_through": {
    agent: "sales",
    kind: "agent_workflow",
    title: "Follow through on open inquiries",
    objective: (s) => `Review ${Math.min(s.sales.openInquiries, BATCH_LIMIT.inquiries)} open ${s.sales.openInquiries === 1 ? "inquiry" : "inquiries"} and prepare each one's next step with the services you confirmed.`,
    expectedOutput: () => "A prepared reply, question or quote for each inquiry, in Sales.",
    completion: "Each inquiry reviewed has a prepared next step, or a recorded reason it has none.",
    sources: (s) => [{ label: "Open inquiries", count: s.sales.openInquiries, href: "/app/agents/sales/pipeline" }],
    authority: (s) => ({
      action: "sales.reply_and_quote",
      words: s.sales.firstBatchDecided ? authorityWords("Sales", s.sales.replyLevel, "Replies and quotes") : "Nothing is sent: Sales holds its first replies for you to review together.",
    }),
    estimate: () => ({ credits: 0, externalCents: 0, words: "No AI credits: Sales works from the conversation as recorded, and no new customer message is read. Sending, if you allow it, is a normal business message." }),
    gate: (s) =>
      s.sales.openInquiries === 0
        ? {
            state: "waiting_info",
            statusLine: "Waiting for inquiries to review.",
            blocker: { kind: "information", words: "There are no open inquiries yet. Add or import recent inquiries and Sales will follow through on them.", action: { label: "Add inquiries", href: "/app/agents/sales/new" } },
          }
        : null,
    queuedLine: "Waiting to review your open inquiries.",
  },
  "recruiter.role_draft": {
    agent: "recruiter",
    kind: "preparation",
    title: "Draft your hiring role and application",
    objective: () => "Describe who you're hiring, with the application form and screening questions applicants will see.",
    expectedOutput: (s) => (s.recruiter.openNeedId ? "Your open role and its application form, kept as they are." : "A draft role in Recruiter › Hiring needs, with its application form. It is not published."),
    completion: "A role with an application form exists. A drafted role is not open to applicants until you open it.",
    sources: (s) => [
      { label: "Areas you serve (confirmed)", count: s.facts.areas ? 1 : 0 },
      { label: "How your cleaners work (confirmed)", count: s.facts.workforce.length },
    ],
    authority: () => ({ action: null, words: "Internal preparation. Opening the role and setting pay are always yours." }),
    estimate: () => NONE,
    gate: () => null,
    queuedLine: "Waiting to draft your role.",
  },
  "recruiter.applicant_review": {
    agent: "recruiter",
    kind: "agent_workflow",
    title: "Find applicants in your hiring inbox",
    objective: () => "Read your authorized hiring inbox and organize the people who applied to you.",
    expectedOutput: () => "Applicants filed in Recruiter, with what each is missing.",
    completion: "The hiring inbox was read and every application found is filed with its next step.",
    sources: (s) => [{ label: "Applications on file", count: s.recruiter.applications, href: "/app/agents/recruiter/applicants" }],
    authority: (s) => ({ action: "recruiter.send_invitation", words: authorityWords("Recruiter", s.recruiter.inviteLevel, "Application invitations") + (s.recruiter.openNeeds ? "" : " Nobody is invited until a role is open.") }),
    estimate: () => ({ credits: 0, externalCents: 0, words: "No extra credits: this is Recruiter's routine inbox reading, charged per AI-read hiring email exactly as its 10-minute check is." }),
    dependsOn: ["recruiter.role_draft"],
    gate: (s) =>
      s.recruiter.inbox === "connected"
        ? null
        : {
            state: "waiting_connection",
            statusLine: "Waiting for your hiring inbox.",
            blocker: {
              kind: "connection",
              words: s.recruiter.inbox === "broken" ? "Your hiring inbox stopped working. Reconnect it so Recruiter can find applicants." : "I prepared your hiring application. Connect your hiring inbox to identify applicants who should receive it.",
              action: { label: s.recruiter.inbox === "broken" ? "Reconnect your hiring inbox" : "Connect your hiring inbox", href: "/app/agents/recruiter/applicants" },
            },
          },
    queuedLine: "Waiting to read your hiring inbox.",
  },
  "dispatch.coverage_review": {
    agent: "dispatch",
    kind: "agent_workflow",
    title: "Check coverage for upcoming appointments",
    objective: (s) => `Check the ${s.dispatch.upcomingJobs} upcoming ${s.dispatch.upcomingJobs === 1 ? "visit" : "visits"} in the next two weeks and work any that have no cleaner.`,
    expectedOutput: () => "A coverage picture for the next two weeks, with offers or proposals for visits that need a cleaner.",
    completion: "Every upcoming visit in the window is covered, has an offer out, is waiting on your decision, or is named as uncovered.",
    sources: (s) => [
      { label: "Upcoming visits", count: s.dispatch.upcomingJobs, href: "/app/schedule" },
      { label: "Cleaners ready for work", count: s.dispatch.readyCleaners, href: "/app/cleaners" },
    ],
    authority: (s) => ({ action: "dispatch.request_acceptance", words: authorityWords("Dispatch", s.dispatch.offerLevel, "Job offers to cleaners") }),
    estimate: () => ({ credits: 0, externalCents: 0, words: "No AI credits. Any offer text it is allowed to send is a normal business message." }),
    gate: (s) =>
      s.dispatch.upcomingJobs === 0
        ? {
            state: "waiting_info",
            statusLine: "Waiting for upcoming visits.",
            blocker: { kind: "information", words: "There are no upcoming visits in the next two weeks. Add or import your schedule and Dispatch will check coverage.", action: { label: "Add a visit", href: "/app/schedule" } },
          }
        : null,
    queuedLine: "Waiting to check coverage for upcoming appointments.",
  },
  "dispatch.readiness": {
    agent: "dispatch",
    kind: "preparation",
    title: "Build your coverage-readiness checklist",
    objective: () => "Find exactly what stops Dispatch from offering work to your cleaners, and put each gap in Dispatch's queue.",
    expectedOutput: () => "A checklist item in Dispatch for each real gap, or confirmation that nothing is missing.",
    completion: "Each gap is an open item in Dispatch's queue, or Dispatch has what it needs.",
    sources: (s) => [
      { label: "Cleaners ready for work", count: s.dispatch.readyCleaners, href: "/app/cleaners" },
      { label: "Ready cleaners without availability", count: s.dispatch.cleanersWithoutAvailability },
    ],
    authority: () => ({ action: null, words: "Internal preparation. Nothing is sent to a cleaner." }),
    estimate: () => NONE,
    gate: () => null,
    queuedLine: "Waiting to check what Dispatch needs.",
  },
  "retention.review": {
    agent: "retention",
    kind: "agent_workflow",
    title: "Review completed services and recurring plans",
    objective: () => "Check completed visits, recurring plans, billing and agreements for interruptions and unresolved concerns.",
    expectedOutput: () => "Signals and cases in Retention for anything that needs follow-through.",
    completion: "Retention reconciled your records and every finding is a signal or a case.",
    sources: (s) => [
      { label: "Completed visits (90 days)", count: s.retention.completedJobs },
      { label: "Active recurring plans", count: s.retention.activePlans },
      { label: "Open customer cases", count: s.retention.openCases },
    ],
    authority: (s) => ({ action: "retention.request_feedback", words: authorityWords("Retention", s.retention.feedbackLevel, "Feedback requests") }),
    estimate: () => ({ credits: 0, externalCents: 0, words: "No AI credits: reconciling records uses Retention's rules." }),
    gate: (s) =>
      s.retention.completedJobs + s.retention.activePlans + s.retention.customers === 0
        ? {
            state: "waiting_info",
            statusLine: "Waiting for your customers and past visits.",
            blocker: { kind: "information", words: "There are no customers or past visits yet. Import your customer list and Retention will review it.", action: { label: "Import customers", href: "/app/clients" } },
          }
        : null,
    queuedLine: "Waiting to review your customers' services.",
  },
  "retention.care_setup": {
    agent: "retention",
    kind: "preparation",
    title: "Prepare your feedback and recovery steps",
    objective: () => "Get feedback requests and service recovery ready to run in your company's own words.",
    expectedOutput: () => "A Retention checklist item for each missing piece, and your feedback request settings.",
    completion: "Each missing piece is an open item in Retention's queue, or Retention has what it needs.",
    sources: (s) => [{ label: "Customers on record", count: s.retention.customers, href: "/app/clients" }],
    authority: () => ({ action: null, words: "Internal preparation. Nothing is sent to a customer." }),
    estimate: () => NONE,
    gate: () => null,
    queuedLine: "Waiting to prepare your feedback and recovery steps.",
  },
};

/** Which templates serve each focus, in order, and at what priority. Supporting work is a higher number. */
function wanted(focus: Priority, s: Snapshot): [TemplateId, number][] {
  const noService = s.sales.activeServices === 0;
  switch (focus) {
    case "sales":
      return [
        ...(noService ? ([["sales.service_draft", 1]] as [TemplateId, number][]) : []),
        ["sales.inquiry_follow_through", 1],
        ["sales.booking_page", 1],
        ["sales.faq_answers", 1],
        ["dispatch.coverage_review", 2],
      ];
    case "pricing":
      return [
        ["sales.service_draft", 1],
        ["sales.faq_answers", 2],
        ["sales.booking_page", 2],
      ];
    case "booking":
      return [
        ...(noService ? ([["sales.service_draft", 1]] as [TemplateId, number][]) : []),
        ["sales.booking_page", 1],
        ["sales.agreement_draft", 1],
      ];
    case "recruiter":
      return [
        ["recruiter.role_draft", 1],
        ["recruiter.applicant_review", 1],
        ["dispatch.coverage_review", 2],
        ["dispatch.readiness", 3],
      ];
    case "dispatch":
      return [
        ["dispatch.coverage_review", 1],
        ["dispatch.readiness", 1],
        ...(s.dispatch.readyCleaners === 0 || s.dispatch.uncoveredJobs > 0 ? ([["recruiter.role_draft", 2]] as [TemplateId, number][]) : []),
      ];
    case "retention":
      return [
        ["retention.review", 1],
        ["retention.care_setup", 1],
      ];
  }
}

/** The one task each secondary priority adds, as supporting work: the most useful one for the records there are. */
function supporting(priority: Priority, s: Snapshot): TemplateId {
  switch (priority) {
    case "sales":
      return s.sales.openInquiries > 0 ? "sales.inquiry_follow_through" : "sales.faq_answers";
    case "pricing":
      return "sales.service_draft";
    case "booking":
      return "sales.booking_page";
    case "recruiter":
      return "recruiter.role_draft";
    case "dispatch":
      return "dispatch.coverage_review";
    case "retention":
      return s.retention.completedJobs + s.retention.activePlans > 0 ? "retention.review" : "retention.care_setup";
  }
}

/** The plan for this focus and these records. The same inputs always give the same plan. */
export function planFor(focus: Priority, secondary: Priority[], s: Snapshot): Planned[] {
  const chosen = new Map<TemplateId, number>();
  for (const [id, priority] of wanted(focus, s)) if (!chosen.has(id)) chosen.set(id, priority);
  for (const extra of secondary.filter((value) => value !== focus)) {
    const id = supporting(extra, s);
    if (!chosen.has(id)) chosen.set(id, 2);
  }
  // A dependency is always in the plan with what depends on it.
  for (const id of [...chosen.keys()]) for (const dep of TEMPLATES[id].dependsOn ?? []) if (!chosen.has(dep)) chosen.set(dep, chosen.get(id)!);

  const rows = [...chosen.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_TASKS)
    .map(([id, priority]) => describe(id, priority, s));
  // A dependency cut by the cap takes what depends on it with it.
  const kept = new Set(rows.map((row) => row.template));
  return rows.filter((row) => row.dependsOn.every((dep) => kept.has(dep)));
}

function describe(id: TemplateId, priority: number, s: Snapshot): Planned {
  const t = TEMPLATES[id];
  const base = {
    template: id,
    agent: t.agent,
    title: t.title,
    objective: t.objective(s),
    sources: t.sources(s),
    expectedOutput: t.expectedOutput(s),
    authority: t.authority(s),
    estimate: t.estimate(s),
    priority,
    dependsOn: t.dependsOn ?? [],
    completion: t.completion,
    kind: t.kind,
  };
  const plan = s.plan[t.agent];
  if (!plan.ok) return { ...base, prerequisites: [{ words: plan.words, met: false }], state: "unavailable", statusLine: "Not on your current plan.", blocker: { kind: "plan", words: plan.words, action: { label: "Choose a plan", href: "/app/settings/billing" } } };
  if (s.paused.includes(t.agent)) {
    return { ...base, prerequisites: [{ words: `${cap(t.agent)} is not paused.`, met: false }], state: "paused", statusLine: `${cap(t.agent)} is paused.`, blocker: { kind: "paused", words: `${cap(t.agent)} is paused, so it does nothing until you resume it.`, action: { label: `Resume ${cap(t.agent)}`, href: "/app/settings/agents" } } };
  }
  const gate = t.gate(s);
  const prerequisites = prerequisitesFor(id, s);
  if (gate) return { ...base, prerequisites, state: gate.state, statusLine: gate.statusLine, blocker: gate.blocker };
  return { ...base, prerequisites, state: "queued", statusLine: t.queuedLine };
}

const cap = (agent: Agent) => agent.charAt(0).toUpperCase() + agent.slice(1);

/** Each prerequisite as the owner can check it: the condition, and whether the record meets it now. */
export function prerequisitesFor(id: TemplateId, s: Snapshot): { words: string; met: boolean }[] {
  switch (id) {
    case "sales.faq_answers":
      return [{ words: "At least one confirmed company detail (areas, services or contact)", met: facts(s) > 0 }];
    case "sales.inquiry_follow_through":
      return [{ words: "Open inquiries on record", met: s.sales.openInquiries > 0 }];
    case "recruiter.applicant_review":
      return [
        { words: "A connected hiring inbox", met: s.recruiter.inbox === "connected" },
        { words: "A role applicants can be matched to", met: s.recruiter.openNeeds > 0 || s.recruiter.draftNeedId !== null },
      ];
    case "dispatch.coverage_review":
      return [
        { words: "Upcoming visits in the next two weeks", met: s.dispatch.upcomingJobs > 0 },
        { words: "A texting number for job offers", met: s.dispatch.canText },
      ];
    case "retention.review":
      return [{ words: "Customers or past visits on record", met: s.retention.completedJobs + s.retention.activePlans + s.retention.customers > 0 }];
    default:
      return [];
  }
}

/** Whether a blocked task can go now, re-read from fresh records. Returns the new gate, or null when clear. */
export function regate(id: TemplateId, s: Snapshot): ReturnType<Template["gate"]> | { state: "paused" | "unavailable"; blocker: Blocker; statusLine: string } {
  const t = TEMPLATES[id];
  const plan = s.plan[t.agent];
  if (!plan.ok) return { state: "unavailable", statusLine: "Not on your current plan.", blocker: { kind: "plan", words: plan.words, action: { label: "Choose a plan", href: "/app/settings/billing" } } };
  if (s.paused.includes(t.agent)) return { state: "paused", statusLine: `${cap(t.agent)} is paused.`, blocker: { kind: "paused", words: `${cap(t.agent)} is paused, so it does nothing until you resume it.`, action: { label: `Resume ${cap(t.agent)}`, href: "/app/settings/agents" } } };
  return t.gate(s);
}

/** The words for each state, for the cards. */
export const STATE_WORDS: Record<TaskState, string> = {
  queued: "Queued",
  working: "Working",
  ready_for_review: "Ready for review",
  waiting_info: "Waiting for information",
  waiting_connection: "Waiting for connection",
  completed: "Completed",
  failed: "Failed",
  paused: "Paused",
  canceled: "Canceled",
  unavailable: "Not on your plan",
};

/** Agents that exist in the catalog but whose own work is not built: named in the plan, never run. */
export const NOT_BUILT = [
  { name: "Marketing", words: "Campaign briefs and creative are not built as an agent workflow yet." },
  { name: "Quality", words: "Inspection checklists are not built as an agent workflow yet." },
  { name: "Business Development", words: "Account research is not built yet." },
];
