/**
 * How a company's email leaves through Selestial's shared sender (docs/email/00-architecture.md §2–3): from
 * "{Company} via Selestial" on Selestial's own verified address (convex/lib/email/senders.ts), set in the
 * company's frame (its logo and colour, from Booking's public profile), with a footer saying who sent it
 * and why the person got it. The words are exactly what was written; nothing is added to them.
 *
 * Email that goes from the company's own connected Gmail doesn't come through here: it's sent as a
 * plain, threaded message from that inbox.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { companySender } from "../email/senders";
import { companyLetter, type CompanyBrand } from "../email/templates/company";
import { oneLine } from "../email/kit";

/** Who the person is to the company, for the footer's "why you got this". */
function reasonFor(message: Doc<"messages">, company: string): string {
  if (message.applicationId) return `You're getting this because you applied to ${company}.`;
  if (message.cleanerId || message.portalLinkId || message.followUpId || message.purpose === "earnings_statement") return `You're getting this because you work with ${company}.`;
  if (message.invoiceId || message.customerId || message.bookingSessionId) return `You're getting this because you're a customer of ${company}.`;
  return `You're getting this because you were in touch with ${company}.`;
}

/** The company as its customers see it: Booking's public profile when there is one, its name otherwise. */
export async function companyBrand(ctx: MutationCtx, company: Doc<"companies">, name: string): Promise<CompanyBrand> {
  const settings = await ctx.db
    .query("bookingSettings")
    .withIndex("by_company", (q) => q.eq("companyId", company._id))
    .first();
  const profile = settings?.profile;
  const logoUrl = profile?.logo ? await ctx.storage.getUrl(profile.logo) : null;
  return {
    name: oneLine(name || profile?.displayName || company.name),
    logoUrl,
    accent: profile?.brandColor ?? null,
    address: profile?.mailingAddress ?? null,
  };
}

/** The From and the HTML for a company email sent through Selestial, or why it can't go. */
export async function companyEmail(ctx: MutationCtx, message: Doc<"messages">, input: { fromName: string; text: string }): Promise<{ ok: true; from: string; html: string; text: string } | { ok: false; problem: string }> {
  const company = await ctx.db.get(message.companyId);
  if (!company) return { ok: false, problem: "The company no longer exists." };
  const sender = companySender(input.fromName || company.name);
  // Not configured: it waits with the reason. It never goes from another identity instead.
  if (!sender.ok) return { ok: false, problem: sender.words };
  const brand = await companyBrand(ctx, company, company.name);
  const letter = companyLetter({ brand, text: input.text, reason: reasonFor(message, brand.name) });
  return { ok: true, from: sender.from, html: letter.html, text: letter.text };
}
