/** Shared by the Sales scenario tests: a company that can quote, text, email and book, and the customer's side of each link. */
import { vi } from "vitest";

import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mockEmails } from "../convex/lib/messaging/email";
import { mockOutbox } from "../convex/lib/messaging/provider";
import { mockSalesModel } from "../convex/lib/sales/model";
import { blankSpec, type Spec } from "../convex/lib/services/spec";
import { AREA, company, dispatchCleaner, NOW, readyMessaging, start, type T } from "./harness";

export type As = ReturnType<T["withIdentity"]>;
export const FORM_SECRET = "test-only-public-form-secret";
export const PROSPECT = { name: "Maria Lopez", phone: "+15550107070", email: "maria@example.com" } as const;

/** Runs everything that was scheduled (runs, sends, their follow-ons) without moving far in time. */
export async function flush(t: T) {
  for (let i = 0; i < 10; i += 1) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

/** Fake time, a link secret, the mock text and email services, and the rules reader. Returns what to undo. */
export function salesTestEnv() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.ACTION_LINK_SECRET = "test-only-secret-for-action-links-0123456789";
  process.env.MESSAGING_PROVIDER = "mock";
  process.env.EMAIL_PROVIDER = "mock";
  process.env.PUBLIC_FORM_SECRET = FORM_SECRET;
  delete process.env.SALES_MODEL;
  mockOutbox.length = 0;
  mockEmails.length = 0;
  mockSalesModel.read = null;
  mockSalesModel.word = null;
  mockSalesModel.calls = 0;
  return () => {
    vi.useRealTimers();
    delete process.env.ACTION_LINK_SECRET;
    delete process.env.MESSAGING_PROVIDER;
    delete process.env.EMAIL_PROVIDER;
    delete process.env.PUBLIC_FORM_SECRET;
    delete process.env.SALES_MODEL;
  };
}

/** A home service priced by bedrooms and bathrooms: $120 base with one of each, $20 a bedroom and $25 a bathroom beyond that. */
export function homeSpec(patch: Partial<Spec> = {}): Spec {
  return {
    ...blankSpec("residential"),
    name: "Standard clean",
    summary: "A full clean of the living areas, kitchen and bathrooms.",
    included: [{ id: "counters", label: "Wipe kitchen counters", section: "Kitchen", requiresPhoto: false }],
    excluded: ["Inside the oven"],
    pricing: { method: "bed_bath", baseCents: 12000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 2000, perBathroomCents: 2500, perHalfBathCents: 1000, baseLaborMinutes: 120, perBedroomMinutes: 30, perBathroomMinutes: 30, perHalfBathMinutes: 15 },
    ...patch,
  };
}

const notice = { required: false, note: "" };

export async function publishService(as: As, companyId: Id<"companies">, spec: Spec = homeSpec()) {
  const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: spec.category, spec, origin: "manual" });
  const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "Launch it.", customerNotice: notice, contractReview: notice });
  const change = await as.query(api.services.change, { companyId, changeId });
  await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
  return serviceId;
}

export type Sales = Awaited<ReturnType<typeof setup>>;

/**
 * A company ready to sell: texting approved, an email address to send from, one published home service,
 * and one cleaner who works Tuesdays 8 to 5 in the seeded area. `autonomous` decides the first batch and
 * lets Sales act without asking, which is where a company gets to after its first review.
 */
