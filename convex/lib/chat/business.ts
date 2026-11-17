/**
 * What Chat always knows about the business, the person and the conversation's starting point, read fresh
 * from the company's records for every reply. It sits in the system prompt rather than in the
 * conversation, so it holds however long a conversation runs: only the last messages reach the model, but
 * this is rebuilt each time. Amounts the Owner keeps private (pay, costs, margin targets for anyone but
 * the Owner) are never in it; tools give them to the Owner.
 */
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import type { Role } from "../roles";
import { businessSettingsOf } from "../settings/business";
import { priceSummary, usualLaborMinutes } from "../services/engine";
import { CATEGORY_LABELS } from "../services/spec";
import { publishedCatalog } from "../services/store";
import { minutesWords } from "../services/words";

/** Company data is typed by people; it is quoted, shortened and kept on one line. */
const clip = (text: string, max: number) => text.replace(/\s+/g, " ").replace(/[<>]/g, "").trim().slice(0, max);
const words = (value: string) => value.replace(/_/g, " ");

const TEAM = { solo: "the owner cleans alone", one_crew: "one crew", several_crews: "several crews" } as const;
const PAY = { hourly: "hourly", per_visit: "per visit", revenue_share: "a share of the price", mixed: "a mix of pay models" } as const;
const STRATEGY = { cost_plus: "cost-plus (costs plus a target margin)", positioning: "positioning-led", market: "market-led" } as const;
const COST_WORDS: Record<string, string> = {
  pay: "pay",
  suppliesPerVisitCents: "supplies",
  travelPerVisitCents: "travel",
  equipmentPerVisitCents: "equipment",
  laundryPerLoadCents: "laundry",
  paymentFeePercent: "card fees",
  overheadPerVisitCents: "overhead",
};

/** The business as its records describe it now: where it works, what it sells, how its team works, and what setup left open. */
export async function businessContext(ctx: QueryCtx, company: Doc<"companies">, role: Role): Promise<string> {
  const lines: string[] = [];
  const settings = businessSettingsOf(company);
  const profile = await ctx.db
    .query("pricingProfiles")
    .withIndex("by_company", (q) => q.eq("companyId", company._id))
    .first();
  const c = profile?.context ?? null;

  const areas = clip(c?.serviceAreas ?? "", 300);
  const postal = settings.serviceAreas;
  lines.push(`- Areas served: ${areas || "not given in pricing setup"}${postal.length ? `. Booking is limited to ${postal.length} postal code${postal.length === 1 ? "" : "s"}${postal.length <= 15 ? ` (${postal.join(", ")})` : ""}` : ""}.`);
  if (c?.customerKinds.length) lines.push(`- Customers: ${c.customerKinds.map(words).join(", ")}.`);

  const live = await publishedCatalog(ctx, company._id);
  if (live.length) {
    lines.push("- Services on sale (live versions in Services & Pricing):");
    for (const { service, version } of live.slice(0, 20)) {
      const spec = version.spec;
      lines.push(`  - ${clip(service.name, 80)} (${CATEGORY_LABELS[spec.category]}, version ${version.version}): ${priceSummary(spec)}; usual crew of ${spec.team.crewSize}, about ${minutesWords(usualLaborMinutes(spec))} of labor.`);
    }
    if (live.length > 20) lines.push(`  - and ${live.length - 20} more; list_services has them all.`);
  } else {
    lines.push("- Services on sale: none published yet in Services & Pricing.");
  }
  const drafts = (
    await ctx.db
      .query("services")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "draft"))
      .take(20)
  ).map((row) => clip(row.name, 60));
  if (drafts.length) lines.push(`- Drafts not live yet: ${drafts.join(", ")}.`);

  let working = 0;
  for (const status of ["ready", "onboarding"] as const) {
    working += (
      await ctx.db
        .query("cleaners")
        .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", status))
        .take(500)
    ).length;
  }
  const team = [c?.teamStructure ? TEAM[c.teamStructure] : null, working ? `${working} cleaner${working === 1 ? "" : "s"} on record` : c?.cleaners ? `about ${c.cleaners} cleaners (setup)` : null, c?.compensation ? `paid ${PAY[c.compensation]}` : null].filter(Boolean);
  if (team.length) lines.push(`- Team: ${team.join("; ")}.`);

  if (c) {
    const job = [c.typicalSizes ? `typical homes ${clip(c.typicalSizes, 120)}` : null, c.typicalVisitMinutes ? `about ${minutesWords(c.typicalVisitMinutes)} on site` : null, c.bookingsPerWeek ? `${c.bookingsPerWeek} bookings a week` : null, c.capacityPerWeek ? `room for ${c.capacityPerWeek} a week` : null].filter(Boolean);
    if (job.length) lines.push(`- Typical work: ${job.join("; ")}.`);
    if (c.currentServices.trim()) lines.push(`- What setup said they sell: ${clip(c.currentServices, 300)}.`);
    if (c.notes.trim()) lines.push(`- Notes from setup: ${clip(c.notes, 300)}.`);
    if (c.unsure.length) lines.push(`- Not known yet (setup answered "I'm not sure"): ${c.unsure.map(words).join(", ")}.`);
  }
  if (profile) {
    const approach = [profile.strategy ? STRATEGY[profile.strategy] : null, profile.positioning ? `${profile.positioning} positioning` : null].filter(Boolean);
    if (approach.length) lines.push(`- Pricing approach: ${approach.join(", ")}.`);
    const costs = profile.costs as Record<string, unknown>;
    const entered = Object.keys(COST_WORDS).filter((key) => costs[key] !== null && costs[key] !== undefined);
    const missing = Object.keys(COST_WORDS).filter((key) => !entered.includes(key));
    lines.push(`- Costs in pricing setup: ${entered.length ? `${entered.map((key) => COST_WORDS[key]).join(", ")} entered` : "none entered"}${missing.length ? `; not entered: ${missing.map((key) => COST_WORDS[key]).join(", ")}` : ""}. Amounts come only from the pricing tools, and only the Owner sees them.`);
    if (role === "owner" && (profile.costs.targetMarginPercent !== null || profile.costs.floorMarginPercent !== null)) lines.push(`- The Owner's margins: ${[profile.costs.targetMarginPercent !== null ? `target ${profile.costs.targetMarginPercent}%` : null, profile.costs.floorMarginPercent !== null ? `floor ${profile.costs.floorMarginPercent}%` : null].filter(Boolean).join(", ")}.`);
  } else {
    lines.push("- Pricing setup has not been done yet (Services & Pricing › Setup).");
  }
  return lines.join("\n");
}

