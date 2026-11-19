/**
 * Retention in Chat. Chat reads the retention cases a member can see, and runs Retention's own six
 * tools on one case (convex/lib/retention/tools.ts): the same functions the case's buttons run, with the
 * same checks, each use kept in `toolRuns` and on the case's history.
 *
 * Chat never sends to a customer, books a visit, credits an invoice or changes a plan from here. A tool
 * that prepares something leaves it on the case, where the Owner's authority settings route it.
 */
import type { Id } from "../../_generated/dataModel";
import { KIND_WORDS, SEGMENT_WORDS, STATUS_WORDS, addEntry } from "../retention/cases";
import { runCaseTool, TOOL_NAMES, TOOL_WORDS, type ToolName } from "../retention/tools";
import type { ChatTool, Outcome, ToolCtx } from "./tools";

const refused = (why: string): Outcome => ({ status: "refused", why });
const CASE = { type: "string" as const, description: "The retention case's id.", max: 64 };

async function caseOf(ctx: ToolCtx, value: unknown) {
  const id = typeof value === "string" ? ctx.db.normalizeId("retentionCases", value) : null;
  const row = id ? await ctx.db.get(id) : null;
  return row && row.companyId === ctx.company._id ? row : null;
}

const DESCRIPTIONS: Record<ToolName, string> = {
  explain_attention: "Explain why one retention case needs attention: what the customer said, what the record shows, what is a hypothesis, and what is not known. Keep those apart when you answer.",
  prepare_recovery_plan: "Prepare the next step on a service-recovery case from its diagnosis: a correction visit with its estimated cost, a scope explanation, an inspection or a handoff. It is prepared on the case and routed by the Owner's permissions; nothing is booked or sent by this tool.",
  show_original_scope: "Show what one visit was booked to include and exclude, the checklist items about the area the customer reported, the company's guarantee if it has written one, and signed terms about corrections.",
  find_correction_visit: "Find open times for a correction visit at the case's property over the next 7 days, from the same capacity check a booking uses, with the likely cost in crew pay when the records support one. A time is held only when a visit is approved and booked.",
  draft_response: "Draft a reply to the customer about a retention case, saying only what the record supports. The draft is saved on the case for a person to edit and submit. Nothing is sent.",
  review_after_correction: "Review what happened after a correction: whether the visit was completed, what the customer answered, whether the next ordinary service repeated the problem, and what it cost. A completed correction is not a confirmed recovery.",
};

const caseTool = (tool: ToolName): ChatTool => ({
  name: `retention_${tool}`,
  label: TOOL_WORDS[tool],
  description: DESCRIPTIONS[tool],
  kind: tool === "prepare_recovery_plan" || tool === "draft_response" ? "draft" : "read",
  minimumRole: "office",
  specialist: "retention",
  input: { type: "object", properties: { caseId: CASE } },
  run: async (ctx, args) => {
    const row = await caseOf(ctx, args.caseId);
    if (!row) return refused("No such retention case in this company.");
    const key = `chat:${ctx.idempotencyKey}`;
    const earlier = await ctx.db
      .query("toolRuns")
      .withIndex("by_company_key", (q) => q.eq("companyId", ctx.company._id).eq("idempotencyKey", key))
      .first();
    const link = { href: `/app/agents/retention/needs-attention?case=${row._id as Id<"retentionCases">}`, label: "Open the case" };
    if (earlier) {
      const kept = JSON.parse(earlier.result) as { title: string; lines: string[] };
      return { status: earlier.outcome === "refused" ? "refused" : earlier.outcome, why: kept.lines[0] ?? "", summary: kept.title, data: { lines: kept.lines, repeated: true }, link } as Outcome;
    }
    const actor = { kind: "member" as const, memberId: ctx.member._id };
    const result = await runCaseTool(ctx, ctx.company, row, tool, actor);
    await ctx.db.insert("toolRuns", { companyId: ctx.company._id, tool, idempotencyKey: key, actor, authorization: `${result.authorization}; asked for in Company Chat`, input: JSON.stringify({ caseId: row._id }), outcome: result.outcome, result: JSON.stringify({ title: result.title, lines: result.lines, data: result.data }).slice(0, 12_000), caseId: row._id, jobId: row.jobId, at: Date.now() });
    await addEntry(ctx, row, { kind: "agent", text: `${result.title} (from Chat): ${result.lines[0] ?? ""}`.slice(0, 600), actor });
    if (result.outcome === "refused") return refused(result.lines[0] ?? "Retention could not do that.");
    return { status: result.outcome, summary: `${result.title}: ${row.title}`, data: { lines: result.lines, ...result.data }, link };
  },
});

export const RETENTION_TOOLS: ChatTool[] = [
  {
    name: "list_retention_cases",
    label: "Reading Retention's open cases",
    description: "The open retention cases: who, which property, what happened, what Selestial is doing, what needs a person, and when it is due. A relationship with no open case has 'no known open issues', which says nothing about whether the customer is satisfied.",
    kind: "read",
    minimumRole: "office",
    specialist: "retention",
    input: { type: "object", properties: { customerId: { type: "string", optional: true, max: 64, description: "Only this client's cases." } } },
    run: async (ctx, args) => {
      const customerId = typeof args.customerId === "string" ? ctx.db.normalizeId("customers", args.customerId) : null;
      const rows = [];
      for (const status of ["needs_attention", "needs_context", "action_underway", "waiting_on_customer", "monitoring"] as const) {
        rows.push(...(await ctx.db.query("retentionCases").withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", status)).take(60)));
      }
      const shown = rows.filter((row) => !customerId || row.customerId === customerId).slice(0, 40);
      return {
        status: "done",
        summary: `${shown.length} open retention ${shown.length === 1 ? "case" : "cases"}`,
        data: {
          cases: shown.map((row) => ({ caseId: row._id, kind: KIND_WORDS[row.kind], segment: SEGMENT_WORDS[row.segment], status: STATUS_WORDS[row.status], title: row.title, happened: row.happened, doing: row.doing, needs: row.needs ?? null, dueAt: row.dueAt, seriousConcernForAPerson: row.serious !== undefined, heldByAPerson: row.heldBy !== undefined })),
          note: shown.length ? undefined : "No known open issues. That is what the record shows; it is not a statement about how any customer feels.",
        },
        link: { href: "/app/agents/retention", label: "Open Retention" },
      };
    },
  },
  ...TOOL_NAMES.map(caseTool),
];
