/**
 * The company's booking rules, shared by every booking experience: the public handle and profile,
 * scheduling, payment policies and booking agreements. One row per company; absent means the defaults
 * here. An experience chooses a policy or an agreement by id and never keeps its own copy, so a deposit
 * policy is one rule the company can see and change in one place.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { userError } from "../errors";
import { isEmail } from "../text";
import { plain } from "./definition";
import type { BookingAgreementRule, PaymentPolicy } from "./schema";

export type BookingSettings = Omit<Doc<"bookingSettings">, "_id" | "_creationTime">;

export const SCHEDULING_DEFAULTS = { mode: "capacity" as const, noticeHours: 24, horizonDays: 45, slotMinutes: 60, holdMinutes: 15, defaultWindowMinutes: 60 };

export const SCHEDULING_LIMITS = {
  noticeHours: { min: 0, max: 24 * 30 },
  horizonDays: { min: 1, max: 365 },
  slotMinutes: { min: 15, max: 240 },
  holdMinutes: { min: 5, max: 60 },
  defaultWindowMinutes: { min: 0, max: 8 * 60 },
} as const;

export function defaultSettings(company: Pick<Doc<"companies">, "_id" | "name">): BookingSettings {
  return {
    companyId: company._id,
    profile: { displayName: company.name, brandColor: "#6838ef", accentColor: "#8e5bff" },
    scheduling: { ...SCHEDULING_DEFAULTS },
    paymentPolicies: [],
    agreements: [],
    revision: 0,
    updatedAt: 0,
  };
}

export async function settingsRow(ctx: QueryCtx, companyId: Id<"companies">): Promise<Doc<"bookingSettings"> | null> {
  return ctx.db
    .query("bookingSettings")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .unique();
}

export async function bookingSettingsOf(ctx: QueryCtx, company: Doc<"companies">): Promise<BookingSettings> {
  const row = await settingsRow(ctx, company._id);
  if (!row) return defaultSettings(company);
  const { _id, _creationTime, ...rest } = row;
  void _id;
  void _creationTime;
  return rest;
}

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(["r", "resume", "unsubscribe", "embed", "preview", "admin", "app", "api", "manage", "test", "selestial"]);

export function normalizeHandle(value: string): string {
  const handle = value.trim().toLowerCase();
  if (!HANDLE.test(handle) || handle.includes("--")) throw userError("A booking address is 3 to 40 lower-case letters, numbers and single dashes, like bright-homes.");
  if (RESERVED.has(handle)) throw userError(`"${handle}" is reserved. Choose another.`);
  return handle;
}

export function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `booking-${base || "page"}`.slice(0, 40);
}

export function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!HANDLE.test(slug) || slug.includes("--")) throw userError("A page address is 3 to 40 lower-case letters, numbers and single dashes.");
  if (RESERVED.has(slug)) throw userError(`"${slug}" is reserved. Choose another.`);
  return slug;
}

function phone(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw userError("The public phone number doesn't look like a phone number.");
  return plain(text, "The phone number", 30);
}

function website(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw userError("The website must be an address like https://example.com.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw userError("The website must start with https://.");
  return url.toString().replace(/\/$/, "");
}

function hex(value: string, label: string): string {
  const text = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(text)) throw userError(`${label} must be a color like #6838ef.`);
  return text;
}

function bounded(value: number, label: string, limits: { min: number; max: number }): number {
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) throw userError(`${label} must be a whole number from ${limits.min} to ${limits.max}.`);
  return value;
}

const POLICY_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function normalizePolicy(input: PaymentPolicy): PaymentPolicy {
  if (!POLICY_ID.test(input.id)) throw userError("A payment policy needs a short id.");
  const label = plain(input.label, "A payment policy's name", 60, false);
  const balanceTerms = plain(input.balanceTerms, "How the rest is collected", 200);
  switch (input.kind) {
    case "none":
      return { id: input.id, label, kind: "none", balanceTerms: balanceTerms || "Invoiced after the visit." };
    case "full":
      return { id: input.id, label, kind: "full", balanceTerms: "" };
    case "deposit_percent": {
      const percent = input.percent ?? 0;
      if (!Number.isInteger(percent) || percent < 1 || percent > 99) throw userError("A percentage deposit is a whole number from 1 to 99. Use \"Full payment\" for 100%.");
      if (!balanceTerms) throw userError("Say how the rest is collected, for example \"Invoiced after the visit\".");
      return { id: input.id, label, kind: "deposit_percent", percent, balanceTerms };
    }
    case "deposit_fixed": {
      const cents = input.cents ?? 0;
      if (!Number.isSafeInteger(cents) || cents < 50 || cents > 10_000_00) throw userError("A fixed deposit is from $0.50 to $10,000.");
      if (!balanceTerms) throw userError("Say how the rest is collected, for example \"Invoiced after the visit\".");
      return { id: input.id, label, kind: "deposit_fixed", cents, balanceTerms };
    }
  }
}

export function normalizeAgreementRule(input: BookingAgreementRule): BookingAgreementRule {
  if (!POLICY_ID.test(input.id)) throw userError("A booking agreement needs a short id.");
  const standing: BookingAgreementRule["standing"] = {};
  const keys = Object.keys(input.standing);
  if (keys.length > 60) throw userError("Too many standing answers.");
  for (const key of keys) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)) throw userError("A standing answer has an unknown name.");
    const value = input.standing[key];
    standing[key] = typeof value === "string" ? plain(value, "A standing answer", 2000) : value;
  }
  return { id: input.id, label: plain(input.label, "A booking agreement's name", 80, false), templateId: input.templateId, standing };
}

export type SettingsInput = {
  handle?: string;
  profile: BookingSettings["profile"];
  scheduling: BookingSettings["scheduling"];
  paymentPolicies: PaymentPolicy[];
  agreements: BookingAgreementRule[];
};

/** Checks and tidies the whole rules draft. Nothing is written until every part is valid. */
export function normalizeSettings(input: SettingsInput): Omit<BookingSettings, "companyId" | "revision" | "updatedAt" | "updatedBy"> {
  const policies = input.paymentPolicies.map(normalizePolicy);
  if (policies.length > 8) throw userError("At most 8 payment policies.");
  if (new Set(policies.map((p) => p.id)).size !== policies.length) throw userError("Two payment policies share an id.");
  const agreements = input.agreements.map(normalizeAgreementRule);
  if (agreements.length > 8) throw userError("At most 8 booking agreements.");
  if (new Set(agreements.map((a) => a.id)).size !== agreements.length) throw userError("Two booking agreements share an id.");
  const email = input.profile.email?.trim();
  if (email && !isEmail(email)) throw userError("The public email address doesn't look right.");
  const s = input.scheduling;
  return {
    ...(input.handle?.trim() ? { handle: normalizeHandle(input.handle) } : {}),
    profile: {
      displayName: plain(input.profile.displayName, "The public name", 80, false),
      ...(phone(input.profile.phone) ? { phone: phone(input.profile.phone) } : {}),
      ...(email ? { email: email.toLowerCase() } : {}),
      ...(website(input.profile.website) ? { website: website(input.profile.website) } : {}),
      ...(input.profile.logo ? { logo: input.profile.logo } : {}),
      ...(input.profile.mailingAddress?.trim() ? { mailingAddress: plain(input.profile.mailingAddress.replace(/\s*\n\s*/g, ", "), "The mailing address", 200, false) } : {}),
      brandColor: hex(input.profile.brandColor, "The brand color"),
      accentColor: hex(input.profile.accentColor, "The accent color"),
    },
    scheduling: {
      mode: s.mode,
      noticeHours: bounded(s.noticeHours, "Notice", SCHEDULING_LIMITS.noticeHours),
      horizonDays: bounded(s.horizonDays, "How far ahead", SCHEDULING_LIMITS.horizonDays),
      slotMinutes: bounded(s.slotMinutes, "Time between start times", SCHEDULING_LIMITS.slotMinutes),
      holdMinutes: bounded(s.holdMinutes, "How long a time is held", SCHEDULING_LIMITS.holdMinutes),
      defaultWindowMinutes: bounded(s.defaultWindowMinutes, "The arrival window", SCHEDULING_LIMITS.defaultWindowMinutes),
    },
    paymentPolicies: policies,
    agreements,
  };
}

/** What a payment policy asks for today, on a total. Whole cents, never more than the total. */
export function dueNow(policy: Pick<PaymentPolicy, "kind" | "percent" | "cents"> | null, totalCents: number): number {
  if (!policy || policy.kind === "none" || totalCents <= 0) return 0;
  if (policy.kind === "full") return totalCents;
  if (policy.kind === "deposit_fixed") return Math.min(totalCents, policy.cents ?? 0);
  return Math.min(totalCents, Math.round((totalCents * (policy.percent ?? 0)) / 100));
}

export function policyWords(policy: Pick<PaymentPolicy, "kind" | "percent" | "cents"> | null): string {
  if (!policy || policy.kind === "none") return "Nothing is charged now";
  if (policy.kind === "full") return "Paid in full now";
  if (policy.kind === "deposit_fixed") return `$${((policy.cents ?? 0) / 100).toFixed(2)} deposit now`;
  return `${policy.percent}% deposit now`;
}
