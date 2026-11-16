/**
 * The trust change log: the only writer. Every change to the settings, providers, claims and
 * publications is written here with what it was before and after. Nothing changes or removes a row;
 * convex/guard.test.ts checks both.
 *
 * Public fields keep their values. A staff-only field (evidence, agreements, review state) is named
 * when it changes, without its values, so the log can be shown more widely than the evidence itself.
 */
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export type TrustTable = "trustSettings" | "trustProviders" | "trustClaims" | "policyPublications";
type Scalar = string | number | boolean | null;

/** The fields that are shown in public, or are about what is shown, for each table. */
const PUBLIC_FIELDS: Record<TrustTable, readonly string[]> = {
  trustSettings: [
    "legalEntity",
    "mailingAddress",
    "governingPlace",
    "contacts.security",
    "contacts.privacy",
    "contacts.support",
    "securityTxtExpiresOn",
    "verified.legalEntity",
    "verified.mailingAddress",
    "verified.security",
    "verified.privacy",
    "verified.support",
  ],
  trustProviders: ["name", "purpose", "dataHandled", "locations", "policyUrl", "status", "reviewedOn", "publicNote"],
  trustClaims: ["area", "text", "status", "reviewedOn", "public"],
  policyPublications: ["status", "publishedAt"],
};

/** Bookkeeping that is not content: never compared. */
const IGNORED = new Set(["_id", "_creationTime", "key", "documentId", "updatedAt", "updatedBy"]);

/** Flattens one level of objects into dotted names, so a contact change reads as `contacts.privacy`. */
export function flatten(row: Record<string, unknown> | null): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  if (!row) return out;
  for (const [name, value] of Object.entries(row)) {
    if (IGNORED.has(name)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) out[`${name}.${inner}`] = scalar(innerValue);
    } else out[name] = scalar(value);
  }
  return out;
}

function scalar(value: unknown): Scalar {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

export type TrustDiff = { fields: { field: string; before: Scalar; after: Scalar }[]; internalFieldsChanged: string[] };

export function diff(table: TrustTable, before: Record<string, unknown> | null, after: Record<string, unknown> | null): TrustDiff {
  const a = flatten(before);
  const b = flatten(after);
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const fields: TrustDiff["fields"] = [];
  const internalFieldsChanged: string[] = [];
  for (const name of names) {
    const was = a[name] ?? null;
    const now = b[name] ?? null;
    if (was === now) continue;
    if (PUBLIC_FIELDS[table].includes(name)) fields.push({ field: name, before: was, after: now });
    else internalFieldsChanged.push(name);
  }
  return { fields, internalFieldsChanged };
}

export type TrustAuthor = { staffId?: Id<"staff">; name: string };

/**
 * Writes one change. Returns null and writes nothing when nothing changed, so saving the same values
 * twice does not fill the log.
 */
export async function logTrustChange(
  ctx: MutationCtx,
  input: { table: TrustTable; key: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; by: TrustAuthor; note: string },
): Promise<Id<"trustChanges"> | null> {
  const change = diff(input.table, input.before, input.after);
  if (change.fields.length === 0 && change.internalFieldsChanged.length === 0) return null;
  const action = input.before === null ? "created" : input.after === null ? "removed" : "updated";
  return ctx.db.insert("trustChanges", {
    table: input.table,
    key: input.key,
    action,
    fields: change.fields,
    internalFieldsChanged: change.internalFieldsChanged,
    by: input.by.staffId ? { staffId: input.by.staffId, name: input.by.name } : { name: input.by.name },
    at: Date.now(),
    note: input.note,
  });
}
