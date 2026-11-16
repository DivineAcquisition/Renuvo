/**
 * The company compliance profile: who the company is and how it sends. A company with no row yet reads
 * as the defaults below, so nothing has to be set up before the record can be read.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { userError } from "../errors";
import type { Frequency, Identity, MessagingSetup, QuietHours } from "./schema";

type Ctx = QueryCtx | MutationCtx;

/**
 * Selestial's starting limits. They are defaults the Owner can change, not legal limits: what the law and
 * the carriers allow depends on the message, the place and the provider.
 */
export const DEFAULT_FREQUENCY: Frequency = { marketingPerWeek: 2, recruitingPerWeek: 7 };
export const FREQUENCY_BOUNDS = { marketingPerWeek: 14, recruitingPerWeek: 21 } as const;
/** A starting quiet window on the company's clock. Operational texts about arranged work are not held unless the Owner says so. */
export const DEFAULT_QUIET_HOURS: QuietHours = { start: "21:00", end: "08:00", appliesToOperational: false };

export type ProfileView = {
  identity: Identity;
  messaging: MessagingSetup;
  updatedAt: number | null;
  /** False while the company has never saved its profile. */
  saved: boolean;
};

export function defaultMessaging(): MessagingSetup {
  return {
    registration: { status: "not_started", updatedAt: 0, updatedBy: "owner" },
    quietHours: DEFAULT_QUIET_HOURS,
    frequency: DEFAULT_FREQUENCY,
  };
}

export async function profileRow(ctx: Ctx, companyId: Id<"companies">): Promise<Doc<"complianceProfiles"> | null> {
  return ctx.db
    .query("complianceProfiles")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .unique();
}

export async function readProfile(ctx: Ctx, companyId: Id<"companies">): Promise<ProfileView> {
  const row = await profileRow(ctx, companyId);
  if (!row) return { identity: {}, messaging: defaultMessaging(), updatedAt: null, saved: false };
  return { identity: row.identity, messaging: row.messaging, updatedAt: row.updatedAt, saved: true };
}

/** Writes the profile, creating it on first use. Answers with its id. */
export async function writeProfile(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  change: { identity?: Identity; messaging?: MessagingSetup },
): Promise<Id<"complianceProfiles">> {
  const now = Date.now();
  const row = await profileRow(ctx, companyId);
  if (row) {
    await ctx.db.patch(row._id, { ...change, updatedAt: now });
    return row._id;
  }
  return ctx.db.insert("complianceProfiles", { companyId, identity: change.identity ?? {}, messaging: change.messaging ?? defaultMessaging(), updatedAt: now });
}

// ── Checking what is entered ─────────────────────────────────────────────────────────────────────

const E164 = /^\+[1-9]\d{7,14}$/;

/** A phone number in international form, for example +15125550100. */
export function e164(value: string, label: string): string {
  const cleaned = value.trim().replace(/[\s().-]/g, "");
  if (!E164.test(cleaned)) throw userError(`${label} must be in international form, for example +15125550100.`);
  return cleaned;
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClock(value: string): boolean {
  return CLOCK.test(value);
}

/** Minutes from midnight of an HH:MM time. */
export function clockMinutes(value: string): number {
  const match = CLOCK.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function quietHours(value: QuietHours): QuietHours {
  const start = value.start.trim();
  const end = value.end.trim();
  if (!isClock(start) || !isClock(end)) throw userError("Quiet hours must be times like 21:00 and 08:00.");
  if (start === end) throw userError("Quiet hours must start and end at different times.");
  return { start, end, appliesToOperational: value.appliesToOperational };
}

export function frequency(value: Frequency): Frequency {
  const check = (n: number, max: number, label: string) => {
    if (!Number.isInteger(n) || n < 0 || n > max) throw userError(`${label} must be a whole number from 0 to ${max}.`);
    return n;
  };
  return {
    marketingPerWeek: check(value.marketingPerWeek, FREQUENCY_BOUNDS.marketingPerWeek, "Marketing messages per week"),
    recruitingPerWeek: check(value.recruitingPerWeek, FREQUENCY_BOUNDS.recruitingPerWeek, "Recruiting messages per week"),
  };
}
