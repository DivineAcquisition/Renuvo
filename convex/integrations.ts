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
import { enabledFeatures, type Feature } from "./lib/google/features";
import { activeConnection } from "./lib/google/connection";
import { mapsServerKey } from "./lib/google/platform";
import type { Doc } from "./_generated/dataModel";
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

    // A Google card is connected only when its permission was granted and something it needs was checked with Google.
    const google = await activeConnection(ctx, ctx.companyId);
    const resources: Doc<"googleResources">[] = google ? await ctx.db.query("googleResources").withIndex("by_connection", (q) => q.eq("connectionId", google._id)).take(200) : [];
    const granted = google?.status === "connected" ? enabledFeatures(google.grantedScopes) : [];
    const googleReady = googleApp() !== null && (await secretsConfigured());
    const googleCard = (feature: Feature, kinds: Doc<"googleResources">["kind"][]): { state: LiveState; detail: string | null } => {
      if (!granted.includes(feature)) return { state: google?.status === "expired" ? "in_progress" : googleReady ? "ready" : "not_set_up", detail: google?.status === "expired" ? "Reconnect needed" : null };
      const verified = resources.filter((r) => kinds.includes(r.kind) && r.access === "verified");
      return verified.length ? { state: "connected", detail: verified.map((r) => r.label).slice(0, 2).join(", ") } : { state: "in_progress", detail: "Choose what Selestial may use" };
    };

    const requests = await ctx.db
      .query("integrationRequests")
      .withIndex("by_company_integration", (q) => q.eq("companyId", ctx.companyId))
      .take(100);
    return {
      live: {
        gmail: { state: gmailState, detail: gmail ? gmail.address : null },
        "google-drive": googleCard("drive", ["drive_source", "drive_output"]),
        "google-calendar": googleCard("calendar", ["calendar_sync", "calendar_busy"]),
        "google-business-profile": googleCard("business_profile", ["business_location"]),
        "google-ads": googleCard("ads", ["ads_account"]),
        "google-local-services-ads": googleCard("ads", ["ads_account"]),
        "google-maps-travel": { state: (mapsServerKey() ? "connected" : "not_set_up") as LiveState, detail: null },
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
