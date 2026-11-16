/**
 * Renewal and expiry reminders. A reminder opens a task for a person ("decide on this renewal"); it never
 * renews, extends, reprices or ends anything. A renewal or price change is a new draft that goes through
 * review, approval and signing like any other, started by a person.
 */
import { internalMutation } from "./_generated/server";
import { localParts } from "./lib/availability";
import { recordEvent } from "./lib/events";
import { addDays } from "./lib/agreements/store";
import { openTask } from "./lib/taskState";

const DAY = 24 * 60 * 60 * 1000;
const LEAD_DAYS = 30;

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    let opened = 0;
    const companies = await ctx.db.query("companies").take(500);
    for (const company of companies) {
      if (company.suspendedAt) continue;
      const today = localParts(Date.now(), company.timezone).day;
      const horizon = addDays(today, LEAD_DAYS);
      const rows = await ctx.db
        .query("agreements")
        .withIndex("by_company_renewal", (q) => q.eq("companyId", company._id).gte("lifecycle.renewalOn", "0").lte("lifecycle.renewalOn", horizon))
        .take(200);
      for (const agreement of rows) {
        const l = agreement.lifecycle;
        if (agreement.archivedAt || l.terminatedOn || l.supersededBy || !l.renewalOn) continue;
        if (agreement.workflow !== "signed" && agreement.provenance === "unsigned") continue;
        const key = `agreement-renewal:${agreement._id}:${l.renewalOn}`;
        const earlier = await ctx.db.query("tasks").withIndex("by_company_key", (q) => q.eq("companyId", company._id).eq("key", key)).first();
        if (earlier) continue;
        // A restricted document's name does not appear in a task a wider group can read.
        const named = agreement.access === "company" ? `"${agreement.title}"` : "an agreement";
        const renews = agreement.terms.autoRenew === true;
        await openTask(ctx, {
          companyId: company._id,
          agent: agreement.category === "customer" || agreement.category === "supporting" ? "retention" : "recruiter",
          title: `Decide on the end of term for ${named}`.slice(0, 200),
          nextAction: `Open Agreements and decide: ${renews ? "it is set to renew; confirm, change or end it" : "it ends; renew it, replace it, or let it end"}. Selestial will not renew it for you.`,
          dueAt: new Date(`${l.renewalOn}T12:00:00Z`).getTime() > Date.now() ? new Date(`${l.renewalOn}T12:00:00Z`).getTime() : Date.now() + DAY,
          completionCondition: "A person has decided, and any renewal or amendment is its own signed document.",
          key,
          actor: { kind: "system" },
        });
        await recordEvent(ctx, { companyId: company._id, type: "agreement.renewal_reminder", actor: { kind: "system" }, subject: { table: "agreements", id: agreement._id }, data: { renewalOn: l.renewalOn } });
        opened += 1;
      }
    }
    return opened;
  },
});
