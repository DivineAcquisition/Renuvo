/**
 * Selestial's plans and what each one includes: the one place that maps a plan to agents and platform
 * features. Autumn (with Stripe underneath) is the authority on which plan a company has; this file only
 * says what that plan means, and which agents are released at all.
 *
 * Five separate questions decide whether a piece of agent work may run (convex/lib/billing/access.ts):
 * is the agent released, does the company's verified plan include it, may this person ask for it, are
 * there enough credits, and is what it needs connected. Buying credits answers only the fourth. A plan
 * never answers the first.
 */
import { AGENT_PROFILES } from "../departments";

export const PLAN_IDS = ["operate", "expand"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** The Autumn ids. Stable: never renamed, so a subscription made today still means the same plan. */
export const AUTUMN = {
  credits: "selestial_credits",
  topUpPlan: "credit_top_up",
  /** The prepaid messaging balance, in units of $0.0001. One-off grants: it never resets with the monthly credits. */
  messaging: "messaging_balance",
  /** One-off purchase of messaging funds, priced $0.0001 per unit, bought in any validated quantity. */
  messagingTopUpPlan: "messaging_top_up",
  plans: { operate: "operate", expand: "expand" } as Record<PlanId, string>,
} as const;

export const AGENT_IDS = ["sales", "retention", "recruiter", "dispatch", "marketing", "quality", "customer-care", "team-coordinator"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_CATALOG: Record<AgentId, { name: string; department: "growth" | "operations" | "team"; plans: readonly PlanId[] }> = {
  sales: { name: "Sales", department: "growth", plans: ["operate", "expand"] },
  retention: { name: "Retention", department: "growth", plans: ["operate", "expand"] },
  recruiter: { name: "Recruiter", department: "team", plans: ["operate", "expand"] },
  dispatch: { name: "Dispatch", department: "operations", plans: ["operate", "expand"] },
  marketing: { name: "Marketing", department: "growth", plans: ["expand"] },
  quality: { name: "Quality", department: "operations", plans: ["expand"] },
  "customer-care": { name: "Customer Care", department: "operations", plans: ["expand"] },
  "team-coordinator": { name: "Team Coordinator", department: "team", plans: ["expand"] },
};

/**
 * Whether the agent does its work today, from what is actually implemented (checked November 16, 2026):
 *
 *   dispatch    released: offers, coverage, live jobs and cleaner action links run end to end.
 *   recruiter   released: the hiring inbox, invitations, applicant pages, screening, interviews, offers
 *               and onboarding handoff run end to end, with its own screens under Team › Recruiter.
 *   sales, retention, marketing, quality, customer-care, team-coordinator   not released: no workflow.
 *
 * Quality's photo and video review and Marketing's creative requests run in Chat today, but those agents
 * are not released, so (the owner's decision of November 16, 2026) nobody gets them until they are.
 */
const RELEASED: Record<AgentId, boolean> = {
  dispatch: AGENT_PROFILES.dispatch.built,
  recruiter: AGENT_PROFILES.recruiter.built,
  sales: AGENT_PROFILES.sales.built,
  retention: AGENT_PROFILES.retention.built,
  marketing: false,
  quality: false,
  "customer-care": false,
  "team-coordinator": false,
};

export function agentReleased(agent: AgentId): boolean {
  return RELEASED[agent];
}

/** Platform features that differ by plan. Everything not listed here is in both plans. */
export const PLAN_FEATURES = {
  customer_portal: { name: "Customer portal", plans: ["expand"], built: false },
  /** The company's own domain (for example book.theircompany.com) for booking pages, instead of link.selestial.io. */
  custom_domain: { name: "Your own domain for booking pages", plans: ["expand"], built: false },
  advanced_workflows: { name: "Advanced workflow customization", plans: ["expand"], built: false },
  advanced_approvals: { name: "Advanced approval routing", plans: ["expand"], built: true },
  template_governance: { name: "Agreement template governance", plans: ["expand"], built: true },
  team_governance: { name: "Advanced team and location governance", plans: ["expand"], built: false },
  /** Image and video generation: Marketing's work, Expand only (the owner's decision of November 16, 2026). */
  creative_studio: { name: "Creative Studio", plans: ["expand"], built: true },
} as const satisfies Record<string, { name: string; plans: readonly PlanId[]; built: boolean }>;
export type PlanFeature = keyof typeof PLAN_FEATURES;

export const PLANS: Record<PlanId, { name: string; monthlyCents: number; positioning: string; summary: string }> = {
  operate: {
    name: "Operate",
    monthlyCents: 299_00,
    positioning: "Run your essential cleaning operations with four AI agents.",
    summary: "Keep sales, hiring, dispatch, and retention moving from one workspace.",
  },
  expand: {
    name: "Expand",
    monthlyCents: 499_00,
    positioning: "Extend your AI workforce with eight agents and advanced company controls.",
    summary: "Add marketing, quality, customer care, and team coordination, with customer portals and advanced controls.",
  },
};

/** In both plans. Credits pay for the AI work inside them, not for the features. */
export const BOTH_PLANS_INCLUDE = [
  "Company Chat",
  "Customer, applicant, cleaner and job records",
  "Standard scheduling and operational workflows",
  "Cleaner text-message action pages (offers, acceptance, jobs, delays, evidence)",
  "Agreements storage and templates",
  "AI-guided agreement drafting, using credits",
  "Review and signature workflows, where built",
  "Standard reporting and activity history",
  "Essential permissions, security and audit history",
] as const;

export function planIncludesAgent(plan: PlanId | null, agent: AgentId): boolean {
  return plan !== null && AGENT_CATALOG[agent].plans.includes(plan);
}

export function planIncludesFeature(plan: PlanId | null, feature: PlanFeature): boolean {
  return plan !== null && (PLAN_FEATURES[feature].plans as readonly PlanId[]).includes(plan);
}

export function planIdFromAutumn(planId: string | null | undefined): PlanId | null {
  return (PLAN_IDS as readonly string[]).includes(planId ?? "") ? (planId as PlanId) : null;
}

/** What moving from one plan to another removes, for the confirmation before a downgrade. */
export function lostOnChange(from: PlanId, to: PlanId): { agents: string[]; features: string[] } {
  return {
    agents: AGENT_IDS.filter((agent) => planIncludesAgent(from, agent) && !planIncludesAgent(to, agent)).map((agent) => AGENT_CATALOG[agent].name),
    features: (Object.keys(PLAN_FEATURES) as PlanFeature[]).filter((feature) => planIncludesFeature(from, feature) && !planIncludesFeature(to, feature)).map((feature) => PLAN_FEATURES[feature].name),
  };
}
