import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { enqueue } from "./jobs";

/** Shorthand for queueing a job for a company's connection. */
export function enquire(ctx: MutationCtx, companyId: Id<"companies">, connectionId: Id<"googleConnections">, kind: Doc<"googleJobs">["kind"], key: string, payload: Record<string, unknown>, requestedBy?: Id<"members">) {
  return enqueue(ctx, { companyId, connectionId, kind, key, payload, requestedBy });
}
