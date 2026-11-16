/**
 * The company compliance profile (who the company is and how it sends), the wording people agree to,
 * and what the company is ready to do. Any member reads; only the Owner changes the profile. Carrier
 * registration is approved or rejected only by Selestial staff, who check it with the provider.
 */
import { v } from "convex/values";

import { companyQuery, ownerMutation, staffMutation } from "./lib/builders";
import { e164, frequency, profileRow, quietHours, readProfile, writeProfile } from "./lib/compliance/profile";
import { readiness as readinessFor } from "./lib/compliance/readiness";
import {
  categoryValidator,
  channelValidator,
  companyAddressValidator,
  frequencyValidator,
  quietHoursValidator,
  registrationStatusValidator,
  representativeValidator,
  type Identity,
  type Registration,
} from "./lib/compliance/schema";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { email, optionalText, text } from "./lib/text";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const profile = companyQuery({
  args: {},
  handler: async (ctx) => {
    const view = await readProfile(ctx, ctx.companyId);
    return { ...view, suspendedAt: ctx.company.suspendedAt ?? null, readiness: await readinessFor(ctx, ctx.company) };
  },
});

export const readiness = companyQuery({
  args: {},
  handler: async (ctx) => readinessFor(ctx, ctx.company),
});

async function profileSubject(ctx: MutationCtx, companyId: Id<"companies">): Promise<{ table: "complianceProfiles"; id: Id<"complianceProfiles"> }> {
  const row = await profileRow(ctx, companyId);
  return { table: "complianceProfiles", id: row?._id ?? (await writeProfile(ctx, companyId, {})) };
}

export const updateIdentity = ownerMutation({
  args: {
    legalName: v.optional(v.string()),
    tradingName: v.optional(v.string()),
    address: v.optional(companyAddressValidator),
    representative: v.optional(representativeValidator),
    supportEmail: v.optional(v.string()),
    supportPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const current = (await readProfile(ctx, ctx.companyId)).identity;
    // An empty string clears an optional field; a field left out stays as it was.
    const next: Identity = { ...current };
    if (args.legalName !== undefined) next.legalName = optionalText(args.legalName, "The legal name", 200);
    if (args.tradingName !== undefined) next.tradingName = optionalText(args.tradingName, "The trading name", 200);
    if (args.address !== undefined) {
      next.address = {
        line1: text(args.address.line1, "The street address", 200),
        line2: optionalText(args.address.line2, "The second address line", 200),
        city: text(args.address.city, "The city", 100),
        region: text(args.address.region, "The state or province", 100),
        postalCode: text(args.address.postalCode, "The postal code", 20),
        country: args.address.country,
      };
    }
    if (args.representative !== undefined) {
      next.representative = {
        name: text(args.representative.name, "The representative's name", 160),
        title: text(args.representative.title, "The representative's title", 160),
        email: email(args.representative.email, "The representative's email"),
      };
    }
    if (args.supportEmail !== undefined) next.supportEmail = args.supportEmail.trim() ? email(args.supportEmail, "The support email") : undefined;
    if (args.supportPhone !== undefined) next.supportPhone = args.supportPhone.trim() ? e164(args.supportPhone, "The support phone") : undefined;
    const id = await writeProfile(ctx, ctx.companyId, { identity: next });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "compliance.identity_updated", actor: byMember(ctx), subject: { table: "complianceProfiles", id } });
    return null;
  },
});

