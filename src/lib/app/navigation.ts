/**
 * Selestial's navigation, defined once.
 *
 * This file is the information architecture: the three departments, the eight agents inside them, each
 * agent's work tabs, and the company-wide destinations around them. The sidebar, breadcrumbs, active
 * highlighting and deep-link handling are all derived from it (see navigation-helpers.ts). Nothing else
 * may keep its own copy of this structure.
 *
 * It is the full plan, not a claim about what is built. Every destination says how available it is, and
 * src/lib/app/navigation.test.ts checks those claims against the pages that actually exist.
 *
 * The document that explains it: docs/foundation/01-navigation.md.
 */

import { SETTINGS_SECTIONS } from "./settings";

// ── Identifiers. Stable, used in URLs and stored state. Display labels are separate and may change. ──

export const DEPARTMENT_IDS = ["growth", "operations", "team"] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

export const AGENT_IDS = ["marketing", "sales", "retention", "dispatch", "quality", "customer-care", "recruiter", "team-coordinator"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** The agents the Convex backend knows today (convex/lib/statuses.ts). The other four have no record yet. */
export type BackendAgent = "sales" | "recruiter" | "dispatch" | "retention";

export type Role = "owner" | "manager" | "office";

// ── Availability ────────────────────────────────────────────────────────────────────────────────────

/**
 * How available a destination is right now.
 *
 * live: a page exists at the destination's own path and does the job.
 * interim: no page at its own path yet, but an existing page serves it in whole or part. `missing`
 *   says what that page does not yet do. Links go to `servedBy` until the real page exists.
 * planned: not built. `notice` means a page already sits at the path, but it only says what is coming (for an
 * agent: what it will do, and a request for early access). It never presents the thing as working.
 *   A planned destination is never linked as if it worked.
 */
export type Availability = { status: "live" } | { status: "interim"; servedBy: string; missing: string } | { status: "planned"; notice?: true };

export type Destination = {
  /** The destination's own path. For a planned or interim destination this is the proposed route. */
  path: string;
  availability: Availability;
  /**
   * The least role that may open it, for showing or hiding the link. "undecided" means the owner has not
   * said, and it is then shown to the Owner only. This is not authorization: every read and write is
   * checked again in Convex.
   */
  minimumRole: Role | "undecided";
  accessNote?: string;
};

const LIVE: Availability = { status: "live" };
const PLANNED: Availability = { status: "planned" };
/** Not built, with a page that says what it will be (a coming-soon agent). */
const COMING_SOON_PAGE: Availability = { status: "planned", notice: true };
const interim = (servedBy: string, missing: string): Availability => ({ status: "interim", servedBy, missing });

// ── Routes ──────────────────────────────────────────────────────────────────────────────────────────

/** Everything signed-in lives under this prefix. Home is the landing page for every workspace. */
export const APP_ROOT = "/app";
export const LANDING_PATH = APP_ROOT;

/** An agent's overview, and its work tabs beneath it. Two dynamic routes will serve all eight agents. */
export const agentPath = (agent: AgentId) => `${APP_ROOT}/agents/${agent}`;
export const tabPath = (agent: AgentId, tab: string) => `${agentPath(agent)}/${tab}`;

// ── Sidebar layout ──────────────────────────────────────────────────────────────────────────────────

/** The sidebar's sections, top to bottom. The order is fixed. */
export const SIDEBAR_SECTIONS = ["business", "departments", "persistent", "agents", "shared", "footer"] as const;
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];

/** A new workspace opens with Operations selected in the sidebar, on the Home page. */
export const DEFAULT_DEPARTMENT: DepartmentId = "operations";

export type Department = { id: DepartmentId; label: string };

/** The three tabs at the top of the sidebar. They are departments, not lifecycle stages. */
export const DEPARTMENTS: readonly Department[] = [
  { id: "growth", label: "Growth" },
  { id: "operations", label: "Operations" },
  { id: "team", label: "Team" },
];

// ── Company-wide items ──────────────────────────────────────────────────────────────────────────────

export type NavItemId = "home" | "approvals" | "inbox" | "search" | "chat" | "services" | "customers" | "cleaners" | "agreements" | "finance" | "reports" | "settings";