const ROLE_SCOPE: Record<Role, string> = {
  owner: "They approve and publish prices, and see costs, pay and margins.",
  manager: "They draft services and submit them for the Owner's review. They do not see pay, costs or margins, and cannot publish.",
  office: "They read services and prices and create visits. They do not draft services, and do not see pay, costs or margins.",
};

/** Who is asking, and what their role lets them do. */
export function personContext(member: Doc<"members">, role: Role, timezone: string): string {
  const since = new Date(member.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: timezone });
  return `- ${clip(member.name, 80)}, the company's ${role}, in Selestial since ${since}. ${ROLE_SCOPE[role]}`;
}

/**
 * Where this conversation started and the research it has started, so the thread is never lost when
 * its first messages scroll out of the window.
 */
export async function conversationFocus(ctx: QueryCtx, conversation: Doc<"conversations">): Promise<string | null> {
  const lines: string[] = [];
  if (conversation.origin?.kind === "research") lines.push(`- It began in Services & Pricing › Research & Insights, with the question: "${clip(conversation.origin.question, 500)}". Keep helping with that research unless the person moves on.`);
  const briefs = await ctx.db
    .query("researchBriefs")
    .withIndex("by_company_conversation", (q) => q.eq("companyId", conversation.companyId).eq("conversationId", conversation._id))
    .order("desc")
    .take(10);
  for (const brief of briefs) {
    const state = brief.state === "ready" ? `ready, ${brief.findings.length} finding${brief.findings.length === 1 ? "" : "s"}` : brief.state === "queued" || brief.state === "running" ? "still researching" : brief.state;
    lines.push(`- Research brief ${brief._id} started here: "${clip(brief.question, 200)}" (${brief.mode === "web" ? "web research" : "your sources and records"}; ${state}). Read it with read_research_brief.`);
  }
  return lines.length ? lines.join("\n") : null;
}
