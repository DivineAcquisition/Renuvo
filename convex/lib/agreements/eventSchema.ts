import { v } from "convex/values";

/** A provider's report, after the webhook has parsed and verified it. */
export const eventSchema = v.object({
  eventId: v.string(),
  requestId: v.string(),
  type: v.union(v.literal("delivered"), v.literal("viewed"), v.literal("signed"), v.literal("declined"), v.literal("completed"), v.literal("expired"), v.literal("bounced"), v.literal("failed")),
  signerEmail: v.optional(v.string()),
  at: v.number(),
  problem: v.optional(v.string()),
});
