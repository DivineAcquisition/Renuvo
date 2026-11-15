/** Reads what an agent may do with one action right now. Every agent tool will ask this before it runs. */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { actionDef, initialLevel, PERSON_ONLY, type Level } from "./permissionCatalog";

export type Authority =
  | { kind: "person_only" }
  | { kind: "unknown" }
  | { kind: "paused" }
  | { kind: "level"; level: Level; perActionCents?: number; perDayCents?: number };

export async function authorityFor(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, action: string): Promise<Authority> {
  if (PERSON_ONLY.some((entry) => entry.key === action)) return { kind: "person_only" };
  const def = actionDef(action);
  // An action that is not in the catalog is never allowed. It is not treated as Off, which an owner could change.
  if (!def) return { kind: "unknown" };
  const company = await ctx.db.get(companyId);
  if (!company) return { kind: "unknown" };
  if (company.pausedAgents.includes(def.agent)) return { kind: "paused" };
  const row = await ctx.db
    .query("permissions")
    .withIndex("by_company_action", (q) => q.eq("companyId", companyId).eq("action", action))
    .unique();
  if (!row) return { kind: "level", level: initialLevel(def) };
  return { kind: "level", level: row.level, perActionCents: row.perActionCents, perDayCents: row.perDayCents };
}