export type NavItem = Destination & {
  id: NavItemId;
  label: string;
  section: "persistent" | "shared" | "footer";
  /** What the destination is for, in a sentence. */
  purpose: string;
  /** Other paths that belong to this destination and highlight it, such as Chat's full history. */
  alsoAt?: readonly string[];
};

/** Visible whichever department is selected. They are company-wide and never filtered by department. */
export const PERSISTENT_ITEMS: readonly NavItem[] = [
  { id: "home", label: "Home", section: "persistent", purpose: "The company-wide operational overview.", path: APP_ROOT, availability: LIVE, minimumRole: "office" },
  {
    id: "approvals",
    label: "Approvals",
    section: "persistent",
    purpose: "Decisions from every department, in one queue.",
    path: `${APP_ROOT}/approvals`,
    availability: LIVE,
    minimumRole: "office",
    accessNote: "Owners and Managers decide approvals. Office sees only the tasks handed to a person.",
  },
  {
    id: "inbox",
    label: "Inbox",
    section: "persistent",
    purpose: "Customer and cleaner communications. Conversations with AI agents are not here.",
    path: `${APP_ROOT}/inbox`,
    availability: { status: "planned", notice: true },
    minimumRole: "office",
  },
  { id: "search", label: "Search", section: "persistent", purpose: "Find business records, jobs, conversations and tasks.", path: `${APP_ROOT}/search`, availability: PLANNED, minimumRole: "office" },
];

/**
 * Company-wide records and results, below the agents. They are the same records the agent workspaces
 * read: an agent tab is a view over these, never a second copy.
 */
export const SHARED_ITEMS: readonly NavItem[] = [
  {
    id: "chat",
    label: "Chat",
    section: "shared",
    purpose: "The company's general assistant: ask, analyze, draft documents and request supported work, without choosing an agent first.",
    path: `${APP_ROOT}/chat`,
    availability: LIVE,
    minimumRole: "office",
    accessNote: "Each chat is private to the person who started it. What chat may change is checked in Convex against that person's role and each agent's authority.",
    alsoAt: [`${APP_ROOT}/chats`],
  },
  {
    id: "services",
    label: "Services & Pricing",
    section: "shared",
    purpose: "The services the company sells, how each is priced, what it earns, and every change to them, reviewed before it goes live.",
    path: `${APP_ROOT}/services`,
    availability: LIVE,
    minimumRole: "office",
    accessNote: "Everyone reads the catalog. Owners and Managers draft and submit changes. Only the Owner approves and publishes, and only the Owner sees costs and profitability. Not Selestial's own plans or credits, which are under Settings › Plan & Usage.",
  },
  {
    id: "customers",
    label: "Clients & Properties",
    section: "shared",
    purpose: "The company's clients, their properties, the services they have, and everything about each relationship.",
    path: `${APP_ROOT}/clients`,
    alsoAt: [`${APP_ROOT}/customers`],
    availability: LIVE,
    minimumRole: "office",
    accessNote: "Everyone reads and adds clients. Access instructions and private notes are for Owners and Managers. Archiving is the Owner's or a Manager's. Billing is the Owner's, as in Finance.",
  },
  {
    id: "cleaners",
    label: "Cleaners",
    section: "shared",
    purpose: "The workforce and the ongoing relationship with each person: who is ready, who is free, who needs attention, and why.",
    path: `${APP_ROOT}/cleaners`,
    availability: LIVE,
    minimumRole: "office",
    accessNote: "Everyone reads the directory and profiles. Owners and Managers add, import and change records and request personnel changes. Pay is the Owner's alone, and documents are shown to whoever reviews them (docs/cleaners/00-architecture.md).",
  },
  {
    id: "agreements",
    label: "Agreements",
    section: "shared",
    purpose: "The company's own customer, workforce and business agreements: build them with Selestial, start from a template or upload one, review, send for signature and keep them through renewal.",
    path: `${APP_ROOT}/agreements`,
    availability: LIVE,
    minimumRole: "office",
    accessNote: "Customer documents are open to everyone who works customers. Workforce documents are the Owner's and Managers', and pay or classification documents are the Owner's alone. Selestial's own terms are under Settings › Selestial Terms & Agreements.",
  },
  {
    id: "finance",
    label: "Finance",
    section: "shared",
    purpose: "The cleaning company's own money: customer payments, balances, cleaner pay. Not Selestial's subscription.",
    path: `${APP_ROOT}/finance`,
    availability: LIVE,
    minimumRole: "owner",
    accessNote: "The Owner only, by the owner's decision on November 15, 2026. Invoices, payments, credits, refunds, Team Pay and Expenses are built; Profitability is shown as not built yet.",
  },
  {
    id: "reports",
    label: "Reports",
    section: "shared",
    purpose: "Business results and agent performance.",
    path: `${APP_ROOT}/reports`,
    availability: interim(`${APP_ROOT}/insights`, "Everything beyond the weekly measures: agent performance, longer periods, breakdowns."),
    minimumRole: "office",
  },
];

