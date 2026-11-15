/**
 * Departments organize the business; agents work inside them. This catalog is the one place that says
 * which agent belongs where, so a new agent is added here and appears everywhere without a redesign.
 */
import { literals, type Agent } from "./statuses";

export const DEPARTMENT_IDS = ["sales", "operations", "customer_success"] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];
export const departmentValidator = literals(DEPARTMENT_IDS);

export type Department = { id: DepartmentId; name: string; purpose: string; agents: readonly Agent[] };

export const DEPARTMENTS: readonly Department[] = [
  { id: "sales", name: "Sales", purpose: "Give every inquiry a timely, honest path to a decision.", agents: ["sales"] },
  { id: "operations", name: "Operations", purpose: "Keep the team ready and every visit covered.", agents: ["recruiter", "dispatch"] },
  { id: "customer_success", name: "Customer Success", purpose: "Earn repeat business through consistent care.", agents: ["retention"] },
];

/** `built` is false until the agent's first workflow exists. Screens say "not built yet" instead of showing an idle agent. */
export const AGENT_PROFILES: Record<Agent, { name: string; responsibility: string; completion: string; built: boolean }> = {
  sales: {
    name: "Sales",
    responsibility: "Inquiries, quotes, follow-ups and bookings.",
    completion: "A suitable booking the company can fulfill, a clear decline, or a documented next step.",
    built: false,
  },
  recruiter: {
    name: "Recruiter",
    responsibility: "Applicants, interviews and onboarding.",
    completion: "An owner-approved cleaner ready for appropriate work, with availability and onboarding confirmed.",
    built: false,
  },
  dispatch: {
    name: "Dispatch",
    responsibility: "Assignments, coverage and service status.",
    completion: "An accepted assignment, communicated expectations and verified service status, with exceptions resolved or escalated.",
    built: true,
  },
  retention: {
    name: "Retention",
    responsibility: "Feedback, service concerns and recurring service.",
    completion: "Feedback addressed, service issues followed through, and an appropriate next service agreed.",
    built: false,
  },
};

export function departmentOf(agent: Agent): Department {
  const found = DEPARTMENTS.find((department) => department.agents.includes(agent));
  if (!found) throw new Error(`Agent ${agent} has no department`);
  return found;
}
