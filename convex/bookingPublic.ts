/**
 * The two ways into a booking without a link: reading a published page by its address, and starting a
 * session from it. Reading is a `publicQuery` (reviewed in convex/lib/guard.ts): it returns only what the
 * published page shows anyone, never a draft, a price rule, a cost or a record. Starting and signing are
 * `serverMutation`s: only Selestial's web server calls them, with PUBLIC_FORM_SECRET and a keyed hash of
 * the visitor's network address for rate limits and signing evidence. The address itself never arrives.
 */
import { v } from "convex/values";

import { publicQuery, serverMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { recordEvent } from "./lib/events";
import { upgradeDefinition } from "./lib/booking/definition";
import { funnel } from "./lib/booking/funnel";
import { inArea, load, recalc, agreementFor } from "./lib/booking/session";
import { newToken, OPEN_SESSION_LIFE, sessionForToken, tokenHash } from "./lib/booking/tokens";
import { businessSettingsOf, normalizePostalCode } from "./lib/settings/business";
import { allow } from "./lib/rateLimit";
import { plain } from "./lib/booking/definition";
import type { QueryCtx } from "./_generated/server";

async function published(ctx: QueryCtx, handle: string, slug: string) {
  const settings = await ctx.db
    .query("bookingSettings")
    .withIndex("by_handle", (q) => q.eq("handle", handle.trim().toLowerCase()))
    .unique();
  if (!settings) return null;
  const experience = await ctx.db
    .query("bookingExperiences")
    .withIndex("by_company_slug", (q) => q.eq("companyId", settings.companyId).eq("slug", slug.trim().toLowerCase()))
    .unique();
  if (!experience || experience.status !== "published" || experience.publishedVersion === undefined) return null;
  const version = await ctx.db
    .query("bookingExperienceVersions")
    .withIndex("by_company_experience_version", (q) => q.eq("companyId", settings.companyId).eq("experienceId", experience._id).eq("version", experience.publishedVersion!))
    .unique();
  const company = await ctx.db.get(settings.companyId);
  if (!version || !company || company.suspendedAt) return null;
  return { settings, experience, version, company };
}

/** A published booking page, as any visitor sees it before starting. Null for anything not published. */
export const page = publicQuery({
  args: { handle: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    if (args.handle.length > 60 || args.slug.length > 60) return null;
    const found = await published(ctx, args.handle, args.slug);
    if (!found) return null;
    const { settings, version, company } = found;
    const def = upgradeDefinition(version.definition);
    return {
      company: {
        name: settings.profile.displayName || company.name,
        phone: settings.profile.phone ?? null,
        email: settings.profile.email ?? null,
        website: settings.profile.website ?? null,
        logoUrl: settings.profile.logo ? await ctx.storage.getUrl(settings.profile.logo) : null,
        brandColor: settings.profile.brandColor,
        accentColor: settings.profile.accentColor,
      },
      definition: def,
      heroUrl: def.theme.heroImage ? await ctx.storage.getUrl(def.theme.heroImage) : null,
    };
  },
});

const attributionValidator = v.object({ source: v.string(), medium: v.string(), campaign: v.string(), referrer: v.string(), landing: v.string() });

/** Keeps campaign words and a referring site's host only. Anything that looks like a person is dropped. */
function cleanAttribution(input: typeof attributionValidator.type) {
  const tidy = (value: string, max: number) => {
    const text = value.replace(/[^\w .:/-]/g, "").trim().slice(0, max);
    return /@|\d{7,}/.test(text) ? "" : text;
  };
  let referrer = "";
  try {
    referrer = input.referrer ? new URL(input.referrer).host.slice(0, 80) : "";
  } catch {
    referrer = "";
  }
  return { source: tidy(input.source, 60), medium: tidy(input.medium, 40), campaign: tidy(input.campaign, 80), referrer, landing: tidy(input.landing.split("?")[0].split("#")[0], 120) };
}

/**
 * Starts a booking on a published page with the visitor's ZIP code. Answers with the private token,
 * once. A visitor may start a few bookings an hour; a page may start a few hundred.
 */
export const start = serverMutation({
  args: { handle: v.string(), slug: v.string(), postalCode: v.string(), attribution: attributionValidator, visitorKey: v.string() },
  handler: async (ctx, args) => {
    const found = await published(ctx, args.handle, args.slug);
    if (!found) throw userError("This booking page isn't available.", "not_found");
    const { experience, version, company, settings } = found;
    if (!(await allow(ctx, `booking-start:${args.visitorKey.slice(0, 80)}`, 12, 60 * 60_000))) return { refused: "Too many bookings started from here. Please try again later." };
    if (!(await allow(ctx, `booking-start-page:${experience._id}`, 600, 60 * 60_000))) return { refused: "This page is busy. Please try again in a few minutes." };
    const postal = normalizePostalCode(args.postalCode);
    if (!/^[A-Z0-9][A-Z0-9 -]{1,9}[A-Z0-9]$/.test(postal)) throw userError("Enter a valid ZIP code.");
    const token = newToken();
    const now = Date.now();
    const def = upgradeDefinition(version.definition);
    const attribution = cleanAttribution(args.attribution);
    const sessionId = await ctx.db.insert("bookingSessions", {
      companyId: company._id,
      experienceId: experience._id,
      version: version.version,
      test: false,
      tokenHash: tokenHash(token),
      tokenIssuedAt: now,
      expiresAt: now + OPEN_SESSION_LIFE,
      status: "active",
      step: "location",
      mode: def.behavior.mode,
      postalCode: postal,
      inArea: inArea(businessSettingsOf(company), postal),
      home: {},
      answers: {},
      answersState: "incomplete",
      quoteState: "none",
      agreementState: "not_required",
      paymentState: "not_required",
      capacityState: "none",
      confirmationState: "open",
      blockers: [],
      attribution: { ...attribution, source: attribution.source || def.attribution.source, campaign: attribution.campaign || def.attribution.campaign },
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    void settings;
    const session = (await ctx.db.get(sessionId))!;
    await funnel(ctx, session, "booking_started");
    await recordEvent(ctx, { companyId: company._id, type: "booking.started", actor: { kind: "system" }, subject: { table: "bookingSessions", id: sessionId }, data: { version: version.version } });
    await recalc(ctx, sessionId);
    return { token };
  },
});

/**
 * Signs the booking's agreement: the exact words the customer was shown (by their hash), their typed
 * name, an optional drawn signature, and the evidence. Refused if the words changed since the page drew them.
 */
export const sign = serverMutation({
  args: { token: v.string(), signerName: v.string(), drawn: v.optional(v.string()), contentHash: v.string(), visitorKey: v.string(), userAgent: v.string() },
  handler: async (ctx, args) => {
    const found = await sessionForToken(ctx, args.token);
    if (!found || !found.open) throw userError("This booking link has ended. Start a new booking, or contact the company.", "not_allowed");
    const session = found.session;
    if (session.status !== "active") throw userError("This booking is already sent, so it can't be changed here.", "not_allowed");
    if (!(await allow(ctx, `booking-sign:${session._id}`, 20, 10 * 60_000))) return { refused: "Too many tries. Please wait a minute." };
    const company = (await ctx.db.get(session.companyId))!;
    const L = await load(ctx, session, company);
    if (!L.agreementRule) throw userError("This booking doesn't need an agreement.");
    const prepared = await agreementFor(ctx, session, L, session.quote ?? null);
    if (!prepared?.ok) throw userError("The agreement isn't ready yet. Choose a service and a time first.");
    if (prepared.hash !== args.contentHash) throw userError("The agreement changed because your booking changed. Please read it again and sign.");
    const signerName = plain(args.signerName, "Your name", 120, false);
    if (signerName.split(/\s+/).length < 2) throw userError("Type your full name to sign.");
    let drawn: string | undefined;
    if (args.drawn) {
      if (args.drawn.length > 20_000 || !/^[MLQCZmlqcz0-9 .,-]+$/.test(args.drawn)) throw userError("The drawn signature couldn't be read. Please draw it again, or just type your name.");
      drawn = args.drawn;
    }
    const acceptanceId = await ctx.db.insert("bookingAcceptances", {
      companyId: company._id,
      sessionId: session._id,
      ruleId: L.agreementRule.id,
      templateId: prepared.templateId,
      templateVersion: prepared.templateVersion,
      title: prepared.title,
      markdown: prepared.markdown,
      contentHash: prepared.hash,
      signerName,
      ...(drawn ? { drawn } : {}),
      acceptedAt: Date.now(),
      ipHash: args.visitorKey.slice(0, 80),
      userAgent: args.userAgent.slice(0, 300),
    });
    await ctx.db.patch(session._id, { acceptanceId });
    await recordEvent(ctx, { companyId: company._id, type: "booking.agreement_signed", actor: { kind: "system" }, subject: { table: "bookingSessions", id: session._id }, data: { templateVersion: prepared.templateVersion } });
    const after = await recalc(ctx, session._id);
    await funnel(ctx, after, "agreement_completed");
    return { ok: true };
  },
});