/** One footer item. Business rules, agent permissions, integrations, notifications and platform billing live inside it. */
export const FOOTER_ITEMS: readonly NavItem[] = [
  {
    id: "settings",
    label: "Settings",
    section: "footer",
    purpose: "Business hours and services, people, agent permissions and rules, connections, security, compliance and Selestial's own plans.",
    path: `${APP_ROOT}/settings`,
    availability: LIVE,
    minimumRole: "office",
    accessNote: "Anyone in the company can read it. Only the Owner changes company details, people, authority and billing.",
  },
];

export const NAV_ITEMS: readonly NavItem[] = [...PERSISTENT_ITEMS, ...SHARED_ITEMS, ...FOOTER_ITEMS];

/** Pages inside Settings. They have no sidebar entry: Settings links to them. They are derived from the settings catalog (settings.ts), the one place they are defined. */
export const SETTINGS_PAGES: readonly { path: string; label: string; purpose: string }[] = SETTINGS_SECTIONS.map(({ path, label, purpose }) => ({ path, label, purpose }));

/** Pages inside Agreements. The first six are its navigation; the rest are reached from them. They have no sidebar entry of their own. */
export const AGREEMENT_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/agreements/all`, label: "All Agreements", purpose: "Every agreement the person may read, searchable and filterable." },
  { path: `${APP_ROOT}/agreements/templates`, label: "Templates", purpose: "Selestial's starting texts and the company's own approved templates." },
  { path: `${APP_ROOT}/agreements/templates/[id]`, label: "Template", purpose: "One company template: its clauses, versions, review and defaults." },
  { path: `${APP_ROOT}/agreements/awaiting-signatures`, label: "Awaiting Signatures", purpose: "Documents out for signature, with each signer's status." },
  { path: `${APP_ROOT}/agreements/renewals`, label: "Renewals & Changes", purpose: "Agreements approaching renewal or expiry, and amendments in progress." },
  { path: `${APP_ROOT}/agreements/archive`, label: "Archive", purpose: "Agreements set aside. They are kept, not deleted." },
  { path: `${APP_ROOT}/agreements/new`, label: "New agreement", purpose: "Build with Selestial, use a template, or upload an agreement." },
  { path: `${APP_ROOT}/agreements/[id]`, label: "Agreement", purpose: "One agreement: its document, parties, terms, versions, review and signatures, and activity." },
];

/** Pages inside Services & Pricing. The first four are its tabs; the rest are reached from them. They have no sidebar entry of their own. */
/** Company setup: a full-screen guided start for the Owner, outside the sidebar. Reached at company creation and from Home. */
export const SETUP_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/setup`, label: "Set up your company", purpose: "The Owner confirms the company's details, chooses what Selestial helps with first, and opens the workspace." },
  { path: `${APP_ROOT}/first-work`, label: "Your first work", purpose: "Where setup lands: what is prepared, what waits for a decision, what agents sent, and one next step." },
];

