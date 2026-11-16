/**
 * Who a permission is about, and the addresses on their record. A recipient must belong to the company:
 * another company's person reads as missing.
 */
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { sendablePhone } from "../messaging/provider";
import { CLEANER_STATUSES, RECORD_STATUSES } from "../statuses";
import { isEmail } from "../text";
import type { Channel, Recipient } from "./schema";

type Ctx = QueryCtx | MutationCtx;

export type RecipientRecord = { kind: Recipient["kind"]; id: string; name: string; phone: string | null; email: string | null };

/** The address a channel sends to, in the one form suppressions are kept in. Null when it is not a usable address. */
export function normalAddress(channel: Channel, value: string | undefined | null): string | null {
  if (!value) return null;
  if (channel === "sms") return sendablePhone(value);
  const cleaned = value.trim().toLowerCase();
  return isEmail(cleaned) ? cleaned : null;
}

/**
 * The customer or cleaner a recipient names, if it is in this company. Applicants are not records here
 * yet, so an applicant cannot be checked and reads as missing.
 */
export async function recipientRecord(ctx: Ctx, companyId: Id<"companies">, recipient: Recipient): Promise<RecipientRecord | null> {
  if (recipient.kind === "cleaner") {
    const id = ctx.db.normalizeId("cleaners", recipient.id);
    const doc = id ? await ctx.db.get(id) : null;
    if (!doc || doc.companyId !== companyId) return null;
    return { kind: "cleaner", id: doc._id, name: doc.name, phone: normalAddress("sms", doc.phone), email: normalAddress("email", doc.email) };
  }
  if (recipient.kind === "customer") {
    const id = ctx.db.normalizeId("customers", recipient.id);
    const doc = id ? await ctx.db.get(id) : null;
    if (!doc || doc.companyId !== companyId) return null;
    return { kind: "customer", id: doc._id, name: doc.name, phone: normalAddress("sms", doc.phone), email: normalAddress("email", doc.email) };
  }
  return null;
}

const SCAN_LIMIT = 2000;

/**
 * Everyone in the company whose record has this address. The people tables have no index on the
 * address, so this reads a bounded number of rows; an index on the normalised address replaces it once
 * those tables carry one.
 */
export async function recipientsAt(ctx: Ctx, companyId: Id<"companies">, channel: Channel, address: string): Promise<RecipientRecord[]> {
  const out: RecipientRecord[] = [];
  const field = channel === "sms" ? "phone" : "email";
  for (const status of CLEANER_STATUSES) {
    const rows = await ctx.db
      .query("cleaners")
      .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
      .take(SCAN_LIMIT);
    for (const doc of rows) {
      if (normalAddress(channel, doc[field]) === address) out.push({ kind: "cleaner", id: doc._id, name: doc.name, phone: normalAddress("sms", doc.phone), email: normalAddress("email", doc.email) });
    }
  }
  for (const status of RECORD_STATUSES) {
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
      .take(SCAN_LIMIT);
    for (const doc of rows) {
      if (normalAddress(channel, doc[field]) === address) out.push({ kind: "customer", id: doc._id, name: doc.name, phone: normalAddress("sms", doc.phone), email: normalAddress("email", doc.email) });
    }
  }
  return out;
}