export const updateMessaging = ownerMutation({
  args: {
    senderName: v.optional(v.string()),
    smsNumber: v.optional(v.string()),
    emailFromAddress: v.optional(v.string()),
    quietHours: v.optional(v.union(v.null(), quietHoursValidator)),
    frequency: v.optional(frequencyValidator),
  },
  handler: async (ctx, args) => {
    const current = (await readProfile(ctx, ctx.companyId)).messaging;
    const next = { ...current };
    if (args.senderName !== undefined) next.senderName = optionalText(args.senderName, "The sender name", 60);
    if (args.smsNumber !== undefined) {
      const number = args.smsNumber.trim() ? e164(args.smsNumber, "The texting number") : undefined;
      if (number) {
        const taken = await ctx.db
          .query("complianceProfiles")
          .withIndex("by_sms_number", (q) => q.eq("messaging.smsNumber", number))
          .take(2);
        if (taken.some((row) => row.companyId !== ctx.companyId)) throw userError("That texting number is already set up for another account.");
      }
      if (number !== current.smsNumber) {
        next.smsNumber = number;
        // A registration belongs to a number. A new number has to be registered and confirmed again.
        if (current.registration.status !== "not_started") {
          next.registration = { status: "not_started", updatedAt: Date.now(), updatedBy: "owner", note: "The texting number changed, so the registration has to be confirmed again." };
        }
      }
    }
    if (args.emailFromAddress !== undefined) next.emailFromAddress = args.emailFromAddress.trim() ? email(args.emailFromAddress, "The from address") : undefined;
    if (args.quietHours !== undefined) next.quietHours = args.quietHours === null ? null : quietHours(args.quietHours);
    if (args.frequency !== undefined) next.frequency = frequency(args.frequency);
    const id = await writeProfile(ctx, ctx.companyId, { messaging: next });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "compliance.messaging_updated", actor: byMember(ctx), subject: { table: "complianceProfiles", id } });
    return null;
  },
});

async function setRegistrationOn(ctx: MutationCtx, companyId: Id<"companies">, registration: Registration, actor: Actor, data: Record<string, string>) {
  const current = (await readProfile(ctx, companyId)).messaging;
  const subject = await profileSubject(ctx, companyId);
  await writeProfile(ctx, companyId, { messaging: { ...current, registration } });
  await recordEvent(ctx, { companyId, type: "compliance.registration_recorded", actor, subject, data: { status: registration.status, by: registration.updatedBy, ...data } });
}

/** The Owner records where the registration stands on their side. Only staff can say it was approved or rejected. */
export const recordRegistration = ownerMutation({
  args: { status: v.union(v.literal("not_started"), v.literal("submitted")), reference: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await setRegistrationOn(
      ctx,
      ctx.companyId,
      { status: args.status, reference: optionalText(args.reference, "The reference", 120), note: optionalText(args.note, "The note", 500), updatedAt: Date.now(), updatedBy: "owner" },
      byMember(ctx),
      {},
    );
    return null;
  },
});

/** Selestial staff, after checking with the provider. */
export const setRegistration = staffMutation({
  args: { companyId: v.id("companies"), status: registrationStatusValidator, reference: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.companyId))) notFound();
    await setRegistrationOn(
      ctx,
      args.companyId,
      { status: args.status, reference: optionalText(args.reference, "The reference", 120), note: optionalText(args.note, "The note", 500), updatedAt: Date.now(), updatedBy: "staff" },
      { kind: "system" },
      { staffId: ctx.staff._id },
    );
    return null;
  },
});

/** Selestial staff only. While suspended, the sending policy refuses every message for the company. */
export const setSuspended = staffMutation({
  args: { companyId: v.id("companies"), suspended: v.boolean(), note: v.string() },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) notFound();
    const note = text(args.note, "The note", 500);
    await ctx.db.patch(company._id, { suspendedAt: args.suspended ? (company.suspendedAt ?? Date.now()) : undefined });
    await recordEvent(ctx, {
      companyId: company._id,
      type: args.suspended ? "company.suspended" : "company.unsuspended",
      actor: { kind: "system" },
      subject: { table: "companies", id: company._id },
      data: { staffId: ctx.staff._id, note },
    });
    return null;
  },
});

/** New wording is a new version. Old versions stay, because permissions point at the exact words. */
export const addDisclosure = ownerMutation({
  args: { channel: channelValidator, category: categoryValidator, text: v.string() },
  handler: async (ctx, args) => {
    const words = text(args.text, "The wording", 2000);
    const latest = await ctx.db
      .query("consentDisclosures")
      .withIndex("by_company_channel_category", (q) => q.eq("companyId", ctx.companyId).eq("channel", args.channel).eq("category", args.category))
      .order("desc")
      .first();
    const version = (latest?.version ?? 0) + 1;
    const id = await ctx.db.insert("consentDisclosures", { companyId: ctx.companyId, channel: args.channel, category: args.category, text: words, version, createdAt: Date.now(), createdBy: ctx.member._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "consent.disclosure_added", actor: byMember(ctx), subject: { table: "consentDisclosures", id }, data: { channel: args.channel, category: args.category, version } });
    return { disclosureId: id, version };
  },
});

export const disclosures = companyQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("consentDisclosures")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(200),
});
