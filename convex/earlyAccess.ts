/**
 * Requests for an operations assessment from the public site: seven answers about the business and how
 * to reach the person. Only the Selestial web server can call `request`: it holds
 * PUBLIC_FORM_SECRET. The answer says plainly whether the request was saved, so the page never reports
 * success for one that was not.
 */
import { v } from "convex/values";

import { internalQuery } from "./_generated/server";
import { serverMutation } from "./lib/builders";
import { checkedAnswers, HELP_FOCUS, phoneOk, websiteOk } from "./lib/assessment";
import { allow } from "./lib/rateLimit";
import { isEmail } from "./lib/text";


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
    role: v.string(),
    businessType: v.string(),
    cleaners: v.string(),
    monthlyCleans: v.string(),
    bookingTool: v.string(),
    help: v.string(),
    openTo: v.string(),
    phone: v.string(),
    website: v.string(),
    /** The separate, optional box: "you may text me at this number". */
    smsConsent: v.optional(v.boolean()),
    visitorKey: v.string(),
  },
  handler: async (ctx, args): Promise<EarlyAccessResult> => {
    const name = args.name.trim();
    const email = args.email.trim().toLowerCase();
    const company = args.company.trim();
    const phone = args.phone.trim();
    const website = args.website.trim();
    const answers = checkedAnswers({ role: args.role, businessType: args.businessType, cleaners: args.cleaners, monthlyCleans: args.monthlyCleans, bookingTool: args.bookingTool, help: args.help, openTo: args.openTo });
    if (!name || name.length > 120 || !company || company.length > 160 || !isEmail(email) || !answers || !phoneOk(phone) || !websiteOk(website)) return { status: "invalid" };
    const focus = HELP_FOCUS[answers.help];

    const visitorKey = args.visitorKey.trim().slice(0, 128) || "unknown";
    if (!(await allow(ctx, `early-access:visitor:${visitorKey}`, PER_VISITOR_PER_HOUR, HOUR))) return { status: "limited" };
    if (!(await allow(ctx, "early-access:all", TOTAL_PER_HOUR, HOUR))) return { status: "limited" };

    const now = Date.now();
    // Consent to texts is recorded only when the box was ticked, and is dropped again if a later request leaves it unticked.
    const details = { ...answers, focus, phone, website, smsConsentAt: args.smsConsent === true ? now : undefined };
    const existing = await ctx.db
      .query("earlyAccessRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) {
      // The same person asking again keeps one row with their latest answers. They are told it is saved, which it is.
      await ctx.db.patch(existing._id, { name, company, ...details, requests: existing.requests + 1, lastRequestedAt: now });
      return { status: "saved" };
    }
    await ctx.db.insert("earlyAccessRequests", { name, email, company, ...details, source: "selestial-landing", requests: 1, createdAt: now, lastRequestedAt: now });
    return { status: "saved" };
  },
});

/** For the team, from the Convex dashboard or `npx convex run earlyAccess:list`. Not callable from a browser. */
export const list = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("earlyAccessRequests").order("desc").take(500),
});
