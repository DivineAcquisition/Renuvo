/**
 * Whether each launch agent can work for this company, read from the record at this moment. Finishing
 * setup makes no agent "active": an agent is ready when the things it needs exist.
 *
 * Five questions are kept apart and answered in this order, so the owner is told the real reason:
 * is it built, does the plan include it, is it paused, is a connection missing, is information missing.
 */
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { agentVerdict } from "../billing/access";
import { readiness as complianceReadiness } from "../compliance/readiness";
import { AGENT_PROFILES } from "../departments";
import { readProfile } from "../compliance/profile";
import { textingByAgent } from "../texting/readiness";

export type AgentState = "ready_to_work" | "waiting_for_information" | "connection_needed" | "plan_needed" | "paused" | "not_available";
export type Gap = { kind: "plan" | "connection" | "information"; words: string; next: string; href: string };
export type AgentReadiness = { agent: "sales" | "recruiter" | "dispatch" | "retention"; name: string; state: AgentState; words: string; gaps: Gap[] };

export const STATE_WORDS: Record<AgentState, string> = {
  ready_to_work: "Ready to work",
  waiting_for_information: "Waiting for information",
  connection_needed: "Connection needed",
  plan_needed: "Plan needed",
  paused: "Paused",
  not_available: "Not available yet",
};

async function count(ctx: QueryCtx, company: Doc<"companies">) {
  const companyId = company._id;
  const now = Date.now();
  const services = await ctx.db
    .query("services")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active"))
    .take(1);
  const readyCleaners = await ctx.db
    .query("cleaners")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "ready"))
    .take(1);
  const upcomingJobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "scheduled").gt("startsAt", now))
    .take(1);
  const needs = await ctx.db
    .query("hiringNeeds")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "open"))
    .take(1);
  return { services: services.length, readyCleaners: readyCleaners.length, upcomingJobs: upcomingJobs.length, needs: needs.length };
}

export async function agentReadiness(ctx: QueryCtx, company: Doc<"companies">): Promise<AgentReadiness[]> {
  const have = await count(ctx, company);
  const sending = await complianceReadiness(ctx, company);
  const smsReady = sending.operations.find((row) => row.key === "sms")?.state === "ready";
  const canEmail = sending.operations.find((row) => row.key === "email")?.state === "ready";
  // Texting is per agent: an agent can text only what the company's registration covers for its audience.
  const profile = await readProfile(ctx, company._id);
  const request = await ctx.db
    .query("textingRequests")
    .withIndex("by_company_requested", (q) => q.eq("companyId", company._id))
    .order("desc")
    .first();
  const texting = textingByAgent(profile.messaging, request);
  const textsFor = (agent: AgentReadiness["agent"]) => smsReady && texting.some((row) => row.agent === agent && (row.state === "ready" || row.state === "partly"));
  const sender: Gap = { kind: "connection", words: "No texting number or sending email address is set up, so nothing can be sent to anyone.", next: "Set up business texting", href: "/app/texting" };

  const needs: Record<AgentReadiness["agent"], Gap[]> = {
    sales: [
      ...(have.services ? [] : [{ kind: "information" as const, words: "No service is published yet, so Sales cannot give a firm price. It can still take quote requests.", next: "Prepare your first service", href: "/app/services" }]),
      ...(textsFor("sales") || canEmail ? [] : [sender]),
    ],
    dispatch: [
      ...(have.upcomingJobs ? [] : [{ kind: "information" as const, words: "There are no upcoming jobs to cover.", next: "Add a job", href: "/app/schedule" }]),
      ...(have.readyCleaners ? [] : [{ kind: "information" as const, words: "No cleaner is ready for assignments yet.", next: "Add your cleaners", href: "/app/cleaners" }]),
      ...(textsFor("dispatch") ? [] : [{ ...sender, words: smsReady ? "Your texting registration doesn't include texts to cleaners, so job offers can't reach them." : "No texting number is set up, so job offers cannot reach cleaners." }]),
    ],
    recruiter: [
      ...(have.needs ? [] : [{ kind: "information" as const, words: "No hiring need is open, so there is nothing to recruit for.", next: "Describe who you are hiring", href: "/app/agents/recruiter" }]),
      ...(canEmail || textsFor("recruiter") ? [] : [sender]),
    ],
    retention: [...(canEmail || textsFor("retention") ? [] : [{ ...sender, words: "No texting number or email is set up, so feedback requests and case updates cannot reach customers." }])],
  };

  return (["sales", "dispatch", "recruiter", "retention"] as const).map((agent) => {
    const name = AGENT_PROFILES[agent].name;
    if (!AGENT_PROFILES[agent].built) return { agent, name, state: "not_available", words: `${name}'s own work is not built yet. Nothing is prepared or sent in its name.`, gaps: [] };
    const plan = agentVerdict(company, agent);
    const rank = { plan: 0, connection: 1, information: 2 } as const;
    const gaps: Gap[] = [...(plan.ok ? [] : [{ kind: "plan" as const, words: plan.message, next: "Choose a plan", href: "/app/settings/billing" }]), ...needs[agent]].sort((a, b) => rank[a.kind] - rank[b.kind]);
    if (company.pausedAgents.includes(agent)) return { agent, name, state: "paused", words: `${name} is paused. It does nothing until you resume it.`, gaps };
    if (gaps.length === 0) return { agent, name, state: "ready_to_work", words: `${name} has what it needs. Anything that reaches a customer, an applicant or a cleaner still follows the permissions you set.`, gaps };
    // The first gap names the state: a plan before a connection, a connection before missing information.
    const first = gaps[0];
    const state = first.kind === "plan" ? "plan_needed" : first.kind === "connection" ? "connection_needed" : "waiting_for_information";
    return { agent, name, state, words: gaps.length === 1 ? `One thing is needed before ${name} can work.` : `${gaps.length} things are needed before ${name} can work.`, gaps };
  });
}