export async function setup(options: { autonomous?: boolean; cleaners?: number; name?: string; subject?: string; t?: T } = {}) {
  const t = options.t ?? start();
  const owner = await company(t, options.subject ?? "owner-a", options.name ?? "Alpha Cleaning");
  const { as, companyId } = owner;
  const smsNumber = await readyMessaging(t, companyId, options.name ?? "Alpha Cleaning");
  await t.run(async (ctx) => {
    const profile = (await ctx.db.query("complianceProfiles").collect()).find((row) => row.companyId === companyId)!;
    await ctx.db.patch(profile._id, { messaging: { ...profile.messaging, emailFromAddress: "hello@alpha.example" } });
  });
  const serviceId = await publishService(as, companyId);
  const serviceKey = await t.run(async (ctx) => (await ctx.db.get(serviceId))!.key);
  for (let i = 0; i < (options.cleaners ?? 1); i += 1) await dispatchCleaner(as, companyId, ["Lena", "Rosa", "Mia"][i] ?? `Cleaner ${i}`);
  const s = {
    t,
    as,
    companyId,
    smsNumber,
    serviceId,
    serviceKey,
    /** Decides the first batch (with nothing in it) and lets Sales act on its own. */
    autonomous: async () => {
      await t.run(async (ctx) => {
        const row = (await ctx.db.get(companyId))!;
        await ctx.db.patch(companyId, { sales: { ...row.sales, firstBatchDecidedAt: Date.now() } });
      });
      for (const action of ["sales.reply_and_quote", "sales.follow_up", "sales.confirm_booking"]) await as.mutation(api.permissions.set, { companyId, action, level: "execute" });
    },
    /** Past the first batch, with Sales still asking first: each draft waits in the approvals queue. */
    reviewed: async () => {
      await t.run(async (ctx) => {
        const row = (await ctx.db.get(companyId))!;
        await ctx.db.patch(companyId, { sales: { ...row.sales, firstBatchDecidedAt: Date.now() } });
      });
    },
    publishForm: async () => {
      const formId = await as.mutation(api.salesForms.create, { companyId, kind: "residential" });
      const published = await as.mutation(api.salesForms.publish, { companyId, formId, expectedRevision: 0 });
      return { formId, publicId: published.url.split("/c/form/")[1] };
    },
    /** A visitor submits the public form, as the web server would pass it on. */
    submit: (publicId: string, fields: Partial<{ name: string; email: string; phone: string; message: string; answers: Record<string, string | number | boolean>; smsConsent: boolean; clientKey: string; website: string; elapsedMs: number; visitorKey: string }> = {}) =>
      t.mutation(api.salesFormPages.submit, {
        secret: FORM_SECRET,
        publicId,
        name: fields.name ?? PROSPECT.name,
        email: fields.email ?? PROSPECT.email,
        phone: fields.phone ?? PROSPECT.phone,
        message: fields.message ?? "",
        serviceKey: "",
        answers: fields.answers ?? { postal: AREA, bedrooms: 3, bathrooms: 2, frequency: "One time" },
        smsConsent: fields.smsConsent ?? true,
        website: fields.website ?? "",
        elapsedMs: fields.elapsedMs ?? 20_000,
        clientKey: fields.clientKey ?? "browser-key-0001",
        visitorKey: fields.visitorKey ?? "visitor-a",
      }),
    /** A text arriving at the company's number, as Telnyx's webhook delivers it. */
    text: (from: string, body: string, eventId = `evt-${from}-${body.length}-${Date.now()}`) => t.mutation(internal.inbound.telnyx, { eventId, to: smsNumber, from, body, receivedAt: Date.now() }),
    opportunities: () => t.run(async (ctx) => (await ctx.db.query("salesOpportunities").collect()).filter((row) => row.companyId === companyId)),
    opportunity: async (opportunityId: Id<"salesOpportunities">) => (await as.query(api.sales.opportunity, { companyId, opportunityId }))!,
    actions: () => t.run(async (ctx) => (await ctx.db.query("salesActions").collect()).filter((row) => row.companyId === companyId)),
    followUps: () => t.run(async (ctx) => (await ctx.db.query("salesFollowUps").collect()).filter((row) => row.companyId === companyId)),
    /** Texts the mock service accepted for a number, oldest first. */
    textsTo: (phone: string) => mockOutbox.filter((row) => row.to.endsWith(phone.replace(/\D/g, "")) && row.result === "accepted").map((row) => row.body),
  };
  if (options.autonomous) await s.autonomous();
  return s;
}

/** The quote link in the newest text to this number, as the customer would receive it. */
export function quoteLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  for (const text of mockOutbox.filter((row) => row.to.endsWith(digits) && row.result === "accepted").reverse()) {
    const match = text.body.match(/\/c\/quote\/([A-Za-z0-9_.-]+)/);
    if (match) return match[1].replace(/\.$/, "");
  }
  throw new Error(`no quote link was texted to ${phone}`);
}
