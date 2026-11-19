/**
 * A cleaning company's public texting pages: its privacy policy, its texting terms and its texting sign-up
 * form (convex/lib/texting/pages.ts). Reading is a `publicQuery` (reviewed in convex/lib/guard.ts): it
 * returns only a published page's own words and the company's public name and look, never a draft, a
 * record or a member. Signing up is a `serverMutation`: only Selestial's web server calls it, with
 * PUBLIC_FORM_SECRET and a keyed hash of the visitor's network address for rate limits.
 *
 * A sign-up records each permission with the exact wording version the page showed, where it was given,
 * when, and who gave it. The text box and the marketing box are separate and both start unchecked.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { publicQuery, serverMutation } from "./lib/builders";
import { activeSuppressions, setPermission } from "./lib/compliance/permissions";
import { normalAddress, recipientsAt } from "./lib/compliance/recipients";
import { allow } from "./lib/rateLimit";
import { usPhone } from "./lib/texting/checks";
import { currentPage, hostedLinks } from "./lib/texting/pages";

async function companyByHandle(ctx: QueryCtx, handle: string) {
  if (handle.length > 60) return null;
  const settings = await ctx.db
    .query("bookingSettings")
    .withIndex("by_handle", (q) => q.eq("handle", handle.trim().toLowerCase()))
    .unique();
  if (!settings?.handle) return null;
  const company = await ctx.db.get(settings.companyId);
  if (!company || company.suspendedAt) return null;
  return { settings, company, handle: settings.handle };
}

/** A published texting page, as anyone sees it. Null when the company or the page doesn't exist. */
export const page = publicQuery({
  args: { handle: v.string(), kind: v.union(v.literal("privacy"), v.literal("terms"), v.literal("signup")) },
  handler: async (ctx, args) => {
    const found = await companyByHandle(ctx, args.handle);
    if (!found) return null;
    const row = await currentPage(ctx, found.company._id, args.kind);
    if (!row) return null;
    const setup = await ctx.db
      .query("textingSetups")
      .withIndex("by_company", (q) => q.eq("companyId", found.company._id))
      .unique();
    const hosted = hostedLinks(found.handle);
    // The sign-up page links to the policies the company registered: its own, or the ones published here.
    const own = setup?.hosting === "own_site";
    const profile = found.settings.profile;
    return {
      company: { name: profile.displayName || found.company.name, logoUrl: profile.logo ? await ctx.storage.getUrl(profile.logo) : null, brandColor: profile.brandColor, phone: profile.phone ?? null, email: profile.email ?? null },
      kind: row.kind,
      body: row.body,
      marketing: row.marketing ?? null,
      version: row.version,
      publishedAt: row.publishedAt,
      links: { privacy: own ? (setup?.ownSite?.privacyUrl ?? hosted.privacy) : hosted.privacy, terms: own ? (setup?.ownSite?.termsUrl ?? hosted.terms) : hosted.terms },
    };
  },
});

async function customerFor(ctx: MutationCtx, companyId: Id<"companies">, name: string, phone: string): Promise<Doc<"customers">> {
  // The person may already be a customer with this number: their permission goes on that record.
  const existing = (await recipientsAt(ctx, companyId, "sms", phone)).find((row) => row.kind === "customer");
  if (existing) return (await ctx.db.get(existing.id as Id<"customers">))!;
  const now = Date.now();
  const id = await ctx.db.insert("customers", { companyId, name, kind: "home", phone, status: "active", relationship: "prospect", relationshipAt: now, source: "texting_signup", revision: 1, createdAt: now, updatedAt: now });
  return (await ctx.db.get(id))!;
}

/**
 * Someone agrees to texts on a company's sign-up page. Only the version they saw is accepted, so the
 * recorded wording is exactly what was on their screen. A person who replied STOP before is told how to
 * start texts again (START), because a STOP is only undone by START.
 */
export const signup = serverMutation({
  args: { handle: v.string(), version: v.number(), name: v.string(), phone: v.string(), texts: v.boolean(), marketing: v.boolean(), visitorKey: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; words: string } | { refused: string }> => {
    const found = await companyByHandle(ctx, args.handle);
    const page = found ? await currentPage(ctx, found.company._id, "signup") : null;
    if (!found || !page || !page.smsDisclosureId) return { refused: "This sign-up page isn't available." };
    if (page.version !== args.version) return { refused: "This page was just updated. Reload it to see the latest wording, then try again." };
    if (!(await allow(ctx, `texting-signup:${args.visitorKey.slice(0, 80)}`, 10, 60 * 60_000))) return { refused: "Too many sign-ups from here. Please try again later." };
    if (!(await allow(ctx, `texting-signup-page:${found.company._id}`, 500, 60 * 60_000))) return { refused: "This page is busy. Please try again in a few minutes." };
    const name = args.name.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!name) return { refused: "Enter your name." };
    const phone = usPhone(args.phone);
    if (!phone) return { refused: "Enter a US mobile number, for example (512) 555-0142." };
    if (!args.texts && !args.marketing) return { refused: "Nothing was recorded. Check a box to agree to texts." };
    if (args.marketing && !page.marketingDisclosureId) return { refused: "This page doesn't offer marketing texts." };
    const company = found.company;
    const customer = await customerFor(ctx, company._id, name, phone);
    const now = Date.now();
    const url = hostedLinks(found.handle).signup;
    const evidence = `Agreed on ${url} (sign-up page version ${page.version}).`;
    const recipient = { kind: "customer" as const, id: customer._id };
    if (args.texts) {
      await setPermission(ctx, { companyId: company._id, recipient, channel: "sms", category: "operational", status: "granted", source: "web_form", disclosureId: page.smsDisclosureId, evidence, recordedBy: { kind: "recipient" }, at: now, actor: { kind: "system" } });
    }
    if (args.marketing && page.marketingDisclosureId) {
      await setPermission(ctx, { companyId: company._id, recipient, channel: "sms", category: "marketing", status: "granted", source: "web_form", disclosureId: page.marketingDisclosureId, evidence, recordedBy: { kind: "recipient" }, at: now, actor: { kind: "system" } });
    }
    const address = normalAddress("sms", phone)!;
    const stopped = (await activeSuppressions(ctx, company._id, "sms", address)).some((row) => row.reason === "stop_keyword");
    const sender = (await ctx.db
      .query("complianceProfiles")
      .withIndex("by_company", (q) => q.eq("companyId", company._id))
      .unique())?.messaging.smsNumber;
    const brand = found.settings.profile.displayName || company.name;
    return {
      ok: true,
      words: stopped
        ? `Thanks, ${name.split(" ")[0]}. You replied STOP to ${brand} before, so texts stay off until you text START${sender ? ` to ${sender}` : ""}.`
        : `Thanks, ${name.split(" ")[0]}. ${brand} has your permission on record. Reply STOP to any text to opt out, or HELP for help.`,
    };
  },
});