/** Pages inside Sales that are not tabs: the booking and proposal workspace and its entry point. */
export const SALES_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/agents/sales/new`, label: "New booking or proposal", purpose: "Starts a workspace draft from Sales, a customer or Dispatch, with what they know filled in." },
  { path: `${APP_ROOT}/agents/sales/book/[draftId]`, label: "Booking workspace", purpose: "Book one-time or recurring service, or prepare a commercial, office or short-term rental proposal." },
  { path: `${APP_ROOT}/agents/sales/setups/[setupId]`, label: "Service setup", purpose: "After a proposal is accepted: the agreement, billing, and each site's access and start." },
  { path: `${APP_ROOT}/agents/sales/plans/[planId]`, label: "Recurring plan", purpose: "One recurring plan: upcoming visits, staffing, billing, agreement, exceptions and history, and changes to a visit or the series." },
];

export const SERVICES_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/services/studio`, label: "Pricing Studio", purpose: "Test example jobs against live or draft services: price, time, crew, costs and what remains." },
  { path: `${APP_ROOT}/services/research`, label: "Research & Insights", purpose: "Research briefs: what was found, what is comparable, what is uncertain, with every source." },
  { path: `${APP_ROOT}/services/research/[id]`, label: "Research brief", purpose: "One brief, its findings labeled by kind, and its sources." },
  { path: `${APP_ROOT}/services/changes`, label: "Changes", purpose: "Every change waiting for review, scheduled or published, and the history of each service." },
  { path: `${APP_ROOT}/services/changes/[id]`, label: "Change", purpose: "One change: what it changes, prices before and after, evidence, specialists' checks, approval." },
  { path: `${APP_ROOT}/services/new`, label: "New service", purpose: "Build with Selestial, use a template, import existing pricing, or add a service." },
  { path: `${APP_ROOT}/services/setup`, label: "Pricing setup", purpose: "What the company told setup: areas, team, costs, margin and strategy." },
  { path: `${APP_ROOT}/services/imports/[id]`, label: "Import review", purpose: "Rows read from a spreadsheet or pasted text, each reviewed before it becomes a draft." },
  { path: `${APP_ROOT}/services/[id]`, label: "Service", purpose: "One service: the guided builder for its draft, its live version and its history." },
];

/** Pages inside Finance, reached from it. They have no sidebar entry of their own. */
export const FINANCE_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/finance/setup`, label: "Payments setup", purpose: "The company's own Stripe account, its invoice settings (tax, terms, numbering), pay tiers, tips and expense categories." },
];

/** Pages inside Sales › Booking Forms. The list links to each experience's builder. */
export const BOOKING_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/agents/sales/booking-forms/[id]`, label: "Booking experience", purpose: "One booking experience: its live preview, its words, look and behavior, test bookings, versions and publishing." },
];

/** Pages inside Cleaners. They have no sidebar entry of their own: the directory links to them. */
export const CLEANER_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/cleaners/[id]/[[...section]]`, label: "Cleaner", purpose: "One person's profile, each section at its own address: overview, availability and jobs, onboarding and documents, skills and equipment, performance and coaching, pay, and activity." },
  { path: `${APP_ROOT}/cleaners/import`, label: "Import cleaners", purpose: "Bring in a list, with every row reviewed for duplicates before anything is written." },
  { path: `${APP_ROOT}/cleaners/onboarding`, label: "Onboarding checklist", purpose: "What each kind of worker needs, what an unmet item holds up, who reviews it and how long it stays valid." },
  { path: `${APP_ROOT}/cleaners/crews`, label: "Crews", purpose: "Permanent crews with a lead, the team for each upcoming job, and a crew builder that checks each person for one job." },
  { path: `${APP_ROOT}/cleaners/subcontractors`, label: "Subcontractor companies", purpose: "Companies that supply their own cleaners: their contact, their workers, and the contact's access to their own workers." },
];

/** Pages inside Clients & Properties. The directory links to them. */
export const CLIENT_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/clients/[id]/[[...section]]`, label: "Client", purpose: "One client: Overview, Properties (and each property at its own address), Services, Conversations, Documents and Billing." },
];

