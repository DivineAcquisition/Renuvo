/**
 * Settings: the company's own rules, read and written in one place.
 *
 * Business settings (name, time zone, areas, hours, services) are one document with a revision: a save
 * must name the revision it started from, so a stale browser tab reloads instead of overwriting. The
 * other agent settings keep their own functions (permissions.ts, dispatch.ts, dispatchOps.ts,
 * recruiter.ts) and are not revision-protected here.
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { companyQuery, ownerMutation, ownerQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { describeEvents } from "./lib/eventWords";
import { connectionList } from "./lib/settings/connections";
import { businessSettingsOf, hoursWindowValidator, hoursKey, normalizeBusiness, revisionOf, servicesKey, serviceValidator, validTimezone } from "./lib/settings/business";
import { text } from "./lib/text";

export const STALE = "These settings were changed somewhere else since you opened them. Reload to see the latest, then make your changes again.";

/** The business settings any member can read. Only the Owner changes them. */
export const business = companyQuery({
  args: {},
  handler: async (ctx) => {
    const settings = businessSettingsOf(ctx.company);
    return {
      revision: revisionOf(ctx.company),
      name: ctx.company.name,
      timezone: ctx.company.timezone,
      serviceAreas: settings.serviceAreas,
      hours: settings.hours,
      services: settings.services,
      /** True once the Owner has saved any business rule. Before that, nothing is restricted. */
      configured: ctx.company.businessSettings !== undefined,
      canEdit: ctx.role === "owner",
    };
  },
});

/**
 * Saves the whole business draft or nothing. It names the revision it was read at; a different revision
 * means someone saved since, and the draft is refused. A draft that normalizes to what is already saved
 * writes nothing and does not move the revision.
 */
export const saveBusiness = ownerMutation({
  args: {
    expectedRevision: v.number(),
    name: v.string(),
    timezone: v.string(),
    serviceAreas: v.array(v.string()),
    hours: v.array(hoursWindowValidator),
    services: v.array(serviceValidator),
  },
  handler: async (ctx, args) => {
    const revision = revisionOf(ctx.company);
    if (args.expectedRevision !== revision) throw userError(STALE);
    const current = businessSettingsOf(ctx.company);
    // Every part is checked before anything is written.
    const name = text(args.name, "Company name", 160);
    const timezone = validTimezone(args.timezone);
    const next = normalizeBusiness(args, current);

    const sections: string[] = [];
    if (name !== ctx.company.name) sections.push("name");
    if (timezone !== ctx.company.timezone) sections.push("time zone");
    if (JSON.stringify(next.serviceAreas) !== JSON.stringify(current.serviceAreas)) sections.push("areas");
    if (hoursKey(next.hours) !== hoursKey(current.hours)) sections.push("hours");
    if (servicesKey(next.services) !== servicesKey(current.services)) sections.push("services");
    if (sections.length === 0) return { revision, changed: false };

    await ctx.db.patch(ctx.companyId, { name, timezone, businessSettings: next, settingsRevision: revision + 1 });
    await recordEvent(ctx, {
      companyId: ctx.companyId,
      type: "company.business_settings_changed",
      actor: byMember(ctx),
      subject: { table: "companies", id: ctx.companyId },
      data: { sections: sections.join(", "), revision: revision + 1 },
    });
    return { revision: revision + 1, changed: true };
  },
});

/** What this deployment is connected to. No credentials, and no claim that an outside service is reachable. */
export const connections = companyQuery({
  args: {},
  handler: async (ctx) => {
    const mailboxes = await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .take(20);
    // Evidence that sending really works: a recent message the provider confirmed as delivered.
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_company_queued", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(300);
    const deliveredAt = (channel: "sms" | "email") => recent.find((row) => (row.channel ?? "sms") === channel && row.status === "delivered")?.deliveredAt ?? null;
    return {
      checkedLive: false as const,
      note: "This shows what the deployment is set up to use. It does not test any outside service.",
      connections: connectionList({ mailboxes: mailboxes.map((row) => ({ provider: row.provider, status: row.status })) }),
      delivered: { email: deliveredAt("email"), sms: deliveredAt("sms") },
    };
  },
});

/** The company's own history, newest first, in words. The Owner only. Events hold ids and small facts, never message text. */
export const activity = ownerQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("events")
      .withIndex("by_company_at", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .paginate(args.paginationOpts);
    const described = await describeEvents(ctx, ctx.company, result.page, Date.now());
    return {
      ...result,
      page: described.map((row) => ({ id: row.id, at: row.at, type: row.type, actor: row.actor.label, actorKind: row.actor.kind, text: row.text, described: row.described })),
    };
  },
});
