/**
 * Early-access requests from the public site. Only the Selestial web server can call `request`: it holds
 * PUBLIC_FORM_SECRET. The answer says plainly whether the request was saved, so the page never reports
 * success for one that was not.
 */
import { v } from "convex/values";

import { internalQuery } from "./_generated/server";
import { serverMutation } from "./lib/builders";
import { allow } from "./lib/rateLimit";
import { isEmail } from "./lib/text";

export const FOCUS = ["Sales", "Recruiting", "Dispatch", "Retention"] as const;
type Focus = (typeof FOCUS)[number];

const HOUR = 60 * 60 * 1000;
/** One visitor (the web server passes a hash of their address, never the address). */
export const PER_VISITOR_PER_HOUR = 5;
/** Everyone together, so a flood from many addresses still stops. */
export const TOTAL_PER_HOUR = 300;

export type EarlyAccessResult = { status: "saved" } | { status: "invalid" } | { status: "limited" };

export const request = serverMutation({
  args: {
    name: v.string(),
    email: v.string(),
    company: v.string(),
    focus: v.string(),
    visitorKey: v.string(),
  },
  handler: async (ctx, args): Promise<EarlyAccessResult> => {
    const name = args.name.trim();
    const email = args.email.trim().toLowerCase();
    const company = args.company.trim();
    const focus = FOCUS.find((option) => option === args.focus) as Focus | undefined;
    if (!name || name.length > 120 || !company || company.length > 160 || !isEmail(email) || !focus) return { status: "invalid" };

    const visitorKey = args.visitorKey.trim().slice(0, 128) || "unknown";
    if (!(await allow(ctx, `early-access:visitor:${visitorKey}`, PER_VISITOR_PER_HOUR, HOUR))) return { status: "limited" };
    if (!(await allow(ctx, "early-access:all", TOTAL_PER_HOUR, HOUR))) return { status: "limited" };

    const now = Date.now();
    const existing = await ctx.db
      .query("earlyAccessRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) {
      // The same person asking again keeps one row with their latest answers. They are told it is saved, which it is.
      await ctx.db.patch(existing._id, { name, company, focus, requests: existing.requests + 1, lastRequestedAt: now });
      return { status: "saved" };
    }
    await ctx.db.insert("earlyAccessRequests", { name, email, company, focus, source: "selestial-landing", requests: 1, createdAt: now, lastRequestedAt: now });
    return { status: "saved" };
  },
});

/** For the team, from the Convex dashboard or `npx convex run earlyAccess:list`. Not callable from a browser. */
export const list = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("earlyAccessRequests").order("desc").take(500),
});
