/**
 * Company → Integrations. Everyone in the company sees where each integration stands; only the Owner
 * starts one (the owner's decision of November 16, 2026).
 *
 * Built integrations are set up where they already live (Gmail under Recruiting rules, the texting
 * number under Compliance), so this only reports their state. A planned integration can be asked for:
 * the request is recorded for Selestial and promises no date.
 */
import { v } from "convex/values";

import { companyQuery, ownerMutation } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { BUILT, isIntegrationId } from "./lib/integrations";
import { googleApp } from "./lib/recruiter/gmail";
import { secretsConfigured } from "./lib/recruiter/secrets";

export type LiveState = "connected" | "in_progress" | "ready" | "not_set_up";

export const overview = companyQuery({
  args: {},
  handler: async (ctx) => {
    const mailboxes = await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .take(20);
    const gmail = mailboxes.find((row) => row.provider === "gmail" && row.status === "connected");
    const gmailState: LiveState = gmail ? "connected" : googleApp() !== null && (await secretsConfigured()) ? "ready" : "not_set_up";

    const texting = (
      await ctx.db
        .query("textingRequests")
        .withIndex("by_company_requested", (q) => q.eq("companyId", ctx.companyId))
        .order("desc")
        .take(1)
    )[0];
    const textingState: LiveState = !texting || ["failed", "rejected", "cancelled"].includes(texting.status) ? "ready" : texting.status === "active" ? "connected" : "in_progress";

    const requests = await ctx.db
      .query("integrationRequests")
      .withIndex("by_company_integration", (q) => q.eq("companyId", ctx.companyId))
      .take(100);
    return {
      live: {
        gmail: { state: gmailState, detail: gmail ? gmail.address : null },
        "texting-number": { state: textingState, detail: texting?.status === "active" ? (texting.phoneNumber ?? null) : null },
      },
      requested: requests.map((row) => ({ integrationId: row.integrationId, requestedAt: row.requestedAt })),
    };
  },
});

/** The Owner asks Selestial for an integration that is not built yet. Asking twice keeps the first request. */
export const request = ownerMutation({
  args: { integrationId: v.string() },
  handler: async (ctx, args) => {
    if (!isIntegrationId(args.integrationId)) notFound();
    if (BUILT.includes(args.integrationId)) throw userError("This one is already built. Set it up from its card.");
    const existing = await ctx.db
      .query("integrationRequests")
      .withIndex("by_company_integration", (q) => q.eq("companyId", ctx.companyId).eq("integrationId", args.integrationId))
      .unique();
    if (existing) return { requestedAt: existing.requestedAt, repeated: true };
    const requestedAt = Date.now();
    await ctx.db.insert("integrationRequests", { companyId: ctx.companyId, integrationId: args.integrationId, requestedBy: ctx.member._id, requestedAt });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "integration.requested", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { integrationId: args.integrationId } });
    return { requestedAt, repeated: false };
  },
});
