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
 * planned: not built. `notice` means a page already sits at the path, but it only says "not built yet".
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

export type NavItemId = "home" | "approvals" | "inbox" | "search" | "chat" | "customers" | "cleaners" | "agreements" | "finance" | "reports" | "settings";

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
    id: "customers",
    label: "Customers & Properties",
    section: "shared",
    purpose: "Customers and the properties they have service at.",
    path: `${APP_ROOT}/customers`,
    availability: LIVE,
    minimumRole: "office",
    accessNote: "A list and an add form so far. A page for each customer, with their properties and service history, is still to build.",
  },
  {
    id: "cleaners",
    label: "Cleaners",
    section: "shared",
    purpose: "The people who do the work: standing, skills, areas and availability.",
    path: `${APP_ROOT}/cleaners`,
    availability: LIVE,
    minimumRole: "office",
    accessNote: "Pay rates are shown to the Owner only. A list and an add form so far; a page for each cleaner is still to build.",
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
    accessNote: "The Owner only, by the owner's decision on November 15, 2026. Invoices, payments, credits, refunds and Team Pay are built; Expenses and Profitability are shown as not built yet.",
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

/** Pages inside Finance, reached from it. They have no sidebar entry of their own. */
export const FINANCE_PAGES: readonly { path: string; label: string; purpose: string }[] = [
  { path: `${APP_ROOT}/finance/setup`, label: "Payments setup", purpose: "The company's own Stripe account, its invoice settings (tax, terms, numbering), pay tiers and tips." },
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
    overview: { path: agentPath(spec.id), availability: spec.overview ?? PLANNED, minimumRole: "office" },
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
    tabs: [
      ["pipeline", "Pipeline"],
      ["quotes-proposals", "Quotes & Proposals"],
      ["follow-ups", "Follow-ups"],
      ["calls-messages", "Calls & Messages"],
      ["booking-forms", "Booking Forms"],
      ["playbook", "Playbook"],
    ],
  }),
  agent({
    id: "retention",
    label: "Retention",
    department: "growth",
    responsibility: "Maintains recurring relationships, follows up on risk, and runs win-back and referral workflows.",
    backendAgent: "retention",
    tabs: [
      ["recurring-customers", "Recurring Customers"],
      ["customer-health", "Customer Health"],
      ["feedback-reviews", "Feedback & Reviews"],
      ["recurring-offers", "Recurring Offers"],
      ["win-back", "Win-back"],
      ["referrals", "Referrals"],
      ["playbook", "Playbook"],
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
  { pattern: `${APP_ROOT}/records`, today: "Redirects to Customers & Properties.", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/team`, today: "Redirects to Settings, where agent permissions and pause now live.", becomes: "Removed once old links have had time to move." },
  { pattern: `${APP_ROOT}/schedule`, today: "Redirects to Dispatch › Schedule.", becomes: "Removed once old links have had time to move." },
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