/** Pages that belong to Chat: one conversation, and the searchable history of every chat. They have no sidebar entry of their own. */
export const CHAT_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/chat/[id]`, label: "Chat", purpose: "One conversation, with its drafts and actions." },
  { path: `${APP_ROOT}/chats`, label: "All chats", purpose: "Every chat the person started, searchable and paged." },
];

// ── Agents and their work tabs ──────────────────────────────────────────────────────────────────────

export type WorkTab = Destination & {
  /** Unique within its agent. Used as the last URL segment. */
  id: string;
  label: string;
};

export type AgentNav = {
  id: AgentId;
  label: string;
  department: DepartmentId;
  /** What this agent owns, in one sentence. Ownership must not overlap another agent's. */
  responsibility: string;
  /** The backend's id for this agent, when the backend has one. Null means it exists only in this plan. */
  backendAgent: BackendAgent | null;
  /**
   * built: at least one workflow runs. planned: nothing runs. This must match the backend's catalog
   * (convex/lib/departments.ts); the test checks it.
   */
  workflow: "built" | "planned";
  /** The page the agent's name opens. */
  overview: Destination;
  /** The nested work tabs, in order. Playbook is always last. Chat is never a tab. */
  tabs: readonly WorkTab[];
};

type TabSpec = [id: string, label: string, availability?: Availability];

function agent(spec: { id: AgentId; label: string; department: DepartmentId; responsibility: string; backendAgent: BackendAgent | null; workflow?: "built"; overview?: Availability; tabs: TabSpec[] }): AgentNav {
  return {
    id: spec.id,
    label: spec.label,
    department: spec.department,
    responsibility: spec.responsibility,
    backendAgent: spec.backendAgent,
    workflow: spec.workflow ?? "planned",
    // An agent with no workflow yet still has a page: what it will do, and a request for early access.
    overview: { path: agentPath(spec.id), availability: spec.overview ?? (spec.workflow === "built" ? PLANNED : COMING_SOON_PAGE), minimumRole: "office" },
    tabs: spec.tabs.map(([id, label, availability]) => ({ id, label, path: tabPath(spec.id, id), availability: availability ?? PLANNED, minimumRole: "office" })),
  };
}

/**
 * The eight agents, in sidebar order within each department. Names, order and tabs are the owner's.
 *
 * Two pairs of names are close on purpose and must stay distinct:
 * - Customer Setup (Customer Care) is about customers. Onboarding (Team Coordinator) is about cleaners.
 * - Offers & Agreements (Recruiter) is about hiring. Offers & Coverage (Dispatch) is about job assignments.
 */
export const AGENTS: readonly AgentNav[] = [
  // Growth
  agent({
    id: "marketing",
    label: "Marketing",
    department: "growth",
    responsibility: "Generates customer interest.",
    backendAgent: null,
    tabs: [
      ["campaigns", "Campaigns"],
      ["content-creative", "Content & Creative", LIVE],
      ["promotions", "Promotions"],
      ["lead-sources", "Lead Sources"],
      ["performance", "Performance"],
      ["playbook", "Playbook"],
    ],
  }),
  agent({
    id: "sales",
    label: "Sales",
    department: "growth",
    responsibility: "Turns inquiries into confirmed bookings.",
    backendAgent: "sales",
    workflow: "built",
    overview: LIVE,
    tabs: [
      ["pipeline", "Pipeline", LIVE],
      ["quotes-proposals", "Quotes & Proposals", LIVE],
      ["follow-ups", "Follow-ups", LIVE],
      // Texts and emails only. The address keeps its first name so links already shared still open.
      ["calls-messages", "Conversations", LIVE],
      ["booking-forms", "Booking Forms", LIVE],
      ["playbook", "Playbook", LIVE],
    ],
  }),
  agent({
    id: "retention",
    label: "Retention",
    department: "growth",
    responsibility: "Notices when a customer relationship needs attention, coordinates the response, and verifies what happened afterward.",
    backendAgent: "retention",
    workflow: "built",
    overview: LIVE,
    // The owner's structure of November 18, 2026: the work is organised by what it does for the relationship.
    tabs: [
      ["needs-attention", "Needs Attention", LIVE],
      ["recovery", "Recovery", LIVE],
      ["continuity-renewals", "Continuity & Renewals", LIVE],
      ["re-engagement", "Re-engagement", LIVE],
      ["playbook", "Playbook", LIVE],
    ],
  }),

  // Operations
  agent({
    id: "dispatch",
    label: "Dispatch",
    department: "operations",
    responsibility: "Staffs jobs, manages scheduling and coverage, and monitors service progress.",
    backendAgent: "dispatch",
    workflow: "built",
    overview: LIVE,
    tabs: [
      ["dispatch-board", "Dispatch Board", LIVE],
      ["schedule", "Schedule", LIVE],
      ["offers-coverage", "Offers & Coverage", LIVE],
      ["live-jobs", "Live Jobs", LIVE],
      ["action-links", "Action Links", LIVE],
      ["playbook", "Playbook", LIVE],
    ],
  }),
  agent({
    id: "quality",
    label: "Quality",
    department: "operations",
    responsibility: "Reviews service evidence, investigates issues, and coordinates corrective work.",
    backendAgent: null,
    tabs: [
      ["completion-review", "Completion Review"],
      ["checklists-photos", "Checklists & Photos"],
      ["service-issues", "Service Issues"],
      ["re-cleans", "Re-cleans"],
      ["playbook", "Playbook"],
    ],
  }),
  agent({
    id: "customer-care",
    label: "Customer Care",
    department: "operations",
    responsibility: "Handles customer communications, setup, requests, and scheduling changes.",
    backendAgent: null,
    tabs: [
      ["conversations", "Conversations"],
      ["customer-setup", "Customer Setup"],
      ["service-requests", "Service Requests"],
      ["rescheduling-cancellations", "Rescheduling & Cancellations"],
      ["playbook", "Playbook"],
    ],
  }),

  // Team
  agent({
    id: "recruiter",
    label: "Recruiter",
    department: "team",
    responsibility: "Manages candidate acquisition, screening, interviews, and hiring offers.",
    backendAgent: "recruiter",
    workflow: "built",
    overview: LIVE,
    tabs: [
      ["hiring-needs", "Hiring Needs", LIVE],
      ["applicants", "Applicants", LIVE],
      ["screening", "Screening", LIVE],
      ["interviews", "Interviews", LIVE],
      ["offers-agreements", "Offers & Agreements", LIVE],
      ["playbook", "Playbook", LIVE],
    ],
  }),
  agent({
    id: "team-coordinator",
    label: "Team Coordinator",
    department: "team",
    responsibility: "Manages cleaner onboarding, documentation, training, readiness, and ongoing availability.",
    backendAgent: null,
    tabs: [
      ["onboarding", "Onboarding"],
      ["documents-training", "Documents & Training"],
      ["readiness", "Readiness"],
      ["availability", "Availability"],
      ["team-check-ins", "Team Check-ins"],
      ["playbook", "Playbook"],
    ],
  }),
];

// ── Routes that exist today and are not a destination's own path ────────────────────────────────────

/**
 * Pages built before this structure. They keep working. Each says what replaces it, so it can be moved
 * or redirected on purpose when the new sidebar is built, and so no page is left unaccounted for.
 */
export const EXISTING_ROUTES: readonly { pattern: string; today: string; becomes: string }[] = [
  { pattern: `${APP_ROOT}/decisions`, today: "Redirects to Approvals.", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/records`, today: "Redirects to Clients & Properties.", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/customers`, today: "Redirects to Clients & Properties (renamed November 18, 2026), keeping its search.", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/team`, today: "Redirects to Settings, where agent permissions and pause now live.", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/schedule`, today: "Redirects to Dispatch › Schedule.", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/settings/services`, today: "Redirects to Services & Pricing (moved out of Settings on November 16, 2026).", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/integrations`, today: "Redirects to Settings › Integrations (moved November 16, 2026).", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/settings/connections`, today: "Redirects to Settings › Integrations (Connections was folded in on November 16, 2026).", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/insights`, today: "The week's measures.", becomes: "Reports, at /app/reports, with a redirect from here." },
  {
    pattern: `${APP_ROOT}/departments/[department]`,
    today: "A workspace per department. Nothing links to it now that Dispatch has its own screens.",
    becomes: "Nothing directly. Departments are sidebar tabs and have no page; the content moves to agent workspaces.",
  },
];

// ── Badges ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * What an agent or tab may show beside its name. A badge states something a person can act on, in
 * words ("2 unfilled", "3 to review"), never a count of activity. Kinds are listed most important first.
 * No badge is defined here with a value: values come from the record at the time the sidebar is drawn.
 */
export const BADGE_KINDS = ["urgent", "decision", "attention", "working"] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

export type Badge = {
  kind: BadgeKind;
  /** The words shown and read aloud, for example "2 unfilled". Status never depends on color alone. */
  label: string;
  count?: number;
};
